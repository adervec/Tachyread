import Dialog from './Dialog.jsx';

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
      <Dialog title={`Importing ${imp.fileName}`} onClose={() => {}} width={460} dismissable={false}>
        <div className="imp-phase">{imp.phase}{imp.total ? ` — ${imp.done} / ${imp.total}` : '…'}</div>
        <div className={`imp-bar${frac == null ? ' indet' : ''}`}>
          <div className="imp-fill" style={frac != null ? { width: `${frac * 100}%` } : undefined} />
        </div>
        <p className="settings-note">Parsing happens entirely on this device.</p>
      </Dialog>
    );
  }

  const tocLine = imp.exactToc
    ? `✓ Table of contents: ${imp.tocCount} sections from the document's own headings`
    : '· No built-in headings found — the ToC wizard can detect chapters from the text';
  return (
    <Dialog
      title={`Imported ${imp.fileName}`}
      onClose={onClose}
      width={480}
      buttons={<button className="toggle-on" onClick={onClose}>▶ Start reading</button>}
    >
      <ul className="imp-summary">
        <li>✓ {(imp.words ?? 0).toLocaleString()} words · {(imp.lines ?? 0).toLocaleString()} lines</li>
        <li>{imp.hasSource ? `✓ Original source view available (${imp.sections} section${imp.sections === 1 ? '' : 's'}, synced to your position)` : '· No original-layout view for this format (plain text)'}</li>
        <li>{tocLine}</li>
      </ul>
      <div className="imp-suggest">
        <span className="imp-suggest-label">Suggested processing:</span>
        {!imp.exactToc && (
          <button onClick={() => { onClose(); onAction('toc-wizard'); }} title="Detect chapter headings from the text">📖 Generate Contents…</button>
        )}
        <button onClick={() => { onClose(); onAction('names-wizard'); }} title="Collect proper names so the reader can dwell on them">🧑 Proper Names…</button>
        <button onClick={() => { onClose(); onAction('notes-wizard'); }} title="Find footnote markers for the footnote preview">📎 Footnotes…</button>
      </div>
      <p className="settings-note">
        All of these can be run later from the <strong>Tools</strong> menu; the ToC is editable any
        time from the ToC pane's ✎ Edit.
      </p>
    </Dialog>
  );
}
