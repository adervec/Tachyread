import { useEffect, useRef, useState } from 'react';

// Renders the original document page/section beside the reader, synced to the reading
// position via doc.wordToSegment. PDF pages are rasterized with pdf.js; EPUB sections show
// their (sanitized) source HTML. Plain text/DOCX have no original layout.

const pdfCache = new Map(); // checksum → Promise<PDFDocumentProxy>

function getPdf(doc) {
  const key = doc.contentChecksum;
  if (pdfCache.has(key)) return pdfCache.get(key);
  const p = (async () => {
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs.getDocument({ data: doc.source.pdfData.slice(0) }).promise;
  })();
  pdfCache.set(key, p);
  return p;
}

function PdfSource({ doc, page }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [err, setErr] = useState('');
  const task = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setErr('');
    (async () => {
      try {
        const pdf = await getPdf(doc);
        if (cancelled) return;
        const pg = await pdf.getPage(page + 1);
        if (cancelled || !canvasRef.current) return;
        const wrapW = wrapRef.current?.clientWidth || 360;
        const base = pg.getViewport({ scale: 1 });
        const scale = Math.max(0.2, (wrapW - 10) / base.width);
        const viewport = pg.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        if (task.current) task.current.cancel();
        task.current = pg.render({ canvasContext: canvas.getContext('2d'), viewport });
        await task.current.promise;
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') setErr(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
      if (task.current) try { task.current.cancel(); } catch { /* noop */ }
    };
  }, [doc, page]);

  return (
    <div className="source-canvas-wrap" ref={wrapRef}>
      {err ? <div className="source-msg">Could not render page: {err}</div> : <canvas ref={canvasRef} />}
    </div>
  );
}

function EpubSource({ doc, section }) {
  const ref = useRef(null);
  const html = doc.source.sections[section] || '';
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [section]);
  return <div className="source-html" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

// HTML/Markdown source: a sandboxed iframe (scripts allowed but origin-isolated; document
// scripts were already stripped at parse) carrying the document's OWN stylesheet — so a
// Claude-generated page keeps its theme — plus a tiny injected shim that makes checkboxes
// tickable and reports ticks to the app for per-file persistence.
const BASE_SRC_CSS = `
  body { font-family: system-ui, 'Segoe UI', sans-serif; line-height: 1.55; margin: 12px 16px; font-size: 14px; }
  table { border-collapse: collapse; } th, td { border: 1px solid #9993; padding: 3px 8px; text-align: left; }
  pre { background: #8881; padding: 8px 10px; border-radius: 6px; overflow-x: auto; }
  code { background: #8881; padding: 0 3px; border-radius: 3px; }
  blockquote { border-left: 3px solid #8886; margin: 8px 0; padding: 2px 12px; opacity: .85; }
  img { max-width: 100%; } li.task { list-style: none; margin-left: -1.2em; }
`;

function HtmlSource({ doc, section, checks, onCheck }) {
  const html = doc.source.sections[section] || '';
  const styles = doc.source.styles || '';
  const saved = checks?.[section] || [];
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8">
    <style>${BASE_SRC_CSS}</style><style>${styles}</style></head><body>${html}
    <script>
      (function () {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('input[type=checkbox]'));
        var saved = ${JSON.stringify(saved)};
        boxes.forEach(function (b, i) {
          b.disabled = false;
          if (saved.indexOf(i) >= 0) b.checked = true; else if (saved.length && !b.hasAttribute('checked')) b.checked = false;
          b.addEventListener('change', function () {
            parent.postMessage({ t: 'src-check', section: ${section}, box: i, on: b.checked }, '*');
          });
        });
      })();
    </script></body></html>`;

  useEffect(() => {
    function onMsg(e) {
      const d = e.data;
      if (d && d.t === 'src-check' && d.section === section) onCheck?.(d.section, d.box, d.on);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [section, onCheck]);

  return (
    <iframe
      className="source-frame"
      title="Original document"
      sandbox="allow-scripts"
      srcDoc={srcdoc}
    />
  );
}

function ImageSource({ doc, index }) {
  const url = doc.source.images[index];
  return (
    <div className="source-canvas-wrap">
      {url ? <img className="source-image" src={url} alt={`grabbed page ${index + 1}`} /> : <div className="source-msg">No image.</div>}
    </div>
  );
}

export default function SourcePane({ tab, onPatch }) {
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const src = doc.source;
  // Persisted checkbox ticks for html/markdown sources: { [sectionIndex]: [checkboxIndex...] }.
  const checks = settings.sourceChecks || {};
  const onCheck = (section, box, on) => {
    const cur = new Set(checks[section] || []);
    if (on) cur.add(box); else cur.delete(box);
    onPatch?.({ sourceChecks: { ...checks, [section]: [...cur] } });
  };

  if (!src) {
    return (
      <div className="source-pane">
        <div className="source-toolbar"><span>Original</span></div>
        <div className="source-msg">No original page view for this format (plain text / DOCX).</div>
      </div>
    );
  }

  const seg = doc.wordToSegment ? doc.wordToSegment[Math.min(idx, doc.wordToSegment.length - 1)] || 0 : 0;
  const totalSeg = src.kind === 'pdf' ? src.pageCount : src.kind === 'images' ? src.images.length : src.sections.length;
  const label = src.kind === 'pdf' ? 'PDF page' : src.kind === 'images' ? 'Grabbed page' : src.kind === 'html' ? 'Section' : 'EPUB section';

  return (
    <div className="source-pane">
      <div className="source-toolbar">
        <span>{label} {seg + 1} / {totalSeg}</span>
        <span className="source-sync" title="Follows your reading position">⟳ synced</span>
      </div>
      <div className="source-body">
        {src.kind === 'pdf' && <PdfSource doc={doc} page={seg} />}
        {src.kind === 'epub' && <EpubSource doc={doc} section={seg} />}
        {src.kind === 'html' && <HtmlSource doc={doc} section={seg} checks={checks} onCheck={onCheck} />}
        {src.kind === 'images' && <ImageSource doc={doc} index={seg} />}
      </div>
    </div>
  );
}
