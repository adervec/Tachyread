import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getLineIndex } from '../document/readerDocument.js';
import { autoDetectToc, isMatterTitle, sectionSpan } from '../document/toc.js';
import { detectTocRegion, parsePrintedToc, buildFromParsed, finalizeEntries, joinRegion, autoSplitSquashed, parseManualToc } from '../document/tocWizard.js';
import { findInDoc } from '../document/findText.js';
import FindResults from '../components/FindResults.jsx';

// Robust TOC-generation wizard. Three paths, with the printed-Contents path as the headline feature:
// the user points at the book's own printed table of contents, and we use it to locate each heading
// in the body — far more reliable than guessing from formatting alone.
export default function TocWizard({ tab, onApply, onClose }) {
  const { doc } = tab;
  const total = doc.words.length || 1;
  const [step, setStep] = useState('method'); // method | region | review
  const [method, setMethod] = useState('printed');
  const detected = useMemo(() => detectTocRegion(doc), [doc]);
  const [start, setStart] = useState(detected ? detected.startLine : 0);
  const [end, setEnd] = useState(detected ? detected.endLine : Math.min(doc.lines.length - 1, 40));
  const [candidates, setCandidates] = useState([]);
  const [showUnmatched, setShowUnmatched] = useState(true);
  const [skipContents, setSkipContents] = useState(true); // exclude the printed contents pages from completion %
  const [findFor, setFindFor] = useState(null); // entry index whose line we're searching for
  const [findQuery, setFindQuery] = useState('');
  const [manualText, setManualText] = useState(null); // guided split for a squashed one-line ToC (null = off)

  // In-wizard Find (rich): locate the real start of an entry, with the same info columns + context peek
  // as the Find dialog — but no jump/peek/goal buttons (a ✓ assigns the line to the entry instead).
  const wizHits = useMemo(
    () => (findFor != null && findQuery.trim().length >= 2 ? findInDoc(doc, findQuery, { max: 80 }) : []),
    [doc, findQuery, findFor],
  );

  // Parse preview of the chosen region — from the guided manual split when active, else line-per-entry.
  const parsedAuto = useMemo(() => parsePrintedToc(doc, start, end), [doc, start, end]);
  const parsedManual = useMemo(() => (manualText != null ? parseManualToc(manualText) : null), [manualText]);
  const parsed = parsedManual ?? parsedAuto;
  const entrySrcLines = useMemo(() => {
    const m = new Map();
    for (const p of parsed) m.set(p.srcLine, p);
    return m;
  }, [parsed]);

  function gotoRegion() {
    setMethod('printed');
    if (detected) { setStart(detected.startLine); setEnd(detected.endLine); }
    setStep('region');
  }
  function autoDetectRegion() {
    const r = detectTocRegion(doc);
    if (r) { setStart(r.startLine); setEnd(r.endLine); }
  }
  function buildFromHeadings() {
    setMethod('headings');
    const list = autoDetectToc(doc).map((e) => ({ wordIndex: e.wordIndex, title: e.title, level: e.level || 0, matched: true, skip: isMatterTitle(e.title) }));
    setCandidates(list);
    setStep('review');
  }
  function buildFromRegion() {
    setCandidates(buildFromParsed(doc, parsed, end + 1).map((c) => ({ ...c, skip: isMatterTitle(c.title) })));
    setStep('review');
  }
  // Enter guided manual-split mode: join the region to one blob and auto-suggest a per-entry split the
  // user can then hand-edit. Turn it off to go back to the automatic line-per-entry parse.
  function startManualSplit() { setManualText(autoSplitSquashed(joinRegion(doc, start, end))); }
  const setSkip = (i, v) => setCandidates((cs) => cs.map((c, k) => (k === i ? { ...c, skip: v } : c)));

  const matchedCount = candidates.filter((c) => c.matched && Number.isFinite(c.wordIndex)).length;

  // ── review-step edits ──
  const setTitle = (i, title) => setCandidates((cs) => cs.map((c, k) => (k === i ? { ...c, title } : c)));
  const bump = (i, d) => setCandidates((cs) => cs.map((c, k) => (k === i ? { ...c, level: Math.max(0, (c.level || 0) + d) } : c)));
  const remove = (i) => setCandidates((cs) => cs.filter((_, k) => k !== i));
  const assignLine = (i, lineNum) => setCandidates((cs) => cs.map((c, k) => {
    if (k !== i) return c;
    const li = Math.max(0, Math.min(doc.lines.length - 1, (Number(lineNum) || 1) - 1));
    const wi = doc.lines[li]?.startWordIndex;
    if (wi == null || wi < 0) return c;
    return { ...c, wordIndex: wi, matched: true };
  }));

  function apply() {
    const entries = finalizeEntries(candidates);
    // Skip ranges from checked entries' section spans (+ the printed contents pages themselves).
    const skip = [];
    for (const c of candidates) {
      if (!c.skip || !c.matched || !Number.isFinite(c.wordIndex)) continue;
      const i = entries.findIndex((e) => e.wordIndex === c.wordIndex && e.title === c.title);
      if (i < 0) continue;
      const sp = sectionSpan(entries, i, total);
      skip.push({ start: sp.start, end: sp.end, label: c.title });
    }
    if (method === 'printed' && skipContents) {
      let a = -1;
      let b = -1;
      for (let li = start; li <= end && li < doc.lines.length; li++) {
        const ln = doc.lines[li];
        if (ln && ln.startWordIndex >= 0) { if (a < 0) a = ln.startWordIndex; if (ln.endWordIndex >= 0) b = ln.endWordIndex + 1; }
      }
      if (a >= 0 && b > a) skip.push({ start: a, end: b, label: 'Contents' });
    }
    onApply(entries, skip);
    onClose();
  }

  const title =
    step === 'method' ? 'Generate Contents — choose a source'
      : step === 'region' ? 'Generate Contents — point at the printed ToC'
        : 'Generate Contents — review';

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
              <button className="toggle-on" disabled={!parsed.length} onClick={buildFromRegion}>Match to text →</button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(method === 'printed' ? 'region' : 'method')}>← Back</button>
              <button className="toggle-on" disabled={matchedCount === 0} onClick={apply}>Apply {matchedCount} entrie{matchedCount === 1 ? 'y' : 's'}</button>
            </>
          )
      }
    >
      {step === 'method' && (
        <div className="tw-methods">
          <button className="tw-method" onClick={gotoRegion}>
            <div className="tw-method-h">📖 From the book’s printed Contents <span className="tw-rec">recommended</span></div>
            <p>Point at the table of contents printed in the text. The wizard reads those titles and finds where each one actually begins in the body — the most accurate result.</p>
            {detected
              ? <p className="tw-detected">✓ A Contents section looks to be around line {detected.startLine + 1}–{detected.endLine + 1}.</p>
              : <p className="settings-note">No printed “Contents” heading was auto-found — you can still select the region by hand.</p>}
          </button>
          <button className="tw-method" onClick={buildFromHeadings}>
            <div className="tw-method-h">🔎 From detected headings</div>
            <p>Scan the whole document for lines that look like headings (Chapter / Part / short capitalised lines). Good when there’s no printed contents list.</p>
          </button>
          <button className="tw-method" onClick={() => { onApply([]); onClose(); }}>
            <div className="tw-method-h">✏️ Start blank / reset</div>
            <p>Clear any custom contents, then add entries yourself in the Contents pane’s Edit mode.</p>
          </button>
        </div>
      )}

      {step === 'region' && (
        <div className="tw-region">
          <p className="settings-note">
            Set the line range that contains the printed table of contents. The preview shows which lines
            will become entries (and their page numbers, if present). Adjust until only the contents list
            is highlighted.
          </p>
          <div className="tw-region-controls">
            <label>Start line <input type="number" min={1} max={doc.lines.length} value={start + 1} onChange={(e) => setStart(Math.max(0, (Number(e.target.value) || 1) - 1))} /></label>
            <label>End line <input type="number" min={1} max={doc.lines.length} value={end + 1} onChange={(e) => setEnd(Math.max(0, (Number(e.target.value) || 1) - 1))} /></label>
            <button onClick={autoDetectRegion}>↻ Auto-detect</button>
            {manualText == null
              ? <button onClick={startManualSplit} title="Use this when the whole contents sit on one wrapped line and nothing was found">✂ One line? Split manually</button>
              : <button onClick={() => setManualText(null)}>↺ Back to auto</button>}
            <span className="tw-parse-count">{parsed.length} entr{parsed.length === 1 ? 'y' : 'ies'} found</span>
          </div>
          {manualText == null && parsedAuto.length < 2 && (
            <p className="settings-note tw-squash-hint">
              Only {parsedAuto.length} entr{parsedAuto.length === 1 ? 'y' : 'ies'} found — if this book’s contents are squashed onto one line,
              click <b>✂ One line? Split manually</b> and break them apart yourself.
            </p>
          )}
          {manualText != null ? (
            <div className="tw-manual">
              <p className="settings-note">
                One entry per line — edit the split below (add or remove line breaks until each contents
                entry is on its own line). A trailing page number after each title is read automatically.
                {' '}<button className="link-btn" onClick={startManualSplit}>↻ Re-suggest split</button>
              </p>
              <textarea className="tw-manual-text" rows={10} value={manualText} onChange={(e) => setManualText(e.target.value)} spellCheck={false} />
              <div className="tw-manual-preview">
                {parsed.length} entr{parsed.length === 1 ? 'y' : 'ies'}:{' '}
                {parsed.slice(0, 14).map((p, i) => <span key={i} className="tw-manual-chip">{p.title}{p.page != null ? ` · p.${p.page}` : ''}</span>)}
                {parsed.length > 14 ? ' …' : ''}
              </div>
            </div>
          ) : (
            <div className="tw-preview">
              {Array.from({ length: Math.min(220, Math.max(0, end - start + 1)) }, (_, k) => start + k).map((li) => {
                const line = doc.lines[li];
                if (!line) return null;
                const ent = entrySrcLines.get(li);
                return (
                  <div key={li} className={`tw-pl${ent ? ' entry' : ''}${line.isEmpty ? ' blank' : ''}`}>
                    <span className="tw-pl-n">{li + 1}</span>
                    {ent ? (
                      <span className="tw-pl-t"><b style={{ marginLeft: (ent.indent || 0) }}>{ent.title}</b>{ent.page != null && <span className="tw-pl-pg"> · p.{ent.page}</span>}</span>
                    ) : (
                      <span className="tw-pl-t tw-pl-skip">{line.isEmpty ? '·' : line.text.trim() || '·'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="tw-review">
          <div className="tw-review-head">
            <span><b>{matchedCount}</b> of {candidates.length} located in the text.</span>
            {candidates.some((c) => !c.matched) && (
              <label className="inline-check"><input type="checkbox" checked={showUnmatched} onChange={(e) => setShowUnmatched(e.target.checked)} /> show unmatched</label>
            )}
          </div>
          {method === 'printed' && (
            <label className="inline-check" style={{ marginBottom: 6 }}>
              <input type="checkbox" checked={skipContents} onChange={(e) => setSkipContents(e.target.checked)} /> Exclude the contents pages themselves from completion %
            </label>
          )}
          <p className="settings-note" style={{ marginTop: 0 }}>
            Tick <b>skip</b> to leave a section out of your completion % (reading it still counts toward WPM).
            Copyright, contents, index, notes, acknowledgements and about-the-author are pre-checked.
          </p>
          {candidates.length === 0 && <p className="settings-note">No entries — go back and widen the region, or use detected headings.</p>}
          {findFor != null && (
            <div className="tw-find">
              <div className="tw-find-head">
                <span>🔍 Find the line for <b>{candidates[findFor]?.title}</b></span>
                <button className="tw-rev-x" title="Close find" onClick={() => setFindFor(null)}>✕</button>
              </div>
              <input
                className="tw-find-input"
                autoFocus
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Search the document text…"
              />
              <div className="tw-find-results">
                <FindResults
                  doc={doc}
                  results={wizHits}
                  query={findQuery}
                  showSection={false}
                  showRead={false}
                  actions={[{ icon: '✓ use', title: 'Use this line as the entry’s start', cls: 'find-use', onClick: (r) => { assignLine(findFor, r.lineIndex + 1); setFindFor(null); } }]}
                />
                {findQuery.trim().length >= 2 && wizHits.length === 0 && <div className="settings-note" style={{ padding: '4px 8px' }}>No lines match “{findQuery.trim()}”.</div>}
              </div>
            </div>
          )}
          <div className="tw-rev-list">
            {candidates.map((c, i) => {
              if (!c.matched && !showUnmatched) return null;
              const pct = Number.isFinite(c.wordIndex) ? (c.wordIndex / total) * 100 : null;
              const line = Number.isFinite(c.wordIndex) ? getLineIndex(doc, c.wordIndex) + 1 : null;
              return (
                <div key={i} className={`tw-rev-row${c.matched ? '' : ' unmatched'}`}>
                  <span className="tw-rev-status" title={c.matched ? 'Located in the text' : 'Not found — set a line or it will be skipped'}>{c.matched ? '✓' : '✗'}</span>
                  <span className="tw-rev-indent" style={{ width: (c.level || 0) * 14 }} />
                  <button className="tw-rev-lvl" title="Promote" disabled={!(c.level > 0)} onClick={() => bump(i, -1)}>⇤</button>
                  <button className="tw-rev-lvl" title="Demote" onClick={() => bump(i, 1)}>⇥</button>
                  <input className="tw-rev-title" value={c.title} onChange={(e) => setTitle(i, e.target.value)} />
                  {c.matched
                    ? <span className="tw-rev-pos" title={`Line ${line}`}>{pct.toFixed(1)}%</span>
                    : <input className="tw-rev-line" type="number" min={1} placeholder="line #" onChange={(e) => assignLine(i, e.target.value)} title="Type the line where this section starts" />}
                  <button className="tw-rev-find" title="Find this section in the text" onClick={() => { setFindFor(i); setFindQuery(c.title || ''); }}>🔍</button>
                  <label className="tw-rev-skip" title="Exclude this section from the completion %">
                    <input type="checkbox" checked={!!c.skip} onChange={(e) => setSkip(i, e.target.checked)} />skip
                  </label>
                  <button className="tw-rev-x" title="Remove" onClick={() => remove(i)}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
