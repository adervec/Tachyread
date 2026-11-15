import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { t } from '../i18n.js';

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
      title={t('Go to Line')}
      onClose={onClose}
      buttons={
        <>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="toggle-on" onClick={go}>{t('Go')}</button>
        </>
      }
    >
      <div className="field-row">
        <label>{t('Line number (1–{max})', { max: tab.doc.lines.length })}</label>
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
