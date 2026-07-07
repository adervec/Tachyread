import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { docToHtml, HTML_AUTHORING_GUIDE, restructurePrompt } from '../document/htmlExport.js';
import { saveTextToFile } from '../features/fileSystem.js';

// Two related HTML helpers: (1) a copyable guide instructing Claude how to structure HTML so it
// imports optimally into Tachyread; (2) "print" the open document (any format) to clean, well-formed
// HTML that follows that guide — read it back here, or hand it to Claude to restructure.
export default function HtmlToolsDialog({ onClose }) {
  const { activeTab, setStatus } = useApp();
  const doc = activeTab?.doc || null;
  const name = (doc?.fileName || 'Document').replace(/\.[^.]+$/, '');
  const [msg, setMsg] = useState('');

  const copy = (text, what) => navigator.clipboard?.writeText(text)
    .then(() => setMsg(`${what} copied to clipboard.`))
    .catch(() => setMsg('Copy failed — select the text and copy manually.'));

  async function exportHtml() {
    if (!doc) return;
    try {
      await saveTextToFile(docToHtml(doc, name), `${name}.html`, 'text/html');
      setStatus(`Exported “${name}” to HTML.`);
      setMsg(`Saved ${name}.html.`);
    } catch (e) { setMsg('Export failed: ' + (e?.message || e)); }
  }

  return (
    <Dialog title="HTML tools" onClose={onClose} width={680} buttons={<button onClick={onClose}>Close</button>}>
      <div className="field-section" style={{ marginTop: 0 }}>Print this document to HTML</div>
      {doc ? (
        <>
          <p className="settings-note" style={{ marginTop: 0 }}>
            Convert the open document (<strong>{doc.fileName}</strong>) — any format — into clean,
            well-structured HTML: one <code>&lt;main&gt;</code>, real headings from its Table of
            Contents, plain paragraphs. Reads perfectly back here, and follows the guide below so
            Claude can restructure it further.
          </p>
          <div className="data-row">
            <button className="toggle-on" onClick={exportHtml}>⬇ Export “{name}” to HTML…</button>
            <button onClick={() => copy(docToHtml(doc, name), 'HTML')}>📋 Copy HTML</button>
            <button onClick={() => copy(restructurePrompt(doc, name), 'Restructure prompt')} title="The guide plus this document's HTML — paste into Claude to get a restructured version back">📋 Copy “restructure with Claude” prompt</button>
          </div>
        </>
      ) : (
        <p className="settings-note" style={{ marginTop: 0 }}>Open a document first to print it to HTML.</p>
      )}

      <div className="field-section">Authoring guide — hand this to Claude</div>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Give this to Claude (in a chat, or an artifact prompt) so the HTML it generates or restructures
        imports cleanly into Tachyread — proper <code>&lt;main&gt;</code>, real headings for the ToC,
        chrome kept out.
      </p>
      <div className="data-row">
        <button className="toggle-on" onClick={() => copy(HTML_AUTHORING_GUIDE, 'Guide')}>📋 Copy guide</button>
        <button onClick={() => saveTextToFile(HTML_AUTHORING_GUIDE, 'tachyread-html-guide.md', 'text/markdown').then(() => setMsg('Saved the guide.')).catch(() => {})}>⬇ Download .md</button>
      </div>
      <textarea className="data-json" readOnly rows={12} value={HTML_AUTHORING_GUIDE} onFocus={(e) => e.target.select()} />
      {msg && <p className="settings-note">{msg}</p>}
    </Dialog>
  );
}
