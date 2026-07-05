import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getTocEntries } from '../document/toc.js';
import { findInDoc } from '../document/findText.js';
import FindResults from '../components/FindResults.jsx';

export default function FindDialog({ tab, onJumpWord, onPeek, onSetGoal, onClose }) {
  const [q, setQ] = useState('');
  const [caseSens, setCaseSens] = useState(false);
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
          onChange={(e) => setQ(e.target.value)} placeholder="Search the document…"
        />
        <label className="inline-check"><input type="checkbox" checked={caseSens} onChange={(e) => setCaseSens(e.target.checked)} /> Case</label>
        <span className="settings-note" style={{ margin: 0 }}>{results.length} match{results.length === 1 ? '' : 'es'}</span>
      </div>
      {q && results.length === 0 && <p className="settings-note">No matches for “{q}”.</p>}
      <FindResults doc={doc} results={results} query={q} actions={actions} />
    </Dialog>
  );
}
