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

function PdfSource({ doc, page, curOff }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const markRef = useRef(null);
  const [err, setErr] = useState('');
  const [tokens, setTokens] = useState(null); // per-page word boxes as % of the page: { start, end%, ... }
  const task = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setErr('');
    setTokens(null);
    (async () => {
      try {
        const pdf = await getPdf(doc);
        if (cancelled) return;
        const pg = await pdf.getPage(page + 1);
        if (cancelled || !canvasRef.current) return;
        const wrapW = wrapRef.current?.clientWidth || 360;
        const base = pg.getViewport({ scale: 1 });
        const scale = Math.max(0.2, (wrapW - 2) / base.width); // canvas ≈ wrap width so the % cursor aligns
        const viewport = pg.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        if (task.current) task.current.cancel();
        task.current = pg.render({ canvasContext: canvas.getContext('2d'), viewport });
        await task.current.promise;
        // Best-effort word cursor: pull the text layer and record each token's box as a % of the
        // page, so the marker tracks the CSS-scaled canvas without pixel math. Tokens are counted
        // the same way (\S+ runs) the reader tokenizes, so `curOff` lines up. ponytail: char-level
        // width within an item is estimated evenly — good enough for a highlight box.
        const tc = await pg.getTextContent();
        if (cancelled) return;
        const boxes = [];
        for (const it of tc.items) {
          const words = (it.str.match(/\S+/g) || []);
          if (!words.length) continue;
          const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
          const fontH = Math.hypot(it.transform[2], it.transform[3]) * scale;
          const wTotal = (it.width || 0) * scale;
          const chars = it.str.length || 1;
          let ci = 0;
          for (const w of words) {
            const startCol = it.str.indexOf(w, ci); ci = startCol + w.length;
            const wx = x + (startCol / chars) * wTotal;
            const ww = (w.length / chars) * wTotal;
            boxes.push({
              left: (wx / viewport.width) * 100,
              top: ((y - fontH) / viewport.height) * 100,
              w: (ww / viewport.width) * 100,
              h: (fontH / viewport.height) * 100,
            });
          }
        }
        setTokens(boxes);
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') setErr(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
      if (task.current) try { task.current.cancel(); } catch { /* noop */ }
    };
  }, [doc, page]);

  const box = tokens && curOff >= 0 ? tokens[Math.min(curOff, tokens.length - 1)] : null;
  useEffect(() => { markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [box]);

  return (
    <div className="source-canvas-wrap source-canvas-cursor" ref={wrapRef}>
      {err ? <div className="source-msg">Could not render page: {err}</div> : <canvas ref={canvasRef} />}
      {box && <span ref={markRef} className="src-canvas-mark" style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${Math.max(box.w, 1.5)}%`, height: `${Math.max(box.h, 1.6)}%` }} />}
    </div>
  );
}

// Wrap the off-th whitespace-delimited token under root in a marker span (previous marker
// unwrapped first) and return it; off < 0 just clears. Token counting mirrors the reader's
// tokenizer (\S+ runs) so the reading position maps onto the source text.
// ponytail: tokens spanning element boundaries (<b>H</b>ello) count as two — the marker may
// drift a word on heavy inline formatting, which is fine for a visual cursor.
function markToken(rootDoc, root, off, cls) {
  for (const old of root.querySelectorAll('.' + cls)) old.replaceWith(rootDoc.createTextNode(old.textContent));
  if (off < 0) return null;
  const walker = rootDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/^(SCRIPT|STYLE)$/.test(n.parentNode?.nodeName || '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let count = 0, node;
  while ((node = walker.nextNode())) {
    const re = /\S+/g;
    let m;
    while ((m = re.exec(node.nodeValue))) {
      if (count === off) {
        const range = rootDoc.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const span = rootDoc.createElement('span');
        span.className = cls;
        try { range.surroundContents(span); } catch { return null; }
        return span;
      }
      count++;
    }
  }
  return null;
}

// The "invert vortex" word marker: difference-blend against whatever the source page looks
// like, so it inverts any styling instead of assuming one.
const CURSOR_CSS = '.tx-src-cur { background: #fff; mix-blend-mode: difference; border-radius: 3px; box-shadow: 0 0 0 2px #fff, 0 0 14px 5px rgba(255,255,255,0.5); }';

function EpubSource({ doc, section, curOff, pad }) {
  const ref = useRef(null);
  const html = doc.source.sections[section] || '';
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [section]);
  useEffect(() => {
    if (!ref.current) return;
    const span = markToken(document, ref.current, curOff, 'tx-src-cur');
    span?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [curOff, section, html]);
  return <div className="source-html" ref={ref} style={{ padding: pad }} dangerouslySetInnerHTML={{ __html: html }} />;
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

function HtmlSource({ doc, section, checks, onCheck, curOff, pad }) {
  const frameRef = useRef(null);
  const html = doc.source.sections[section] || '';
  const styles = doc.source.styles || '';
  const saved = checks?.[section] || [];
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8">
    <style>${BASE_SRC_CSS}</style><style>body { margin: ${pad}px ${pad + 4}px; }</style><style>${CURSOR_CSS}</style><style>${styles}</style></head><body>${html}
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
        // Current-word cursor: parent posts the token offset; we wrap it and keep it in view.
        function mark(off) {
          var olds = document.querySelectorAll('.tx-src-cur');
          for (var j = 0; j < olds.length; j++) olds[j].replaceWith(document.createTextNode(olds[j].textContent));
          if (off < 0) return;
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) { return /^(SCRIPT|STYLE)$/.test(n.parentNode && n.parentNode.nodeName || '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
          });
          var count = 0, node;
          while ((node = walker.nextNode())) {
            var re = /\\S+/g, m;
            while ((m = re.exec(node.nodeValue))) {
              if (count === off) {
                var range = document.createRange();
                range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
                var span = document.createElement('span'); span.className = 'tx-src-cur';
                try { range.surroundContents(span); } catch (e) { return; }
                span.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
              }
              count++;
            }
          }
        }
        window.addEventListener('message', function (e) {
          if (e.data && e.data.t === 'src-cur') mark(e.data.off);
        });
        // Clicking the page focuses this sandboxed frame — forward the reader's navigation keys
        // so the arrow shortcuts keep working.
        document.addEventListener('keydown', function (e) {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].indexOf(e.key) >= 0) {
            e.preventDefault();
            parent.postMessage({ t: 'src-key', key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }, '*');
          }
        });
        parent.postMessage({ t: 'src-ready', section: ${section} }, '*');
      })();
    </script></body></html>`;

  // Latest offset in a ref so the frame's load handshake can request it without re-binding.
  const offRef = useRef(curOff);
  offRef.current = curOff;
  useEffect(() => {
    function onMsg(e) {
      const d = e.data;
      if (d && d.t === 'src-check' && d.section === section) onCheck?.(d.section, d.box, d.on);
      if (d && d.t === 'src-key') document.dispatchEvent(new KeyboardEvent('keydown', { key: d.key, ctrlKey: d.ctrlKey, shiftKey: d.shiftKey, bubbles: true }));
      if (d && d.t === 'src-ready') frameRef.current?.contentWindow?.postMessage({ t: 'src-cur', off: offRef.current }, '*');
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [section, onCheck]);

  // Word moved within the same section — update the marker without reloading the frame.
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ t: 'src-cur', off: curOff }, '*');
  }, [curOff]);

  return (
    <iframe
      ref={frameRef}
      className="source-frame"
      title="Original document"
      sandbox="allow-scripts"
      srcDoc={srcdoc}
    />
  );
}

function ImageSource({ doc, index, frac }) {
  const url = doc.source.images[index];
  const markRef = useRef(null);
  useEffect(() => { markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [frac]);
  // A grabbed page is a flat image with no word geometry, so the cursor is a best-effort progress
  // band at the fraction of the page you've reached (by word count) — a "you're about here" guide.
  return (
    <div className="source-canvas-wrap source-canvas-cursor">
      {url ? <img className="source-image" src={url} alt={`grabbed page ${index + 1}`} /> : <div className="source-msg">No image.</div>}
      {url && frac != null && frac >= 0 && <span ref={markRef} className="src-band-mark" style={{ top: `${Math.min(98, frac * 100)}%` }} />}
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

  const wIdx = Math.min(idx, (doc.wordToSegment?.length || 1) - 1);
  const seg = doc.wordToSegment ? doc.wordToSegment[wIdx] || 0 : 0;
  const totalSeg = src.kind === 'pdf' ? src.pageCount : src.kind === 'images' ? src.images.length : src.sections.length;
  const label = src.kind === 'pdf' ? 'PDF page' : src.kind === 'images' ? 'Grabbed page' : src.kind === 'html' ? 'Section' : 'EPUB section';

  // Token offset of the current word WITHIN its segment (+ segment length) — text cursors count
  // tokens per section; the image band uses the offset/length fraction. Scan back to the segment
  // boundary, bounded by the segment's length not the whole document.
  const cursorOn = settings.sourceCursor !== false;
  let curOff = -1, segLen = 0;
  if (cursorOn && doc.wordToSegment) {
    let start = wIdx;
    while (start > 0 && doc.wordToSegment[start - 1] === seg) start--;
    let end = wIdx;
    while (end + 1 < doc.wordToSegment.length && doc.wordToSegment[end + 1] === seg) end++;
    curOff = wIdx - start;
    segLen = end - start + 1;
  }
  const pad = Math.max(0, Number(settings.sourcePad ?? 12));
  const textSource = src.kind === 'html' || src.kind === 'epub';

  return (
    <div className="source-pane">
      <div className="source-toolbar">
        <span>{label} {seg + 1} / {totalSeg}</span>
        <span className="source-tools">
          <button
            className={`src-tool${settings.sourceCursor !== false ? ' on' : ''}`}
            title="Mark the current word on the page"
            onClick={() => onPatch?.({ sourceCursor: settings.sourceCursor === false })}
          >◎</button>
          {textSource && (
            <>
              <button className="src-tool" title="Less page padding" onClick={() => onPatch?.({ sourcePad: Math.max(0, pad - 4) })}>–</button>
              <button className="src-tool" title="More page padding" onClick={() => onPatch?.({ sourcePad: Math.min(48, pad + 4) })}>+</button>
            </>
          )}
          <span className="source-sync" title="Follows your reading position">⟳ synced</span>
        </span>
      </div>
      <div className="source-body">
        {src.kind === 'pdf' && <PdfSource doc={doc} page={seg} curOff={curOff} />}
        {src.kind === 'epub' && <EpubSource doc={doc} section={seg} curOff={curOff} pad={pad} />}
        {src.kind === 'html' && <HtmlSource doc={doc} section={seg} checks={checks} onCheck={onCheck} curOff={curOff} pad={pad} />}
        {src.kind === 'images' && <ImageSource doc={doc} index={seg} frac={cursorOn && segLen ? curOff / segLen : -1} />}
      </div>
    </div>
  );
}
