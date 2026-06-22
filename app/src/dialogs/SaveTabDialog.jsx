import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { tabCanExportSource } from '../features/exportPdf.js';

// Pick a format when saving the active tab. PDF keeps the source (captured page images + a
// searchable text layer) for grabbed/OCR'd books, which a bare TXT export would lose.
export default function SaveTabDialog({ doc, onSave, onClose }) {
  const [busy, setBusy] = useState(false);
  const hasSource = tabCanExportSource(doc) || doc?.source?.kind === 'pdf';

  async function save(format) {
    if (busy) return;
    setBusy(true);
    try { await onSave(format); } finally { setBusy(false); }
    onClose();
  }

  return (
    <Dialog
      title="Save tab"
      onClose={onClose}
      width={460}
      buttons={<button onClick={onClose} disabled={busy}>Cancel</button>}
    >
      <p className="settings-note" style={{ marginTop: 0 }}>Choose a format to save this document.</p>
      <div className="save-format-list">
        <button className="save-format" disabled={busy} onClick={() => save('pdf')}>
          <span className="sf-title">📑 PDF (.pdf)</span>
          <span className="sf-desc">
            {hasSource
              ? 'Keeps the source — each captured page image plus a searchable text layer.'
              : 'The reading text, paginated as a PDF.'}
          </span>
        </button>
        <button className="save-format" disabled={busy} onClick={() => save('txt')}>
          <span className="sf-title">📄 Text (.txt)</span>
          <span className="sf-desc">
            Just the reading text.{hasSource ? ' The captured page images are not included.' : ''}
          </span>
        </button>
      </div>
      {busy && <p className="settings-note">Building file…</p>}
    </Dialog>
  );
}
