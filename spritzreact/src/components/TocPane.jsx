import { useMemo, useState } from 'react';
import { getLineIndex } from '../document/readerDocument.js';
import { autoDetectToc, getTocEntries } from '../document/toc.js';

// Editable table of contents. Entries persist per file (settings.tocEntries); when none are
// stored, headings are auto-detected. Add the current position, rename, delete, reorder by
// word index (kept sorted), regenerate from headings, or clear.
export default function TocPane({ tab, onJumpWord, onPatch }) {
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const custom = !!(settings.tocEntries && settings.tocEntries.length);
  const entries = useMemo(() => getTocEntries(tab), [tab, settings.tocEntries]); // eslint-disable-line
  const currentLine = getLineIndex(doc, idx);
  const [editing, setEditing] = useState(-1);
  const [draft, setDraft] = useState('');

  function commit(next) {
    onPatch({ tocEntries: [...next].sort((a, b) => a.wordIndex - b.wordIndex) });
  }
  function addHere() {
    const li = getLineIndex(doc, idx);
    const lineText = (doc.lines[li]?.text || '').trim();
    const title = lineText.slice(0, 60) || `Mark @ word ${idx + 1}`;
    commit([...entries.filter((e) => e.wordIndex !== idx), { wordIndex: idx, title }]);
  }
  function rename(i, title) {
    const next = entries.map((e, k) => (k === i ? { ...e, title } : e));
    commit(next);
  }
  function remove(i) {
    commit(entries.filter((_, k) => k !== i));
  }

  return (
    <div className="toc-pane">
      <div className="toc-toolbar">
        <span>Contents{custom ? '' : ' (auto)'}</span>
        <span style={{ flex: 1 }} />
        <button title="Add the current position as an entry" onClick={addHere}>+ Here</button>
        <button title="Replace with auto-detected headings" onClick={() => commit(autoDetectToc(doc))}>↻</button>
        {custom && <button title="Clear custom entries (revert to auto)" onClick={() => onPatch({ tocEntries: [] })}>✕</button>}
      </div>
      {entries.length === 0 && <div className="toc-item" style={{ opacity: 0.6 }}>No entries. Use “+ Here”.</div>}
      {entries.map((e, i) => {
        const eLine = getLineIndex(doc, e.wordIndex);
        const isCurrent = currentLine >= eLine && (i + 1 >= entries.length || currentLine < getLineIndex(doc, entries[i + 1].wordIndex));
        return (
          <div key={`${e.wordIndex}-${i}`} className={`toc-item ${isCurrent ? 'current' : ''}`}>
            {editing === i ? (
              <input
                autoFocus
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                onBlur={() => {
                  rename(i, draft.trim() || e.title);
                  setEditing(-1);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') ev.currentTarget.blur();
                  if (ev.key === 'Escape') setEditing(-1);
                }}
                style={{ width: '100%' }}
              />
            ) : (
              <>
                <span className="toc-title" title={e.title} onClick={() => onJumpWord(e.wordIndex)}>
                  {e.title}
                </span>
                <span className="toc-actions">
                  <button title="Rename" onClick={() => { setEditing(i); setDraft(e.title); }}>✎</button>
                  <button title="Delete" onClick={() => remove(i)}>🗑</button>
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
