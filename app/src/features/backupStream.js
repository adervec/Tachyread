// Full backups written and read ONE RECORD AT A TIME. The old backup built one object of every
// store and JSON.stringify'd it in one go — a library with audiobook audio passes the browser's
// maximum string length (~512 MB in Chrome) and the export dies with "Invalid string length";
// restoring read the whole file into one string with the same limit.
//
// The file is still one valid JSON document (old-style restores of small backups keep working),
// laid out one record per line so it can be streamed:
//   {"app":"tachyread","version":2,…,"local":{…},        ← header line (ends with a comma)
//   "db":{
//   "files":{"inline":true,"rows":[                      ← store line
//   {…record…},                                           ← one record per line
//   {…record…}
//   ]},
//   "global":{"inline":false,"entries":[
//   {"key":…,"value":…}
//   ]}
//   }}

export const BACKUP_VERSION = 2;

// header: { app, version, dbVersion, exportedAt, local }. stores: [{ name, inline, records }] where
// `records` is an async iterable of already-packed records. write(str) appends to the output.
// Returns per-store { count, bytes } (bytes ≈ characters written) so the UI can say what's big.
export async function writeBackup({ header, stores, write }) {
  const sizes = {};
  await write(JSON.stringify(header).slice(0, -1) + ',\n"db":{\n');
  for (let si = 0; si < stores.length; si++) {
    const { name, inline, records } = stores[si];
    await write(`${si ? ',\n' : ''}${JSON.stringify(name)}:{"inline":${inline},"${inline ? 'rows' : 'entries'}":[\n`);
    let count = 0, bytes = 0;
    for await (const rec of records) {
      const line = (count ? ',\n' : '') + JSON.stringify(rec);
      await write(line);
      count++; bytes += line.length;
    }
    await write('\n]}');
    sizes[name] = { count, bytes };
  }
  await write('\n}}\n');
  return sizes;
}

// A backup in this streamable layout? (Its first line is the header, ending with a comma.)
export const isStreamableHeader = (firstLine) => /^\{"app":"tachyread",/.test(firstLine || '') && /,\s*$/.test(firstLine || '');

// lines: async iterable of the file's lines. Calls onStore(name, inline) as each store starts and
// onRecord(name, inline, record) per record (await-ed, so the caller can batch writes). Returns the
// header ({ app, version, dbVersion, exportedAt, local }).
export async function readBackup(lines, { onStore = async () => {}, onRecord = async () => {} } = {}) {
  let header = null, store = null, inline = false;
  for await (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (!header) {
      if (!isStreamableHeader(t)) throw new Error('Not a streamable Tachyread backup.');
      header = JSON.parse(t.replace(/,\s*$/, '') + '}');
      continue;
    }
    if (t === '"db":{') continue;
    if (t === ']}' || t === ']},') { store = null; continue; }
    if (t === '}}') break;
    const m = /^("(?:[^"\\]|\\.)*"):\{"inline":(true|false),"(?:rows|entries)":\[$/.exec(t);
    if (m) { store = JSON.parse(m[1]); inline = m[2] === 'true'; await onStore(store, inline); continue; }
    if (store) await onRecord(store, inline, JSON.parse(t.replace(/,\s*$/, '')));
  }
  if (!header) throw new Error('Empty backup file.');
  return header;
}

// A File/Blob as an async iterable of lines, decoded as it streams (never one big string).
export async function* blobLines(blob) {
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { yield buf.slice(0, nl); buf = buf.slice(nl + 1); }
  }
  if (buf) yield buf;
}
