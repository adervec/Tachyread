import { useEffect, useMemo, useState } from 'react';
import { searchAllDocs } from '../state/storage.js';
import Dialog from './Dialog.jsx';
import { getTocEntries } from '../document/toc.js';
import { findInDoc } from '../document/findText.js';
import FindResults from '../components/FindResults.jsx';

export default function FindDialog({ tab, onJumpWord, onPeek, onSetGoal, onClose, initialQuery = '', onOpenDoc }) {
  const [q, setQ] = useState(initialQuery);
  const [caseSens, setCaseSens] = useState(false);
  // Scope: this document, or every document stored on this device (results open the book and re-run
  // the same search there, so the jump lands on the exact match).
  const [scope, setScope] = useState('doc');
  const [lib, setLib] = useState(null); // null = not searched yet / searching
  useEffect(() => {
    if (scope !== 'all' || q.trim().length < 2) { setLib(null); return undefined; }
    let stale = false;
    setLib(null);
    const t = setTimeout(() => { searchAllDocs(q.trim(), { caseSensitive: caseSens, shouldStop: () => stale }).then((r) => { if (!stale) setLib(r); }).catch(() => { if (!stale) setLib([]); }); }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [scope, q, caseSens]);
  const { doc, settings } = tab;
  const tocEntries = useMemo(() => getTocEntries(tab) || [], [tab]);
  const results = useMemo(
    () => findInDoc(doc, q, { caseSensitive: caseSens, tocEntries, readFrontier: settings.wordIndex || 0 }),
    [doc, q, caseSens, tocEntries, settings.wordIndex],
  );

  // Same actions as the Contents page: jump here, peek (keep your place), or set reaching it as a goal.
  const actions = [
    { icon: '▶', title: 'Jump here (move reading position)', onClick: (r) => { if (r.wordIndex >= 0) onJumpWord(r.wordIndex); onClose(); } },
    { icon: '👁', title: 'Peek — scroll it into view, keep your position', onClick: (r) => onPeek?.(r.lineIndex) },
    { icon: '🎯', title: 'Set reaching this point as your reading goal', onClick: (r) => onSetGoal?.(r.wordIndex, `Find: “${q}”`) },
  ];

  return (
    <Dialog title="Find" onClose={onClose} width={760}>
      <div className="find-bar">
        <input
          autoFocus type="text" className="find-input" value={q}
          onChange={(e) => setQ(e.target.value)} placeholder={scope === 'all' ? 'Search every document on this device…' : 'Search the document…'}
        />
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Search scope" title="Search just this document, or every document whose text is stored on this device">
          <option value="doc">This document</option>
          <option value="all">All documents</option>
        </select>
        <label className="inline-check"><input type="checkbox" checked={caseSens} onChange={(e) => setCaseSens(e.target.checked)} /> Case</label>
        {scope === 'doc' && <span className="settings-note" style={{ margin: 0 }}>{results.length} match{results.length === 1 ? '' : 'es'}</span>}
        {scope === 'all' && lib && <span className="settings-note" style={{ margin: 0 }}>{lib.reduce((a, d) => a + d.count, 0)} matches in {lib.length} document{lib.length === 1 ? '' : 's'}</span>}
      </div>
      {scope === 'doc' && (
        <>
          {q && results.length === 0 && <p className="settings-note">No matches for “{q}”.</p>}
          <FindResults doc={doc} results={results} query={q} actions={actions} />
        </>
      )}
      {scope === 'all' && (
        q.trim().length < 2 ? <p className="settings-note">Type at least two letters. Searches every document whose text is saved on this device (anything you've opened here).</p>
          : !lib ? <p className="settings-note">Searching…</p>
            : !lib.length ? <p className="settings-note">No matches for “{q}” in any stored document.</p>
              : (
                <div className="ft-results">
                  {lib.map((d) => (
                    <div key={d.checksum} className="ft-doc">
                      <div className="ft-doc-h">
                        <b>{d.fileName}</b> <span className="lj-qdim">{d.count} match{d.count === 1 ? '' : 'es'}</span>
                        <button className="link-btn" onClick={() => onOpenDoc?.(d.checksum, q.trim())} title="Open this document and show its matches">Open ↗</button>
                      </div>
                      {d.hits.map((h) => (
                        <button key={h.pos} className="ft-hit" onClick={() => onOpenDoc?.(d.checksum, q.trim())}>
                          {h.before}<mark>{h.match}</mark>{h.after}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )
      )}
    </Dialog>
  );
}
