import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { docToHtml, HTML_AUTHORING_GUIDE, restructurePrompt } from '../document/htmlExport.js';
import { saveTextToFile } from '../features/fileSystem.js';
import { t } from '../i18n.js';

// Two related HTML helpers: (1) a copyable guide instructing Claude how to structure HTML so it
// imports optimally into Tachyread; (2) "print" the open document (any format) to clean, well-formed
// HTML that follows that guide — read it back here, or hand it to Claude to restructure.
export default function HtmlToolsDialog({ onClose }) {
  const { activeTab, setStatus } = useApp();
  const doc = activeTab?.doc || null;
  const name = (doc?.fileName || 'Document').replace(/\.[^.]+$/, '');
  const [msg, setMsg] = useState('');

  const copy = (text, done) => navigator.clipboard?.writeText(text)
    .then(() => setMsg(done))
    .catch(() => setMsg(t('Copy failed — select the text and copy manually.')));

  async function exportHtml() {
    if (!doc) return;
    try {
      await saveTextToFile(docToHtml(doc, name), `${name}.html`, 'text/html');
      setStatus(t('Exported “{name}” to HTML.', { name }));
      setMsg(t('Saved {file}.', { file: `${name}.html` }));
    } catch (e) { setMsg(t('Export failed: {error}', { error: e?.message || e })); }
  }

  return (
    <Dialog title={t('HTML tools')} onClose={onClose} width={680} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <div className="field-section" style={{ marginTop: 0 }}>{t('Print this document to HTML')}</div>
      {doc ? (
        <>
          <p className="settings-note" style={{ marginTop: 0 }}>
            {t('Convert the open document ({file}) — any format — into clean, well-structured HTML: one {main}, real headings from its Table of Contents, plain paragraphs. Reads perfectly back here, and follows the guide below so Claude can restructure it further.', { file: doc.fileName, main: '<main>' })}
          </p>
          <div className="data-row">
            <button className="toggle-on" onClick={exportHtml}>⬇ {t('Export “{name}” to HTML…', { name })}</button>
            <button onClick={() => copy(docToHtml(doc, name), t('HTML copied to clipboard.'))}>📋 {t('Copy HTML')}</button>
            <button onClick={() => copy(restructurePrompt(doc, name), t('Restructure prompt copied to clipboard.'))} title={t("The guide plus this document's HTML — paste into Claude to get a restructured version back")}>📋 {t('Copy “restructure with Claude” prompt')}</button>
          </div>
        </>
      ) : (
        <p className="settings-note" style={{ marginTop: 0 }}>{t('Open a document first to print it to HTML.')}</p>
      )}

      <div className="field-section">{t('Authoring guide — hand this to Claude')}</div>
      <p className="settings-note" style={{ marginTop: 0 }}>
        {t('Give this to Claude (in a chat, or an artifact prompt) so the HTML it generates or restructures imports cleanly into Tachyread — proper {main}, real headings for the ToC, chrome kept out.', { main: '<main>' })}
      </p>
      <div className="data-row">
        <button className="toggle-on" onClick={() => copy(HTML_AUTHORING_GUIDE, t('Guide copied to clipboard.'))}>📋 {t('Copy guide')}</button>
        <button onClick={() => saveTextToFile(HTML_AUTHORING_GUIDE, 'tachyread-html-guide.md', 'text/markdown').then(() => setMsg(t('Saved the guide.'))).catch(() => {})}>⬇ {t('Download {ext}', { ext: '.md' })}</button>
      </div>
      <textarea className="data-json" readOnly rows={12} value={HTML_AUTHORING_GUIDE} onFocus={(e) => e.target.select()} />
      {msg && <p className="settings-note">{msg}</p>}
    </Dialog>
  );
}
