import { useMemo, useState } from 'react';
import { findTermIndex } from '../document/resourceWizard.js';

// Displays the book's index (built by the resource wizard from the printed index). Each term jumps
// to its next occurrence in the body — page numbers can't be mapped to positions reliably, so we
// locate the term in the text instead (wrapping around from the current reading position).
export default function IndexPane({ tab, onJumpWord, onWizard }) {
  const { doc, settings } = tab;
  const entries = settings.indexEntries || [];
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    if (!filter) return entries;
    const f = filter.toLowerCase();
    return entries.filter((e) => e.term.toLowerCase().includes(f));
  }, [entries, filter]);

  function jump(term) {
    let i = findTermIndex(doc, term, settings.wordIndex + 1);
    if (i < 0) i = findTermIndex(doc, term, 0); // wrap
    if (i >= 0) onJumpWord(i);
  }

  return (
    <div className="toc-pane index-pane">
      <div className="toc-toolbar">
        <span className="toc-title-label">Index</span>
        <span style={{ flex: 1 }} />
        {onWizard && <button title="Build the index from the book’s printed index (wizard)" onClick={onWizard}>🪄</button>}
      </div>
      {entries.length === 0 ? (
        <div className="toc-empty">
          No index yet. {onWizard && <button onClick={onWizard}>Build from the printed index…</button>}
        </div>
      ) : (
        <>
          <div className="toc-col-menu">
            <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter terms…" style={{ width: '100%' }} />
          </div>
          <div className="toc-table-scroll index-list">
            {shown.map((e, i) => (
              <div key={i} className={`index-row lvl-${e.level || 0}`} onClick={() => jump(e.term)} title={`Jump to “${e.term}” in the text`}>
                <span className="index-term">{e.term}</span>
                {e.pages && e.pages.length > 0 && <span className="index-pages">{e.pages.slice(0, 10).join(', ')}</span>}
              </div>
            ))}
            {shown.length === 0 && <div className="toc-empty">No terms match “{filter}”.</div>}
          </div>
        </>
      )}
    </div>
  );
}
