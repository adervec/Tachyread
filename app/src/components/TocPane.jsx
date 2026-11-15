import { useEffect, useMemo, useRef, useState } from 'react';
import { getLineIndex } from '../document/readerDocument.js';
import { fmtDateTime } from '../features/dateFmt.js';
import { autoDetectToc, getTocEntries, buildTocTree, sectionSpan, currentChapter, mergeSkipRanges } from '../document/toc.js';
import { t } from '../i18n.js';

// Optional stat columns (the name column is always shown). `get` receives a per-row context.
const STAT_COLUMNS = [
  { key: 'startLine', label: t('Ln'), title: t('Starts at line'), get: (c) => c.startLine },
  { key: 'startWord', label: t('Wd'), title: t('Starts at word'), get: (c) => c.startWord },
  { key: 'startPct', label: '@%', title: t('Starts at % of document'), get: (c) => `${c.startPct.toFixed(1)}%` },
  { key: 'lenLines', label: t('∑Ln'), title: t('Lines in this section'), get: (c) => c.lenLines },
  { key: 'lenWords', label: t('∑Wd'), title: t('Words in this section'), get: (c) => c.lenWords },
  { key: 'lenPct', label: t('%Doc'), title: t('Portion of the document'), get: (c) => `${c.lenPct.toFixed(1)}%` },
  { key: 'childPct', label: t('Σ%ch'), title: t('Summed % size of immediate children'), get: (c) => (c.childPct != null ? `${c.childPct.toFixed(1)}%` : '—') },
  { key: 'pctRead', label: t('Read'), title: t('Percent of this section read'), get: (c) => `${(c.readFrac * 100).toFixed(1)}%` },
  { key: 'wpm', label: 'WPM', title: t('Average reading pace in this section'), get: (c) => (c.wpm ? c.wpm : '—') },
  { key: 'started', label: t('Started'), title: t('When you first reached this section'), get: (c) => fmtTs(c.started) },
  { key: 'completed', label: t('Done'), title: t('When this section was fully read'), get: (c) => fmtTs(c.completed) },
];

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return fmtDateTime(ts);
  } catch {
    return '—';
  }
}

function sortEntries(list) {
  return [...list]
    .map((e) => ({ ...e, level: Math.max(0, Number.isFinite(e.level) ? e.level : 0) }))
    .sort((a, b) => a.wordIndex - b.wordIndex);
}

// Flatten the tree into render rows, skipping descendants of collapsed nodes.
function flattenVisible(nodes, collapsed, out = []) {
  for (const node of nodes) {
    const isCollapsed = collapsed.has(node.index);
    out.push({ index: node.index, level: node.level, entry: node.entry, hasChildren: node.children.length > 0, collapsed: isCollapsed });
    if (node.children.length && !isCollapsed) flattenVisible(node.children, collapsed, out);
  }
  return out;
}

// Map of node index → summed % size of its immediate children (null when it has none).
function childPctMap(nodes, entries, total, map = new Map()) {
  for (const node of nodes) {
    if (node.children.length) {
      let sum = 0;
      for (const c of node.children) {
        const sp = sectionSpan(entries, c.index, total);
        sum += sp.end - sp.start;
      }
      map.set(node.index, (sum / total) * 100);
    }
    childPctMap(node.children, entries, total, map);
  }
  return map;
}

// Indices of a row's ancestors (so a flash target can be revealed even if collapsed).
function ancestorsOf(entries, index) {
  const lvl = entries[index]?.level || 0;
  const out = [];
  let need = lvl;
  for (let k = index - 1; k >= 0 && need > 0; k--) {
    const l = entries[k].level || 0;
    if (l < need) { out.push(k); need = l; }
  }
  return out;
}

