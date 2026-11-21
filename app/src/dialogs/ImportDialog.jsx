import Dialog from './Dialog.jsx';
import { t, fmtNum } from '../i18n.js';

// Import wizard: live phase + progress bar while a document parses, then a summary card showing
// what was detected (words, sections, TOC) with suggested next steps — so it's always clear the
// document imported correctly and what processing is worth running.
export default function ImportDialog({ imp, onClose, onAction }) {
  if (!imp) return null;

  // `complete` is the "import finished, show the summary" flag; `done`/`total` are the live progress
  // counts a parser streams (PDF pages, EPUB sections). They're distinct — a numeric `done` must NOT
  // be read as completion, or a mid-parse progress tick would render the summary before it's ready.
  if (!imp.complete) {
    const frac = imp.total ? Math.min(1, (imp.done || 0) / imp.total) : null;
    return (
      <Dialog title={t('Importing {file}', { file: imp.fileName })} onClose={() => {}} width={460} dismissable={false}>
        <div className="imp-phase">{imp.phase}{imp.total ? ` — ${imp.done} / ${imp.total}` : '…'}</div>
        <div className={`imp-bar${frac == null ? ' indet' : ''}`}>
          <div className="imp-fill" style={frac != null ? { width: `${frac * 100}%` } : undefined} />
        </div>
        <p className="settings-note">{t('Parsing happens entirely on this device.')}</p>
      </Dialog>
    );
  }

  const tocLine = imp.exactToc
    ? `✓ ${t.n("Table of contents: {n} section from the document's own headings", "Table of contents: {n} sections from the document's own headings", imp.tocCount)}`
    : `· ${t('No built-in headings found — the ToC wizard can detect chapters from the text')}`;
  return (
    <Dialog
      title={t('Imported {file}', { file: imp.fileName })}
      onClose={onClose}
      width={480}
      buttons={<button className="toggle-on" onClick={onClose}>▶ {t('Start reading')}</button>}
    >
      <ul className="imp-summary">
        <li>✓ {t('{words} words · {lines} lines', { words: fmtNum(imp.words ?? 0), lines: fmtNum(imp.lines ?? 0) })}</li>
        <li>{imp.hasSource ? `✓ ${t.n('Original source view available ({n} section, synced to your position)', 'Original source view available ({n} sections, synced to your position)', imp.sections)}` : `· ${t('No original-layout view for this format (plain text)')}`}</li>
        <li>{tocLine}</li>
      </ul>
      <div className="imp-suggest">
        <span className="imp-suggest-label">{t('Suggested processing:')}</span>
        {!imp.exactToc && (
          <button onClick={() => { onClose(); onAction('toc-wizard'); }} title={t('Detect chapter headings from the text')}>📖 {t('Generate Contents…')}</button>
        )}
        <button onClick={() => { onClose(); onAction('names-wizard'); }} title={t('Collect proper names so the reader can dwell on them')}>🧑 {t('Proper Names…')}</button>
        <button onClick={() => { onClose(); onAction('notes-wizard'); }} title={t('Find footnote markers for the footnote preview')}>📎 {t('Footnotes…')}</button>
      </div>
      <p className="settings-note">
        {t("All of these can be run later from the Tools menu; the ToC is editable any time from the ToC pane's ✎ Edit.")}
      </p>
    </Dialog>
  );
}
