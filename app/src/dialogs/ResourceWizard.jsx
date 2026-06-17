import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { detectProperNames } from '../document/readerDocument.js';
import {
  detectListSection, parseNamesRegion, buildProperNamesFromList,
  parseIndexRegion, detectFootnotes,
} from '../document/resourceWizard.js';

// One wizard for the book's reference apparatus — cast list (proper names), printed index, and notes.
// Like the TOC wizard, the headline path locates the in-text resource and uses it as ground truth,
// with a blind auto-detect offered only as a fallback. `kind` is 'names' | 'index' | 'notes'.
const META = {
  names: {
    title: 'Proper Names', noun: 'cast list',
    locateH: '🎭 From the cast list (Dramatis Personae)',
    locateP: 'Point at the list of characters printed in the book. We highlight exactly those names in the text — far more precise than guessing from capitalisation.',
    blindH: '🔎 Auto-detect (capitalised words)',
    blindP: 'Scan the whole book for capitalised words that recur. Works without a cast list, but catches false positives.',
  },
  index: {
    title: 'Index', noun: 'printed index',
    locateH: '📑 From the book’s printed index',
    locateP: 'Point at the index at the back of the book. We read its terms and page numbers, and make each term jump to where it appears in the text.',
  },
  notes: {
    title: 'Footnotes', noun: 'notes section',
    locateH: '🗒 Locate the notes section + marker style',
    locateP: 'Point at the foot/endnotes section and pick the in-text marker style, so note bodies are matched from the right place.',
    blindH: '🔎 Auto-detect everywhere',
    blindP: 'Scan the whole book for [1] / (1) / superscript markers and matching “1. …” note bodies.',
  },
};

