import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { tagHtmlForPicking, docFromHtmlRange, htmlRangeChildIdxs, collectLinks, contentHtmlOf, buildDocFromPages } from '../document/parsers.js';
import { fetchPageText } from '../features/webGrab.js';
import { attachChecksum } from '../document/readerDocument.js';
import { t, fmtNum } from '../i18n.js';

// Interactive fallback for when the auto content-root heuristic grabs the wrong region of an HTML
// page (a preface / site chrome, missing the real text). The page renders in a sandboxed iframe; you
// click the block that holds the content, then NAVIGATE the DOM — widen to the parent, narrow to a
// child, step between sibling blocks, or extend the selection across a run of blocks — watching a live
// extraction preview, then open the reader from exactly that region.
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
        if (el) parent.postMessage({ t: 'tx-pick', idx: Number(el.getAttribute('data-tx-idx')), shift: !!e.shiftKey }, '*');
      }, true);
      window.addEventListener('message', function (e) {
        if (!e.data || e.data.t !== 'tx-select') return;
        var old = document.querySelectorAll('.tx-sel');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('tx-sel');
        var idxs = e.data.idxs || [];
        var first = null;
        for (var j = 0; j < idxs.length; j++) {
          var el = document.querySelector('[data-tx-idx="' + idxs[j] + '"]');
          if (el) { el.classList.add('tx-sel'); if (!first) first = el; }
        }
        if (first) first.scrollIntoView({ block: 'center' });
      });
    })();
  </script>`;

export default function HtmlStructureWizard({ html, fileName = t('Web page'), sourceUrl = '', onClose }) {
  const { openDoc, setStatus } = useApp();
  const frameRef = useRef(null);
  const rootRef = useRef(null);
  const [follow, setFollow] = useState(null); // { done, total, label } while following ToC links
  const [followMsg, setFollowMsg] = useState('');
  const abortRef = useRef(false);
  const { taggedHtml, candidates } = useMemo(() => {
    try { return tagHtmlForPicking(html || ''); } catch { return { taggedHtml: html || '', candidates: [] }; }
  }, [html]);
  // A parsed copy of the tagged page for DOM navigation (parent/child/sibling + breadcrumb). Cheap:
  // built once per page, queried by data-tx-idx.
  const pickerDom = useMemo(() => {
    try { return new DOMParser().parseFromString(taggedHtml, 'text/html'); } catch { return null; }
  }, [taggedHtml]);

  const [startIdx, setStartIdx] = useState(candidates[0]?.idx ?? null);
  const [endIdx, setEndIdx] = useState(null); // null → single block (== start); else a start..end range
  const [busy, setBusy] = useState(false);

  // ── DOM navigation helpers (operate on pickerDom) ──
  const elByIdx = (idx) => (idx == null || !pickerDom ? null : pickerDom.querySelector(`[data-tx-idx="${idx}"]`));
  const idxOf = (el) => { const v = el?.getAttribute?.('data-tx-idx'); return v == null ? null : Number(v); };
  const wordsOf = (el) => ((el?.textContent || '').match(/\S+/g) || []).length;
  const parentIdx = (idx) => idxOf(elByIdx(idx)?.parentElement);
  const childIdx = (idx) => { const el = elByIdx(idx); if (!el) return null; for (const c of el.children) if (idxOf(c) != null && wordsOf(c) >= 1) return idxOf(c); return null; };
  const sibIdx = (idx, dir) => { let el = elByIdx(idx); while (el) { el = dir > 0 ? el.nextElementSibling : el.previousElementSibling; if (idxOf(el) != null && wordsOf(el) >= 1) return idxOf(el); } return null; };
  const ancestorChain = (idx) => { const out = []; let el = elByIdx(idx); while (el) { if (idxOf(el) != null) out.unshift(el); el = el.parentElement; } return out; };

  const setSingle = (idx) => { if (idx != null) { setStartIdx(idx); setEndIdx(null); } };
  const nav = (fn) => { const n = fn(startIdx); if (n != null) setSingle(n); rootRef.current?.focus?.(); };
  const extend = () => { const cur = endIdx ?? startIdx; const n = sibIdx(cur, +1); if (n != null) setEndIdx(n); };
  const reduce = () => { if (endIdx == null || endIdx === startIdx) return; const n = sibIdx(endIdx, -1); setEndIdx(n == null || n === startIdx ? null : n); };

  const srcDoc = useMemo(() => {
    const m = /<head[^>]*>/i.exec(taggedHtml);
    return m ? taggedHtml.slice(0, m.index + m[0].length) + PICKER_SHIM + taggedHtml.slice(m.index + m[0].length)
      : '<head>' + PICKER_SHIM + '</head>' + taggedHtml;
  }, [taggedHtml]);

  // The blocks the current start..end selection spans (for highlight + the "N blocks" readout).
  const rangeIdxs = useMemo(() => (pickerDom && startIdx != null ? htmlRangeChildIdxs(pickerDom, startIdx, endIdx) : []), [pickerDom, startIdx, endIdx]);

  // Receive a click from the sandboxed preview (shift-click extends the selection to that block).
  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data || e.data.t !== 'tx-pick') return;
      if (e.data.shift) setEndIdx(e.data.idx); else setSingle(e.data.idx);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // Mirror the current selection back into the preview (highlight the spanned blocks + scroll to them).
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ t: 'tx-select', idxs: rangeIdxs }, '*');
  }, [rangeIdxs, srcDoc]);

  // Live extraction preview for the selected region — the exact text the reader would get.
  const preview = useMemo(() => {
    if (startIdx == null) return null;
    try {
      const doc = docFromHtmlRange(taggedHtml, fileName, startIdx, endIdx);
      return { words: doc.words.length, lines: doc.lines.slice(0, 14).map((l) => l.text), toc: (doc.tocEntries || []).length };
    } catch { return null; }
  }, [startIdx, endIdx, taggedHtml, fileName]);

  async function useRegion() {
    if (startIdx == null) return;
    setBusy(true);
    try {
      const doc = docFromHtmlRange(taggedHtml, fileName, startIdx, endIdx);
      if (!doc.words.length) { setBusy(false); return; }
      await attachChecksum(doc);
      await openDoc(doc);
      setStatus(t.n('Opened “{name}” from the chosen region ({count} word).', 'Opened “{name}” from the chosen region ({count} words).', doc.words.length, { name: doc.fileName, count: fmtNum(doc.words.length) }));
      onClose();
    } catch (e) { setBusy(false); setStatus(t('Could not open that region: {error}', { error: e?.message || e })); }
  }

  // ── Follow ToC links: when this page came from a web grab, the selected region may be a
  // table-of-contents whose links go to separate chapter pages. Fetch each and stitch into one book.
  const links = useMemo(() => {
    if (!sourceUrl || startIdx == null) return [];
    try { return collectLinks(taggedHtml, startIdx, sourceUrl); } catch { return []; }
  }, [sourceUrl, startIdx, taggedHtml]);

  async function followLinks() {
    if (!links.length) return;
    abortRef.current = false;
    setFollowMsg(''); setFollow({ done: 0, total: links.length, label: t('Starting…') });
    const pages = []; const errors = [];
    let preferProxy = false;
    for (let i = 0; i < links.length; i++) {
      if (abortRef.current) break;
      const lk = links[i];
      setFollow({ done: i, total: links.length, label: lk.text || lk.url });
      try {
        const { text, viaProxy } = await fetchPageText(lk.url, { preferProxy });
        if (viaProxy) preferProxy = true; // once the relay was needed, the rest of the site needs it too
        const { title, html: chapterHtml } = contentHtmlOf(text);
        if (chapterHtml && chapterHtml.replace(/<[^>]+>/g, '').trim()) pages.push({ title: title || lk.text || t('Part {n}', { n: i + 1 }), html: chapterHtml });
        else errors.push(t('{page}: no readable text', { page: lk.text || lk.url }));
      } catch (e) { errors.push(`${lk.text || lk.url}: ${e?.message || e}`); }
      setFollow({ done: i + 1, total: links.length, label: lk.text || lk.url });
    }
    if (abortRef.current) { setFollow(null); setFollowMsg(t.n('Stopped — {n} page fetched.', 'Stopped — {n} pages fetched.', pages.length)); return; }
    if (!pages.length) { setFollow(null); setFollowMsg(t('Couldn’t read any linked page. {errors}', { errors: errors.slice(0, 2).join(' · ') })); return; }
    try {
      const doc = buildDocFromPages(pages, fileName);
      doc.sourceUrl = sourceUrl;
      await attachChecksum(doc);
      await openDoc(doc);
      const words = fmtNum(doc.words.length);
      setStatus(errors.length
        ? t.n('Opened “{name}” — stitched {n} linked page, {failed} failed ({words} words).', 'Opened “{name}” — stitched {n} linked pages, {failed} failed ({words} words).', pages.length, { name: doc.fileName, failed: errors.length, words })
        : t.n('Opened “{name}” — stitched {n} linked page ({words} words).', 'Opened “{name}” — stitched {n} linked pages ({words} words).', pages.length, { name: doc.fileName, words }));
      onClose();
    } catch (e) { setFollow(null); setFollowMsg(t('Could not assemble the book: {error}', { error: e?.message || e })); }
  }

  const label = (c) => `${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls.split(/\s+/)[0] : ''}`;
  const elLabel = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${(typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;
  const chain = startIdx != null ? ancestorChain(startIdx) : [];
  const isRange = endIdx != null && endIdx !== startIdx;

  function onKey(e) {
    if (startIdx == null) return;
    const k = e.key;
    if (k === 'ArrowUp') { const p = parentIdx(startIdx); if (p != null) { setSingle(p); e.preventDefault(); } }
    else if (k === 'ArrowDown') { const c = childIdx(startIdx); if (c != null) { setSingle(c); e.preventDefault(); } }
    else if (k === 'ArrowLeft') { if (e.shiftKey) reduce(); else { const s = sibIdx(startIdx, -1); if (s != null) setSingle(s); } e.preventDefault(); }
    else if (k === 'ArrowRight') { if (e.shiftKey) extend(); else { const s = sibIdx(startIdx, +1); if (s != null) setSingle(s); } e.preventDefault(); }
  }

  return (
    <Dialog
      title={t('Pick the HTML content region')}
      onClose={onClose}
      width={960}
      buttons={<>
        <button onClick={onClose}>{t('Cancel')}</button>
        <button className="toggle-on" onClick={useRegion} disabled={busy || startIdx == null || !preview?.words}>{t('Use this region')} ▸</button>
      </>}
    >
      <p className="settings-note" style={{ marginTop: 0 }}>
        {t('Auto-detection missed the text? Click the block that holds the reading content, then use the arrows below to widen / narrow / step until the preview shows the whole book. Shift-click (or Extend ▸) to span a run of blocks — handy to skip a preface.')}
        {sourceUrl ? <> {t('If this is a table of contents, click its list of chapter links and use Follow links to stitch the linked pages into one book.')}</> : null}
      </p>

      {/* Navigation toolbar + breadcrumb */}
      <div className="hsw-nav" ref={rootRef} tabIndex={0} onKeyDown={onKey}>
        <div className="hsw-navbtns">
          <button onClick={() => nav(parentIdx)} disabled={parentIdx(startIdx) == null} title={t('Select the parent block (wider) — ↑')}>⬆ {t('Wider')}</button>
          <button onClick={() => nav(childIdx)} disabled={childIdx(startIdx) == null} title={t('Select the first child block (narrower) — ↓')}>⬇ {t('Narrower')}</button>
          <span className="grab-sep" />
          <button onClick={() => nav((i) => sibIdx(i, -1))} disabled={sibIdx(startIdx, -1) == null} title={t('Previous sibling block — ←')}>◀ {t('Prev')}</button>
          <button onClick={() => nav((i) => sibIdx(i, +1))} disabled={sibIdx(startIdx, +1) == null} title={t('Next sibling block — →')}>{t('Next')} ▶</button>
          <span className="grab-sep" />
          <button onClick={extend} disabled={startIdx == null || sibIdx(endIdx ?? startIdx, +1) == null} title={t('Extend the selection to include the next block — {key}', { key: 'Shift+→' })}>＋ {t('Extend')}</button>
          <button onClick={reduce} disabled={!isRange} title={t('Drop the last block from the selection — {key}', { key: 'Shift+←' })}>－ {t('Reduce')}</button>
          {isRange && <button onClick={() => setEndIdx(null)} title={t('Back to a single block')}>✕ {t('range')}</button>}
        </div>
        <div className="hsw-crumbs">
          {chain.map((el) => {
            const idx = idxOf(el);
            return (
              <button key={idx} className={`hsw-crumb${idx === startIdx ? ' on' : ''}`} onClick={() => setSingle(idx)} title={t.n('{count} word', '{count} words', wordsOf(el), { count: fmtNum(wordsOf(el)) })}>
                {elLabel(el)}
              </button>
            );
          })}
          {!chain.length && <span className="settings-note" style={{ margin: 0 }}>{t('Click a block in the preview to start.')}</span>}
        </div>
      </div>

      <div className="hsw">
        <div className="hsw-preview">
          <iframe ref={frameRef} title={t('HTML structure')} sandbox="allow-scripts" srcDoc={srcDoc} />
        </div>
        <div className="hsw-side">
          <div className="field-section" style={{ marginTop: 0 }}>{t('Suggested regions')}</div>
          <div className="hsw-cands">
            {candidates.length === 0 && <p className="settings-note">{t('No obvious containers — click a block in the preview.')}</p>}
            {candidates.map((c) => (
              <button
                key={c.idx}
                className={`hsw-cand${c.idx === startIdx && !isRange ? ' on' : ''}`}
                onClick={() => setSingle(c.idx)}
                title={c.sample}
              >
                <span className="hsw-cand-tag">{label(c)}</span>
                <span className="hsw-cand-words">{t.n('{count} word', '{count} words', c.words, { count: fmtNum(c.words) })}</span>
                <span className="hsw-cand-sample">{c.sample}</span>
              </button>
            ))}
          </div>
          <div className="field-section">{t('Extraction preview')} {isRange ? `· ${t.n('{n} block', '{n} blocks', rangeIdxs.length)}` : ''}</div>
          {preview ? (
            <div className="hsw-extract">
              <div className="hsw-extract-stat">{t.n('{count} word', '{count} words', preview.words, { count: fmtNum(preview.words) })}{preview.toc ? ` · ${t.n('{n} heading', '{n} headings', preview.toc)}` : ''}</div>
              <div className="hsw-extract-lines">
                {preview.lines.map((l, i) => <div key={i}>{l || ' '}</div>)}
                {preview.words > 0 && <div className="settings-note">…</div>}
              </div>
            </div>
          ) : <p className="settings-note">{t('Pick a region to preview its text.')}</p>}

          {sourceUrl && (
            <>
              <div className="field-section">{t('Table of contents')} {links.length ? `· ${t.n('{n} link', '{n} links', links.length)}` : ''}</div>
              {links.length ? (
                <div className="hsw-follow">
                  <p className="settings-note" style={{ marginTop: 0 }}>
                    {t.n('This region links to {n} separate page. Follow it to fetch it and stitch it into one book (each page becomes a section).', 'This region links to {n} separate pages. Follow them to fetch each and stitch them into one book (each page becomes a section).', links.length)}
                  </p>
                  {follow ? (
                    <>
                      <div className="imp-bar"><div className="imp-fill" style={{ width: `${follow.total ? (follow.done / follow.total) * 100 : 0}%` }} /></div>
                      <div className="hsw-follow-row">
                        <span className="settings-note" style={{ margin: 0 }}>{t('Fetching {done}/{total} — {page}…', { done: follow.done, total: follow.total, page: follow.label?.slice(0, 40) })}</span>
                        <button onClick={() => { abortRef.current = true; }}>{t('Stop')}</button>
                      </div>
                    </>
                  ) : (
                    <button className="toggle-on" onClick={followLinks}>{t.n('Follow {n} link', 'Follow {n} links', links.length)} ▸</button>
                  )}
                  {followMsg && <p className="settings-note">{followMsg}</p>}
                </div>
              ) : (
                <p className="settings-note" style={{ marginTop: 0 }}>{t('No off-page links in this region. If this is a contents page, click its list of chapter links, then Follow.')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