// Editable, hierarchical table of contents. Navigable by default (no structural edits); an
// explicit Edit mode exposes add/rename/delete/indent with undo / redo / commit / discard.
export default function TocPane({ tab, onJumpWord, onScrollToLine, onPatch, onSetSectionGoal, onWizard, flashSignal }) {
  const { doc, settings, tracker } = tab;
  const idx = settings.wordIndex;
  const total = doc.words.length || 1;
  const custom = !!(settings.tocEntries && settings.tocEntries.length);
  const columns = settings.tocColumns || {};
  const skipRanges = settings.skipRanges || [];
  const paneRef = useRef(null);

  // A section is "skipped" (excluded from completion %) when its start falls inside a skip range.
  const isSkippedSpan = (span) => skipRanges.some((r) => span.start >= r.start && span.start < r.end);
  function toggleSkip(span, label) {
    if (isSkippedSpan(span)) {
      onPatch({ skipRanges: skipRanges.filter((r) => !(span.start >= r.start && span.start < r.end)) });
    } else {
      onPatch({ skipRanges: mergeSkipRanges(skipRanges, [{ start: span.start, end: span.end, label }]) });
    }
  }

  // Toggle a section's coverage directly — for chapters read elsewhere (a paper copy, another
  // app). Marking credits coverage only (no time, no WPM); unmarking clears it again.
  const [, setReadBump] = useState(0);
  function toggleRead(span) {
    if (!tracker) return;
    const rs = tracker.rangeStats(span.start, span.end);
    if (rs.readFrac >= 0.999) tracker.unmarkRangeRead(span.start, span.end);
    else tracker.markRangeRead(span.start, span.end);
    setReadBump((n) => n + 1); // tracker is mutable — nudge a re-render so %s update now
  }

  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [flashIndex, setFlashIndex] = useState(-1);
  const [showCols, setShowCols] = useState(false);

  // Edit-mode working draft with an undo / redo history.
  const [hist, setHist] = useState({ past: [], present: [], future: [] });
  const draft = hist.present;

  const entries = useMemo(
    () => (editing ? draft : getTocEntries(tab)),
    [editing, draft, tab, settings.tocEntries] // eslint-disable-line
  );
  const tree = useMemo(() => buildTocTree(entries), [entries]);
  const cur = useMemo(() => currentChapter(entries, idx, total), [entries, idx, total]);
  const childSums = useMemo(() => childPctMap(tree, entries, total), [tree, entries, total]);

  // Auto-collapse fully-read sections when the option is enabled.
  useEffect(() => {
    if (!settings.tocCollapseCompleted || editing) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      entries.forEach((e, i) => {
        const span = sectionSpan(entries, i, total);
        const rs = tracker?.rangeStats(span.start, span.end);
        if (rs && rs.readFrac >= 0.999) next.add(i);
      });
      return next;
    });
    // eslint-disable-next-line
  }, [settings.tocCollapseCompleted]);

  // Flash + reveal a row when asked (TOC-bar icon click).
  useEffect(() => {
    if (!flashSignal || flashSignal.index == null) return;
    const target = flashSignal.index;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const a of ancestorsOf(entries, target)) next.delete(a);
      return next;
    });
    setFlashIndex(target);
    const t1 = setTimeout(() => {
      const el = paneRef.current?.querySelector(`[data-row-of-toc="${target}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
    const t2 = setTimeout(() => setFlashIndex(-1), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line
  }, [flashSignal?.token]);

  function toggleCollapse(i) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function toggleColumn(key) {
    onPatch({ tocColumns: { ...columns, [key]: !columns[key] } });
  }

  // ── edit-mode history ──────────────────────────────────────────────────────
  function beginEdit() {
    setHist({ past: [], present: getTocEntries(tab), future: [] });
    setEditing(true);
  }
  function mutate(nextEntries) {
    setHist((h) => ({ past: [...h.past, h.present], present: sortEntries(nextEntries), future: [] }));
  }
  function undo() {
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  }
  function redo() {
    setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  }
  function commit() {
    onPatch({ tocEntries: draft });
    setEditing(false);
  }
  function discard() {
    setEditing(false);
  }

  // edit operations
  const rename = (i, title) => mutate(draft.map((e, k) => (k === i ? { ...e, title } : e)));
  const del = (i) => mutate(draft.filter((_, k) => k !== i));
  const indent = (i) => mutate(draft.map((e, k) => (k === i ? { ...e, level: (e.level || 0) + 1 } : e)));
  const outdent = (i) => mutate(draft.map((e, k) => (k === i ? { ...e, level: Math.max(0, (e.level || 0) - 1) } : e)));
  function addHere() {
    const li = getLineIndex(doc, idx);
    const lineText = (doc.lines[li]?.text || '').trim();
    const title = lineText.slice(0, 60) || t('Mark @ word {n}', { n: idx + 1 });
    mutate([...draft.filter((e) => e.wordIndex !== idx), { wordIndex: idx, title, level: 0 }]);
  }

  const visibleCols = STAT_COLUMNS.filter((c) => columns[c.key] !== false);

  return (
    <div className="toc-pane" ref={paneRef}>
      <div className="toc-toolbar">
        <span className="toc-title-label">{custom ? t('Contents') : t('Contents (auto)')}</span>
        <span style={{ flex: 1 }} />
        {!editing && (
          <>
            {onWizard && <button title={t('Generate the table of contents (wizard)')} onClick={onWizard}>🪄</button>}
            <button className={showCols ? 'on' : ''} title={t('Show / hide columns')} onClick={() => setShowCols((v) => !v)}>▦</button>
            <button title={t('Edit the table of contents')} onClick={beginEdit}>✎ {t('Edit')}</button>
          </>
        )}
        {editing && (
          <>
            <button title={t('Undo')} disabled={!hist.past.length} onClick={undo}>↶</button>
            <button title={t('Redo')} disabled={!hist.future.length} onClick={redo}>↷</button>
            <button title={t('Add an entry at the current reading position')} onClick={addHere}>+ {t('Here')}</button>
            <button title={t('Regenerate from detected headings')} onClick={() => mutate(autoDetectToc(doc))}>↻</button>
            <button title={t('Remove all entries')} onClick={() => mutate([])}>✕</button>
            <button className="toc-commit" title={t('Save changes')} onClick={commit}>✓ {t('Commit')}</button>
            <button title={t('Discard changes')} onClick={discard}>{t('Discard')}</button>
          </>
        )}
      </div>

      {!editing && skipRanges.length > 0 && (
        <div className="toc-skips" title={t('These sections don’t count toward your completion % (reading still counts toward WPM)')}>
          <span className="toc-skips-label">{t('Excluded from %:')}</span>
          {skipRanges.map((r, i) => (
            <span key={i} className="toc-skip-chip">
              {r.label || `${r.start + 1}–${r.end}`}
              <button title={t('Stop excluding')} onClick={() => onPatch({ skipRanges: skipRanges.filter((_, k) => k !== i) })}>✕</button>
            </span>
          ))}
        </div>
      )}

      {!editing && showCols && (
        <div className="toc-col-menu">
          {STAT_COLUMNS.map((c) => (
            <label key={c.key} title={c.title}>
              <input type="checkbox" checked={columns[c.key] !== false} onChange={() => toggleColumn(c.key)} />
              {c.title}
            </label>
          ))}
        </div>
      )}

      {entries.length === 0 && (
        <div className="toc-empty">{editing ? t('No entries. Use “+ Here” or ↻ to build one.') : t('No entries. Use ✎ Edit to add entries.')}</div>
      )}

      {entries.length > 0 && (
        <div className="toc-table-scroll">
          <table className="toc-table">
            <thead>
              <tr>
                {editing ? (
                  <>
                    <th className="toc-act-h" title={t('Promote a tier (outdent)')}>⇤</th>
                    <th className="toc-act-h" title={t('Demote a tier (indent)')}>⇥</th>
                    <th className="toc-act-h" title={t('Delete entry')}>🗑</th>
                  </>
                ) : (
                  <>
                    <th className="toc-act-h" title={t('Jump here (move reading position)')}>▶</th>
                    <th className="toc-act-h" title={t('Scroll into view (keep reading position)')}>👁</th>
                    <th className="toc-act-h" title={t('Set finishing this section as the goal')}>🎯</th>
                    <th className="toc-act-h" title={t('Exclude this section from completion %')}>⊘</th>
                    <th className="toc-act-h" title={t('Toggle read — credit a section you read elsewhere (e.g. on paper)')}>✓</th>
                  </>
                )}
                <th className="toc-name-h">{t('Section')}</th>
                {visibleCols.map((c) => (
                  <th key={c.key} title={c.title}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flattenVisible(tree, editing ? EMPTY_SET : collapsed).map((row) => {
                const e = row.entry;
                const span = sectionSpan(entries, row.index, total);
                const rs = tracker?.rangeStats(span.start, span.end) || { readFrac: 0, wpm: 0 };
                const readStat = (settings.tocReadStats || {})[e.wordIndex] || {};
                const startLine = getLineIndex(doc, span.start) + 1;
                const endLine = getLineIndex(doc, Math.max(span.start, span.end - 1)) + 1;
                const ctx = {
                  startLine,
                  startWord: span.start + 1,
                  startPct: (span.start / total) * 100,
                  lenLines: Math.max(1, endLine - startLine + 1),
                  lenWords: span.end - span.start,
                  lenPct: ((span.end - span.start) / total) * 100,
                  childPct: childSums.has(row.index) ? childSums.get(row.index) : null,
                  readFrac: rs.readFrac,
                  wpm: rs.wpm,
                  started: readStat.started,
                  completed: readStat.completed,
                };
                const done = rs.readFrac >= 0.999;
                const isCurrent = row.index === cur?.index;
                const skipped = isSkippedSpan(span);
                return (
                  <tr
                    key={`${e.wordIndex}-${row.index}`}
                    data-row-of-toc={row.index}
                    className={`toc-row${isCurrent ? ' current' : ''}${done ? ' done' : ''}${skipped ? ' toc-skipped' : ''}${row.index === flashIndex ? ' toc-flash' : ''}`}
                  >
                    {editing ? (
                      <>
                        <td className="toc-act"><button title={t('Promote a tier (outdent)')} disabled={!(e.level > 0)} onClick={() => outdent(row.index)}>⇤</button></td>
                        <td className="toc-act"><button title={t('Demote a tier (indent)')} onClick={() => indent(row.index)}>⇥</button></td>
                        <td className="toc-act"><button className="toc-del" title={t('Delete')} onClick={() => del(row.index)}>🗑</button></td>
                        <td className="toc-name">
                          <span className="toc-indent" style={{ width: row.level * 12 }} />
                          <input className="toc-edit-name" value={e.title} onChange={(ev) => rename(row.index, ev.target.value)} title={t('@ word {n}', { n: e.wordIndex + 1 })} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="toc-act"><button title={t('Jump here (move reading position)')} onClick={() => onJumpWord(e.wordIndex)}>▶</button></td>
                        <td className="toc-act"><button title={t('Scroll into view (keep reading position)')} onClick={() => onScrollToLine(getLineIndex(doc, e.wordIndex))}>👁</button></td>
                        <td className="toc-act">
                          {!done && (
                            <button title={t('Set finishing this section as the goal')} onClick={() => onSetSectionGoal(span.start, span.end, e.title)}>🎯</button>
                          )}
                        </td>
                        <td className="toc-act">
                          <button className={`toc-mark${skipped ? ' toc-skip-on' : ''}`} aria-pressed={skipped} title={skipped ? t('Excluded from completion % — click to include') : t('Exclude this section from completion %')} onClick={() => toggleSkip(span, e.title)}>⊘</button>
                        </td>
                        <td className="toc-act">
                          <button
                            className={`toc-mark${done ? ' toc-read-on' : ''}`}
                            aria-pressed={done}
                            title={done ? t('Marked read — click to clear this section’s coverage') : t('Mark as read (e.g. read on paper) — credits coverage, no time or WPM')}
                            onClick={() => toggleRead(span)}
                          >✓</button>
                        </td>
                        <td className="toc-name">
                          <span className="toc-indent" style={{ width: row.level * 12 }} />
                          {row.hasChildren ? (
                            <button className="toc-caret" title={row.collapsed ? t('Expand') : t('Collapse')} onClick={() => toggleCollapse(row.index)}>
                              {row.collapsed ? '▸' : '▾'}
                            </button>
                          ) : (
                            <span className="toc-caret-spacer" />
                          )}
                          <span className={`toc-name-text lvl-${row.level}`} title={e.title}>{e.title}</span>
                        </td>
                      </>
                    )}
                    {visibleCols.map((c) => (
                      <td
                        key={c.key}
                        className={`toc-stat${c.key === 'pctRead' && done ? ' done' : ''}`}
                        // Read %: a progress-bar fill behind the number, so scanning the column shows shape at a glance.
                        style={c.key === 'pctRead' && ctx.readFrac > 0
                          ? { background: `linear-gradient(to right, color-mix(in srgb, var(--toggle-active-bg) 26%, transparent) ${(ctx.readFrac * 100).toFixed(1)}%, transparent 0)` }
                          : undefined}
                      >{c.get(ctx)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const EMPTY_SET = new Set();
