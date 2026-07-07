import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { tagHtmlForPicking, docFromHtmlString } from '../document/parsers.js';
import { attachChecksum } from '../document/readerDocument.js';

// Interactive fallback for when the auto content-root heuristic grabs the wrong region of an HTML
// page (a preface / site chrome, missing the real text). The page is rendered in a sandboxed iframe;
// the user clicks the block that holds the content (or picks from ranked candidates), sees a live
// extraction preview, then opens the reader from exactly that region.
const PICKER_SHIM = `
  <style>
    * { cursor: crosshair !important; }
    .tx-hover { outline: 2px solid #3a86ff !important; outline-offset: -2px; }
    .tx-sel { outline: 3px solid #18a050 !important; outline-offset: -3px; background: rgba(24,160,80,0.10) !important; }
  </style>
  <script>
    (function () {
      var hover = null;
      document.addEventListener('mouseover', function (e) {
        if (hover) hover.classList.remove('tx-hover');
        var el = e.target.closest && e.target.closest('[data-tx-idx]');
        if (el) { hover = el; el.classList.add('tx-hover'); }
      });
      document.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var el = e.target.closest && e.target.closest('[data-tx-idx]');
        if (el) parent.postMessage({ t: 'tx-pick', idx: Number(el.getAttribute('data-tx-idx')) }, '*');
      }, true);
      window.addEventListener('message', function (e) {
        if (!e.data || e.data.t !== 'tx-select') return;
        var old = document.querySelectorAll('.tx-sel');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('tx-sel');
        var el = document.querySelector('[data-tx-idx="' + e.data.idx + '"]');
        if (el) { el.classList.add('tx-sel'); el.scrollIntoView({ block: 'center' }); }
      });
    })();
  </script>`;

export default function HtmlStructureWizard({ html, fileName = 'Web page', onClose }) {
  const { openDoc, setStatus } = useApp();
  const frameRef = useRef(null);
  const { taggedHtml, candidates } = useMemo(() => {
    try { return tagHtmlForPicking(html || ''); } catch { return { taggedHtml: html || '', candidates: [] }; }
  }, [html]);
  const [pickedIdx, setPickedIdx] = useState(candidates[0]?.idx ?? null);
  const [busy, setBusy] = useState(false);

  const srcDoc = useMemo(() => {
    const m = /<head[^>]*>/i.exec(taggedHtml);
    return m ? taggedHtml.slice(0, m.index + m[0].length) + PICKER_SHIM + taggedHtml.slice(m.index + m[0].length)
      : '<head>' + PICKER_SHIM + '</head>' + taggedHtml;
  }, [taggedHtml]);

  // Receive a click from the sandboxed preview.
  useEffect(() => {
    const onMsg = (e) => { if (e.data && e.data.t === 'tx-pick') setPickedIdx(e.data.idx); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // Mirror the current pick back into the preview (highlight + scroll to it).
  useEffect(() => {
    if (pickedIdx != null) frameRef.current?.contentWindow?.postMessage({ t: 'tx-select', idx: pickedIdx }, '*');
  }, [pickedIdx, srcDoc]);

  // Live extraction preview for the picked region — the exact text the reader would get.
  const preview = useMemo(() => {
    if (pickedIdx == null) return null;
    try {
      const doc = docFromHtmlString(taggedHtml, fileName, `[data-tx-idx="${pickedIdx}"]`);
      return { words: doc.words.length, lines: doc.lines.slice(0, 14).map((l) => l.text), toc: (doc.tocEntries || []).length };
    } catch { return null; }
  }, [pickedIdx, taggedHtml, fileName]);

  async function useRegion() {
    if (pickedIdx == null) return;
    setBusy(true);
    try {
      const doc = docFromHtmlString(taggedHtml, fileName, `[data-tx-idx="${pickedIdx}"]`);
      if (!doc.words.length) { setBusy(false); return; }
      await attachChecksum(doc);
      await openDoc(doc);
      setStatus(`Opened “${doc.fileName}” from the chosen region (${doc.words.length.toLocaleString()} words).`);
      onClose();
    } catch (e) { setBusy(false); setStatus('Could not open that region: ' + (e?.message || e)); }
  }

  const label = (c) => `${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls.split(/\s+/)[0] : ''}`;

  return (
    <Dialog
      title="Pick the HTML content region"
      onClose={onClose}
      width={920}
      buttons={<>
        <button onClick={onClose}>Cancel</button>
        <button className="toggle-on" onClick={useRegion} disabled={busy || pickedIdx == null || !preview?.words}>Use this region ▸</button>
      </>}
    >
      <p className="settings-note" style={{ marginTop: 0 }}>
        Auto-detection missed the text? Click the block that holds the reading content in the preview,
        or pick from the suggestions. The right panel shows exactly what would be extracted.
      </p>
      <div className="hsw">
        <div className="hsw-preview">
          <iframe ref={frameRef} title="HTML structure" sandbox="allow-scripts" srcDoc={srcDoc} />
        </div>
        <div className="hsw-side">
          <div className="field-section" style={{ marginTop: 0 }}>Suggested regions</div>
          <div className="hsw-cands">
            {candidates.length === 0 && <p className="settings-note">No obvious containers — click a block in the preview.</p>}
            {candidates.map((c) => (
              <button
                key={c.idx}
                className={`hsw-cand${c.idx === pickedIdx ? ' on' : ''}`}
                onClick={() => setPickedIdx(c.idx)}
                title={c.sample}
              >
                <span className="hsw-cand-tag">{label(c)}</span>
                <span className="hsw-cand-words">{c.words.toLocaleString()} words</span>
                <span className="hsw-cand-sample">{c.sample}</span>
              </button>
            ))}
          </div>
          <div className="field-section">Extraction preview</div>
          {preview ? (
            <div className="hsw-extract">
              <div className="hsw-extract-stat">{preview.words.toLocaleString()} words{preview.toc ? ` · ${preview.toc} headings` : ''}</div>
              <div className="hsw-extract-lines">
                {preview.lines.map((l, i) => <div key={i}>{l || ' '}</div>)}
                {preview.words > 0 && <div className="settings-note">…</div>}
              </div>
            </div>
          ) : <p className="settings-note">Pick a region to preview its text.</p>}
        </div>
      </div>
    </Dialog>
  );
}
