import { useEffect, useMemo, useRef, useState } from 'react';
import { getLineIndex } from '../document/readerDocument.js';
import { autoDetectToc, getTocEntries, buildTocTree, sectionSpan, currentChapter } from '../document/toc.js';

// Optional stat columns (the name column is always shown). `get` receives a per-row context.
const STAT_COLUMNS = [
  { key: 'startLine', label: 'Ln', title: 'Starts at line', get: (c) => c.startLine },
  { key: 'startWord', label: 'Wd', title: 'Starts at word', get: (c) => c.startWord },
  { key: 'startPct', label: '@%', title: 'Starts at % of document', get: (c) => `${c.startPct.toFixed(1)}%` },
  { key: 'lenLines', label: '∑Ln', title: 'Lines in this section', get: (c) => c.lenLines },
  { key: 'lenWords', label: '∑Wd', title: 'Words in this section', get: (c) => c.lenWords },
  { key: 'lenPct', label: '%Doc', title: 'Portion of the document', get: (c) => `${c.lenPct.toFixed(1)}%` },
  { key: 'childPct', label: 'Σ%ch', title: 'Summed % size of immediate children', get: (c) => (c.childPct != null ? `${c.childPct.toFixed(1)}%` : '—') },
  { key: 'pctRead', label: 'Read', title: 'Percent of this section read', get: (c) => `${(c.readFrac * 100).toFixed(1)}%` },
  { key: 'wpm', label: 'WPM', title: 'Average reading pace in this section', get: (c) => (c.wpm ? c.wpm : '—') },
  { key: 'started', label: 'Started', title: 'When you first reached this section', get: (c) => fmtTs(c.started) },
  { key: 'completed', label: 'Done', title: 'When this section was fully read', get: (c) => fmtTs(c.completed) },
];

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
export default function TocPane({ tab, onJumpWord, onScrollToLine, onPatch, onSetSectionGoal, flashSignal }) {
  const { doc, settings, tracker } = tab;
  const idx = settings.wordIndex;
  const total = doc.words.length || 1;
  const custom = !!(settings.tocEntries && settings.tocEntries.length);
  const columns = settings.tocColumns || {};
  const paneRef = useRef(null);

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
    const t = setTimeout(() => {
      const el = paneRef.current?.querySelector(`[data-toc-index="${target}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
    const t2 = setTimeout(() => setFlashIndex(-1), 2600);
    return () => { clearTimeout(t); clearTimeout(t2); };
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
    const title = lineText.slice(0, 60) || `Mark @ word ${idx + 1}`;
    mutate([...draft.filter((e) => e.wordIndex !== idx), { wordIndex: idx, title, level: 0 }]);
  }

  const visibleCols = STAT_COLUMNS.filter((c) => columns[c.key] !== false);

  return (
    <div className="toc-pane" ref={paneRef}>
      <div className="toc-toolbar">
        <span className="toc-title-label">Contents{custom ? '' : ' (auto)'}</span>
        <span style={{ flex: 1 }} />
        {!editing && (
          <>
            <button className={showCols ? 'on' : ''} title="Show / hide columns" onClick={() => setShowCols((v) => !v)}>▦</button>
            <button title="Edit the table of contents" onClick={beginEdit}>✎ Edit</button>
          </>
        )}
        {editing && (
          <>
            <button title="Undo" disabled={!hist.past.length} onClick={undo}>↶</button>
            <button title="Redo" disabled={!hist.future.length} onClick={redo}>↷</button>
            <button title="Add an entry at the current reading position" onClick={addHere}>+ Here</button>
            <button title="Regenerate from detected headings" onClick={() => mutate(autoDetectToc(doc))}>↻</button>
            <button title="Remove all entries" onClick={() => mutate([])}>✕</button>
            <button className="toc-commit" title="Save changes" onClick={commit}>✓ Commit</button>
            <button title="Discard changes" onClick={discard}>Discard</button>
          </>
        )}
      </div>

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
        <div className="toc-empty">No entries. {editing ? 'Use “+ Here” or ↻ to build one.' : 'Use ✎ Edit to add entries.'}</div>
      )}

      {entries.length > 0 && (
        <div className="toc-table-scroll">
          <table className="toc-table">
            <thead>
              <tr>
                {editing ? (
                  <>
                    <th className="toc-act-h" title="Promote a tier (outdent)">⇤</th>
                    <th className="toc-act-h" title="Demote a tier (indent)">⇥</th>
                    <th className="toc-act-h" title="Delete entry">🗑</th>
                  </>
                ) : (
                  <>
                    <th className="toc-act-h" title="Jump here (move reading position)">▶</th>
                    <th className="toc-act-h" title="Scroll into view (keep reading position)">👁</th>
                    <th className="toc-act-h" title="Set finishing this section as the goal">🎯</th>
                  </>
                )}
                <th className="toc-name-h">Section</th>
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
                return (
                  <tr
                    key={`${e.wordIndex}-${row.index}`}
                    data-toc-index={row.index}
                    className={`toc-row${isCurrent ? ' current' : ''}${done ? ' done' : ''}${row.index === flashIndex ? ' toc-flash' : ''}`}
                  >
                    {editing ? (
                      <>
                        <td className="toc-act"><button title="Promote a tier (outdent)" disabled={!(e.level > 0)} onClick={() => outdent(row.index)}>⇤</button></td>
                        <td className="toc-act"><button title="Demote a tier (indent)" onClick={() => indent(row.index)}>⇥</button></td>
                        <td className="toc-act"><button className="toc-del" title="Delete" onClick={() => del(row.index)}>🗑</button></td>
                        <td className="toc-name">
                          <span className="toc-indent" style={{ width: row.level * 12 }} />
                          <input className="toc-edit-name" value={e.title} onChange={(ev) => rename(row.index, ev.target.value)} title={`@ word ${e.wordIndex + 1}`} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="toc-act"><button title="Jump here (move reading position)" onClick={() => onJumpWord(e.wordIndex)}>▶</button></td>
                        <td className="toc-act"><button title="Scroll into view (keep reading position)" onClick={() => onScrollToLine(getLineIndex(doc, e.wordIndex))}>👁</button></td>
                        <td className="toc-act">
                          {!done && (
                            <button title="Set finishing this section as the goal" onClick={() => onSetSectionGoal(span.start, span.end, e.title)}>🎯</button>
                          )}
                        </td>
                        <td className="toc-name">
                          <span className="toc-indent" style={{ width: row.level * 12 }} />
                          {row.hasChildren ? (
                            <button className="toc-caret" title={row.collapsed ? 'Expand' : 'Collapse'} onClick={() => toggleCollapse(row.index)}>
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
                      <td key={c.key} className={`toc-stat${c.key === 'pctRead' && done ? ' done' : ''}`}>{c.get(ctx)}</td>
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
