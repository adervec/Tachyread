import { useState } from 'react';
import Dialog from './Dialog.jsx';

export default function GoToLineDialog({ tab, onJumpWord, onClose }) {
  const [n, setN] = useState('');
  function go() {
    const num = parseInt(n, 10);
    if (!isFinite(num)) return;
    const li = Math.max(0, Math.min(tab.doc.lines.length - 1, num - 1));
    const wi = tab.doc.lines[li].startWordIndex;
    if (wi >= 0) onJumpWord(wi);
    onClose();
  }
  return (
    <Dialog
      title="Go to Line"
      onClose={onClose}
      buttons={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="toggle-on" onClick={go}>Go</button>
        </>
      }
    >
      <div className="field-row">
        <label>Line number (1–{tab.doc.lines.length})</label>
        <input
          autoFocus
          type="number"
          value={n}
          onChange={(e) => setN(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
      </div>
    </Dialog>
  );
}