export default function ResourceWizard({ kind, tab, onApply, onClose }) {
  const { doc } = tab;
  const meta = META[kind];
  const detected = useMemo(() => detectListSection(doc, kind === 'notes' ? 'notes' : kind), [doc, kind]);
  const [step, setStep] = useState('method'); // method | region | review
  const [start, setStart] = useState(detected ? detected.startLine : 0);
  const [end, setEnd] = useState(detected ? detected.endLine : Math.min(doc.lines.length - 1, 60));
  const [styles, setStyles] = useState({ bracket: true, paren: true, super: true });
  const [items, setItems] = useState([]); // review rows (kind-specific)

  // Live parse of the chosen region (names/index) for the preview.
  const parsed = useMemo(() => {
    if (kind === 'names') return parseNamesRegion(doc, start, end);
    if (kind === 'index') return parseIndexRegion(doc, start, end);
    return [];
  }, [doc, kind, start, end]);
  const entrySrc = useMemo(() => new Set(parsed.map((p) => p.srcLine)), [parsed]);

  function autoRegion() {
    const r = detectListSection(doc, kind === 'notes' ? 'notes' : kind);
    if (r) { setStart(r.startLine); setEnd(r.endLine); }
  }

  // ── build (locate path) ──
  function buildLocate() {
    if (kind === 'names') {
      const names = parseNamesRegion(doc, start, end);
      const map = buildProperNamesFromList(doc, names);
      setItems(names.map((n) => ({ ...n, count: countFor(map, n.name) })).filter((n) => n.count > 0 || true));
    } else if (kind === 'index') {
      setItems(parseIndexRegion(doc, start, end));
    } else {
      const map = detectFootnotes(doc, { styles, bodyStart: start, bodyEnd: end });
      setItems([...map.values()].sort((a, b) => a.number - b.number));
    }
    setStep('review');
  }
  // ── build (blind path) ──
  function buildBlind() {
    if (kind === 'names') {
      detectProperNames(doc);
      const rows = [];
      for (const [, v] of doc.properNames) rows.push({ name: v.canonical, note: '', count: v.indices.length });
      rows.sort((a, b) => b.count - a.count);
      setItems(rows);
    } else if (kind === 'notes') {
      const map = detectFootnotes(doc, {});
      setItems([...map.values()].sort((a, b) => a.number - b.number));
    }
    setStep('review');
  }

  function apply() {
    if (kind === 'names') {
      const names = items.map((it) => ({ name: it.name, note: it.note || '' }));
      onApply({ kind: 'names', map: buildProperNamesFromList(doc, names), seed: names });
    } else if (kind === 'index') {
      onApply({ kind: 'index', entries: items.map((it) => ({ term: it.term, pages: it.pages || [], level: it.level || 0 })) });
    } else {
      const map = new Map();
      for (const it of items) map.set(it.number, it);
      onApply({ kind: 'notes', map });
    }
    onClose();
  }

  const title = `Generate ${meta.title} — ${step === 'method' ? 'choose a source' : step === 'region' ? `point at the ${meta.noun}` : 'review'}`;
  const backStep = () => setStep(step === 'review' ? 'method' : 'method');

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={680}
      buttons={
        step === 'method' ? <button onClick={onClose}>Cancel</button>
          : step === 'region' ? (
            <>
              <button onClick={() => setStep('method')}>← Back</button>
              <button className="toggle-on" disabled={kind !== 'notes' && parsed.length === 0} onClick={buildLocate}>Build →</button>
            </>
          ) : (
            <>
              <button onClick={backStep}>← Back</button>
              <button className="toggle-on" disabled={items.length === 0} onClick={apply}>Apply {items.length}</button>
            </>
          )
      }
    >
      {step === 'method' && (
        <div className="tw-methods">
          <button className="tw-method" onClick={() => { if (detected) { setStart(detected.startLine); setEnd(detected.endLine); } setStep('region'); }}>
            <div className="tw-method-h">{meta.locateH} <span className="tw-rec">recommended</span></div>
            <p>{meta.locateP}</p>
            {detected
              ? <p className="tw-detected">✓ A {meta.noun} looks to be around line {detected.startLine + 1}–{detected.endLine + 1}.</p>
              : <p className="settings-note">No {meta.noun} was auto-found — you can still select the region by hand.</p>}
          </button>
          {meta.blindH && (
            <button className="tw-method" onClick={buildBlind}>
              <div className="tw-method-h">{meta.blindH}</div>
              <p>{meta.blindP}</p>
            </button>
          )}
        </div>
      )}

      {step === 'region' && (
        <div className="tw-region">
          <p className="settings-note">Set the line range of the {meta.noun}. The preview shows which lines become entries.</p>
          <div className="tw-region-controls">
            <label>Start line <input type="number" min={1} max={doc.lines.length} value={start + 1} onChange={(e) => setStart(Math.max(0, (Number(e.target.value) || 1) - 1))} /></label>
            <label>End line <input type="number" min={1} max={doc.lines.length} value={end + 1} onChange={(e) => setEnd(Math.max(0, (Number(e.target.value) || 1) - 1))} /></label>
            <button onClick={autoRegion}>↻ Auto-detect</button>
            {kind !== 'notes' && <span className="tw-parse-count">{parsed.length} found</span>}
          </div>
          {kind === 'notes' && (
            <div className="tw-region-controls" style={{ marginTop: 0 }}>
              <span>Markers:</span>
              {['bracket', 'paren', 'super'].map((s) => (
                <label key={s} className="inline-check"><input type="checkbox" checked={styles[s]} onChange={(e) => setStyles((st) => ({ ...st, [s]: e.target.checked }))} /> {s === 'bracket' ? '[1]' : s === 'paren' ? '(1)' : '¹'}</label>
              ))}
            </div>
          )}
          <div className="tw-preview">
            {Array.from({ length: Math.min(240, Math.max(0, end - start + 1)) }, (_, k) => start + k).map((li) => {
              const line = doc.lines[li];
              if (!line) return null;
              const isEntry = entrySrc.has(li);
              return (
                <div key={li} className={`tw-pl${isEntry ? ' entry' : ''}${line.isEmpty ? ' blank' : ''}`}>
                  <span className="tw-pl-n">{li + 1}</span>
                  <span className={`tw-pl-t${isEntry ? '' : ' tw-pl-skip'}`}>{line.isEmpty ? '·' : line.text.trim() || '·'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="tw-review">
          <div className="tw-review-head"><span><b>{items.length}</b> {meta.title.toLowerCase()} entr{items.length === 1 ? 'y' : 'ies'}.</span></div>
          {items.length === 0 && <p className="settings-note">Nothing found — go back and widen the region.</p>}
          <div className="tw-rev-list">
            {items.map((it, i) => (
              <div key={i} className={`tw-rev-row${kind === 'index' && it.level ? ' tw-sub' : ''}`}>
                {kind === 'names' && (
                  <>
                    <input className="tw-rev-title" value={it.name} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                    {it.note && <span className="tw-rev-note" title={it.note}>{it.note}</span>}
                    <span className="tw-rev-pos" title="occurrences in the text">{it.count ?? '—'}×</span>
                  </>
                )}
                {kind === 'index' && (
                  <>
                    <span className="tw-rev-indent" style={{ width: (it.level || 0) * 16 }} />
                    <input className="tw-rev-title" value={it.term} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, term: e.target.value } : x)))} />
                    <span className="tw-rev-note">{(it.pages || []).slice(0, 8).join(', ')}</span>
                  </>
                )}
                {kind === 'notes' && (
                  <>
                    <span className="tw-rev-status" style={{ color: 'var(--toggle-active-bg)' }}>[{it.number}]</span>
                    <span className="tw-rev-title tw-rev-fnbody" title={it.body}>{it.body || '(marker only — no body matched)'}</span>
                    <span className="tw-rev-pos">{(it.anchors || []).length}×</span>
                  </>
                )}
                <button className="tw-rev-x" title="Remove" onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function countFor(map, name) {
  let total = 0;
  for (const tok of String(name).toLowerCase().split(/\s+/)) {
    const c = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (map.has(c)) total += map.get(c).indices.length;
  }
  return total;
}
