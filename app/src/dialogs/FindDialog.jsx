import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';

export default function FindDialog({ tab, onJumpWord, onClose }) {
  const [q, setQ] = useState('');
  const [caseSens, setCaseSens] = useState(false);

  const results = useMemo(() => {
    if (!q) return [];
    const out = [];
    const re = new RegExp(escape(q), caseSens ? 'g' : 'gi');
    for (let li = 0; li < tab.doc.lines.length; li++) {
      const txt = tab.doc.lines[li].text;
      if (re.test(txt)) {
        out.push({ lineIndex: li, text: txt, wordIndex: tab.doc.lines[li].startWordIndex });
        re.lastIndex = 0;
      }
      if (out.length > 500) break;
    }
    return out;
  }, [q, caseSens, tab.doc]);

  function escape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return (
    <Dialog title="Find" onClose={onClose} width={520}>
      <div className="field-row">
        <label>Search</label>
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type to search…"
        />
      </div>
      <div className="field-row">
        <label>Case sensitive</label>
        <input type="checkbox" checked={caseSens} onChange={(e) => setCaseSens(e.target.checked)} />
      </div>
      <div>{results.length} matches</div>
      <div className="find-results">
        {results.map((r) => (
          <div
            key={r.lineIndex}
            className="hit"
            onClick={() => {
              if (r.wordIndex >= 0) onJumpWord(r.wordIndex);
              onClose();
            }}
          >
            <strong>Line {r.lineIndex + 1}:</strong> {r.text.slice(0, 160)}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
