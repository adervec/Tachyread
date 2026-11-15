import { useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import { parseCsv, detectSource, rowToBook, planShelfImport, FILL_LABELS } from '../features/shelfImport.js';
import { saveLibraryBook } from '../state/storage.js';
import { SHELF_PROMPT, parseShelfReply, shelfBooks, photoToBase64 } from '../features/shelfPhoto.js';
import { askClaude } from '../features/anthropic.js';
import { t } from '../i18n.js';

// Trackyread → Data: import a Goodreads or StoryGraph CSV export. Every row is planned first (new
// book / fill blanks on a match / nothing to add) and shown for review; only ticked rows are written,
// and a match never has anything you've recorded overwritten.
const ACTION = { new: `＋ ${t('New book')}`, fill: `✎ ${t('Fill blanks')}`, same: `= ${t('Already there')}` };
// The status filter's values stay English (they are compared); only the shown labels translate.
const STATUS = { read: t('read'), reading: t('reading'), abandoned: t('abandoned'), 'to read': t('to read') };

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
      if (!source) { setMsg(t('That CSV doesn’t look like a Goodreads or StoryGraph export.')); return; }
      const p = planShelfImport(rows.map((r) => rowToBook(r, source)), books || []).map((x, i) => ({ ...x, key: i }));
      setSrc(source === 'goodreads' ? 'Goodreads' : 'StoryGraph');
      setPlan(p);
      setPicked(new Set(p.filter((x) => x.action !== 'same').map((x) => x.key)));
      setMsg('');
    } catch (err) { setMsg(t('Couldn’t read that file: {error}', { error: err?.message || err })); }
  }
  // Shelf photo: Claude lists the spines it can read; they go through the same review table.
  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!apiKey) { setMsg(t('Add your Anthropic API key in Application Settings to read shelf photos.')); return; }
    setBusy(true); setMsg(t('Reading the spines…'));
    try {
      const data = await photoToBase64(file);
      const reply = await askClaude([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text: SHELF_PROMPT }] }], { key: apiKey, model, maxTokens: 2000, source: 'shelf-photo' });
      const found = parseShelfReply(reply);
      if (!found.length) { setMsg(t('No readable titles in that photo — try closer, straighter, or in better light.')); setBusy(false); return; }
      const p = planShelfImport(shelfBooks(found), books || []).map((x, i) => ({ ...x, key: i }));
      setSrc(t('the shelf photo')); setPlan(p);
      setPicked(new Set(p.filter((x) => x.action !== 'same').map((x) => x.key)));
      setMsg(t.n('Read {n} title — check it before importing (spines can be misread).', 'Read {n} titles — check them before importing (spines can be misread).', found.length));
    } catch (err) { setMsg(t('Couldn’t read the photo: {error}', { error: err?.message || err })); }
    setBusy(false);
  }
  async function apply() {
    setBusy(true);
    const rows = plan.filter((x) => picked.has(x.key) && x.action !== 'same');
    for (const x of rows) await saveLibraryBook(x.book); // eslint-disable-line no-await-in-loop
    setBusy(false);
    setMsg(t('Imported from {source}: {added} new, {filled} filled in.', { source: src, added: rows.filter((x) => x.action === 'new').length, filled: rows.filter((x) => x.action === 'fill').length }));
    setPlan(null);
    onDone?.();
  }

  return (
    <div className="shelf-import">
      <p className="settings-note">{t('Goodreads: My Books → Import and export → Export Library. StoryGraph: Manage account → Export StoryGraph library. Matching books only get their empty fields filled — your ratings, dates and notes are never overwritten.')}</p>
      <label className="lj-inline"><span>{t('CSV file')}</span><input type="file" accept=".csv,text/csv" onChange={onFile} /></label>
      <label className="lj-inline" title={t('Claude reads the book spines in the photo (your own API key; only the downscaled photo is sent). Every title is shown for review before anything is added.')}>
        <span>📷 {t('Shelf photo')}</span><input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={busy} />
        {!apiKey && <span className="lj-qdim">{t('(needs an Anthropic API key)')}</span>}
      </label>
      {msg && <p className="settings-note" role="status">{msg}</p>}
      {plan && (
        <>
          <p className="settings-note">{t.n('{source}: {n} row — {added} new, {fill} to fill in, {same} already there.', '{source}: {n} rows — {added} new, {fill} to fill in, {same} already there.', plan.length, { source: src, added: plan.filter((x) => x.action === 'new').length, fill: plan.filter((x) => x.action === 'fill').length, same: plan.filter((x) => x.action === 'same').length })}</p>
          <DataTable stateKey="shelf-import" rows={plan} rowKey={(x) => x.key} maxRows={2000}
            lead={{ header: '', cell: (x) => x.action === 'same' ? '' : <input type="checkbox" checked={picked.has(x.key)} aria-label={t('Import {title}', { title: x.book.title })} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(x.key)) n.delete(x.key); else n.add(x.key); return n; })} /> }}
            toolbar={(vis) => (<>
              <button onClick={() => setPicked((s) => new Set([...s, ...vis.filter((x) => x.action !== 'same').map((x) => x.key)]))}>{t('Tick shown')}</button>
              <button onClick={() => setPicked((s) => { const n = new Set(s); vis.forEach((x) => n.delete(x.key)); return n; })}>{t('Untick shown')}</button>
            </>)}
            columns={[
              { key: 'action', label: t('Action'), type: 'select', get: (x) => x.action, render: (x) => ACTION[x.action], options: Object.entries(ACTION) },
              { key: 'title', label: t('Title'), type: 'text', get: (x) => x.book.title || '' },
              { key: 'author', label: t('Author'), type: 'text', get: (x) => x.book.author || '' },
              { key: 'status', label: t('Status'), type: 'select', get: (x) => (x.book.completion ? 'read' : x.book.inProgress ? 'reading' : x.book.shelf === 'abandoned' ? 'abandoned' : 'to read'), render: (x) => STATUS[x.book.completion ? 'read' : x.book.inProgress ? 'reading' : x.book.shelf === 'abandoned' ? 'abandoned' : 'to read'], options: Object.entries(STATUS) },
              { key: 'fills', label: t('Adds'), type: 'text', get: (x) => (x.action === 'new' ? t('everything') : x.fills.map((k) => FILL_LABELS[k] || k).join(', ')) },
            ]} />
          <div className="lj-inline">
            <button className="toggle-on" disabled={busy || !picked.size} onClick={apply}>{t('Import {n} ticked', { n: picked.size })}</button>
            <button onClick={() => setPlan(null)}>{t('Cancel')}</button>
          </div>
        </>
      )}
    </div>
  );
}
