import { useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import { parseCsv, detectSource, rowToBook, planShelfImport } from '../features/shelfImport.js';
import { saveLibraryBook } from '../state/storage.js';
import { SHELF_PROMPT, parseShelfReply, shelfBooks, photoToBase64 } from '../features/shelfPhoto.js';
import { askClaude } from '../features/anthropic.js';

// Trackyread → Data: import a Goodreads or StoryGraph CSV export. Every row is planned first (new
// book / fill blanks on a match / nothing to add) and shown for review; only ticked rows are written,
// and a match never has anything you've recorded overwritten.
const ACTION = { new: '＋ New book', fill: '✎ Fill blanks', same: '= Already there' };

export default function ShelfImportPanel({ books, onDone, apiKey = '', model = 'claude-sonnet-5' }) {
  const [plan, setPlan] = useState(null);
  const [src, setSrc] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      const source = detectSource(rows);
      if (!source) { setMsg('That CSV doesn’t look like a Goodreads or StoryGraph export.'); return; }
      const p = planShelfImport(rows.map((r) => rowToBook(r, source)), books || []).map((x, i) => ({ ...x, key: i }));
      setSrc(source === 'goodreads' ? 'Goodreads' : 'StoryGraph');
      setPlan(p);
      setPicked(new Set(p.filter((x) => x.action !== 'same').map((x) => x.key)));
      setMsg('');
    } catch (err) { setMsg(`Couldn’t read that file: ${err?.message || err}`); }
  }
  // Shelf photo: Claude lists the spines it can read; they go through the same review table.
  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!apiKey) { setMsg('Add your Anthropic API key in Application Settings to read shelf photos.'); return; }
    setBusy(true); setMsg('Reading the spines…');
    try {
      const data = await photoToBase64(file);
      const reply = await askClaude([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text: SHELF_PROMPT }] }], { key: apiKey, model, maxTokens: 2000, source: 'shelf-photo' });
      const found = parseShelfReply(reply);
      if (!found.length) { setMsg('No readable titles in that photo — try closer, straighter, or in better light.'); setBusy(false); return; }
      const p = planShelfImport(shelfBooks(found), books || []).map((x, i) => ({ ...x, key: i }));
      setSrc('the shelf photo'); setPlan(p);
      setPicked(new Set(p.filter((x) => x.action !== 'same').map((x) => x.key)));
      setMsg(`Read ${found.length} title(s) — check them before importing (spines can be misread).`);
    } catch (err) { setMsg(`Couldn’t read the photo: ${err?.message || err}`); }
    setBusy(false);
  }
  async function apply() {
    setBusy(true);
    const rows = plan.filter((x) => picked.has(x.key) && x.action !== 'same');
    for (const x of rows) await saveLibraryBook(x.book); // eslint-disable-line no-await-in-loop
    setBusy(false);
    setMsg(`Imported from ${src}: ${rows.filter((x) => x.action === 'new').length} new book(s), ${rows.filter((x) => x.action === 'fill').length} filled in.`);
    setPlan(null);
    onDone?.();
  }

  return (
    <div className="shelf-import">
      <p className="settings-note">Goodreads: My Books → Import and export → <i>Export Library</i>. StoryGraph: Manage account → <i>Export StoryGraph library</i>. Matching books only get their <b>empty</b> fields filled — your ratings, dates and notes are never overwritten.</p>
      <label className="lj-inline"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={onFile} /></label>
      <label className="lj-inline" title="Claude reads the book spines in the photo (your own API key; only the downscaled photo is sent). Every title is shown for review before anything is added.">
        <span>📷 Shelf photo</span><input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={busy} />
        {!apiKey && <span className="lj-qdim">(needs an Anthropic API key)</span>}
      </label>
      {msg && <p className="settings-note" role="status">{msg}</p>}
      {plan && (
        <>
          <p className="settings-note">{src}: {plan.length} rows — {plan.filter((x) => x.action === 'new').length} new, {plan.filter((x) => x.action === 'fill').length} to fill in, {plan.filter((x) => x.action === 'same').length} already there.</p>
          <DataTable stateKey="shelf-import" rows={plan} rowKey={(x) => x.key} maxRows={2000}
            lead={{ header: '', cell: (x) => x.action === 'same' ? '' : <input type="checkbox" checked={picked.has(x.key)} aria-label={`Import ${x.book.title}`} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(x.key)) n.delete(x.key); else n.add(x.key); return n; })} /> }}
            toolbar={(vis) => (<>
              <button onClick={() => setPicked((s) => new Set([...s, ...vis.filter((x) => x.action !== 'same').map((x) => x.key)]))}>Tick shown</button>
              <button onClick={() => setPicked((s) => { const n = new Set(s); vis.forEach((x) => n.delete(x.key)); return n; })}>Untick shown</button>
            </>)}
            columns={[
              { key: 'action', label: 'Action', type: 'select', get: (x) => x.action, render: (x) => ACTION[x.action], options: Object.entries(ACTION) },
              { key: 'title', label: 'Title', type: 'text', get: (x) => x.book.title || '' },
              { key: 'author', label: 'Author', type: 'text', get: (x) => x.book.author || '' },
              { key: 'status', label: 'Status', type: 'select', get: (x) => (x.book.completion ? 'read' : x.book.inProgress ? 'reading' : x.book.shelf === 'abandoned' ? 'abandoned' : 'to read'), options: [['read', 'read'], ['reading', 'reading'], ['abandoned', 'abandoned'], ['to read', 'to read']] },
              { key: 'fills', label: 'Adds', type: 'text', get: (x) => (x.action === 'new' ? 'everything' : x.fills.join(', ')) },
            ]} />
          <div className="lj-inline">
            <button className="toggle-on" disabled={busy || !picked.size} onClick={apply}>Import {picked.size} ticked</button>
            <button onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
