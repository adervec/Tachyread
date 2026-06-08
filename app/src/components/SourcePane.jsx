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

function ImageSource({ doc, index }) {
  const url = doc.source.images[index];
  return (
    <div className="source-canvas-wrap">
      {url ? <img className="source-image" src={url} alt={`grabbed page ${index + 1}`} /> : <div className="source-msg">No image.</div>}
    </div>
  );
}

export default function SourcePane({ tab }) {
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const src = doc.source;

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
  const label = src.kind === 'pdf' ? 'PDF page' : src.kind === 'images' ? 'Grabbed page' : 'EPUB section';

  return (
    <div className="source-pane">
      <div className="source-toolbar">
        <span>{label} {seg + 1} / {totalSeg}</span>
        <span className="source-sync" title="Follows your reading position">⟳ synced</span>
      </div>
      <div className="source-body">
        {src.kind === 'pdf' && <PdfSource doc={doc} page={seg} />}
        {src.kind === 'epub' && <EpubSource doc={doc} section={seg} />}
        {src.kind === 'images' && <ImageSource doc={doc} index={seg} />}
      </div>
    </div>
  );
}
