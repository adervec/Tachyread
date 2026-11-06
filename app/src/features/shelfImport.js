// Goodreads / StoryGraph library import. Both export a CSV; we map each row onto a Trackyread book
// and plan it against the library BEFORE anything is written: a row matching an existing book (by
// ISBN, else title + author) only FILLS fields that book has empty — nothing you've recorded is
// overwritten — and unmatched rows become new books. The caller shows the plan for review.
import { deriveId, slug } from './journeyLibrary.js';

// RFC-4180-ish CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, ''); // byte-order mark
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const isbnOf = (v) => String(v || '').replace(/^="?|"$/g, '').replace(/[^0-9Xx]/g, '');
const ymd = (v) => { const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(v || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };

export function detectSource(rows) {
  const h = Object.keys(rows[0] || {});
  if (h.includes('Exclusive Shelf') || h.includes('Bookshelves')) return 'goodreads';
  if (h.includes('Read Status') || h.includes('Star Rating')) return 'storygraph';
  return null;
}

// One CSV row → a Trackyread book (only the fields the row actually has).
export function rowToBook(r, source) {
  const b = { source };
  const put = (k, v) => { if (v != null && v !== '' && !(typeof v === 'number' && !v)) b[k] = v; };
  if (source === 'goodreads') {
    put('title', r.Title);
    put('author', r.Author);
    put('isbn', isbnOf(r.ISBN13) || isbnOf(r.ISBN));
    put('rating', Number(r['My Rating']) || 0);
    put('pages', Number(r['Number of Pages']) || 0);
    put('pubYear', Number(r['Original Publication Year'] || r['Year Published']) || 0);
    const shelf = (r['Exclusive Shelf'] || '').toLowerCase();
    if (shelf === 'read') { b.completion = true; put('finishTime', ymd(r['Date Read'])); }
    else if (shelf === 'currently-reading') b.inProgress = true;
    else if (/did-?not-?finish|dnf|abandon/.test(shelf)) b.shelf = 'abandoned';
    const tags = (r.Bookshelves || '').split(',').map((t) => t.trim()).filter((t) => t && !['read', 'to-read', 'currently-reading'].includes(t));
    if (tags.length) b.tags = tags;
    put('notes', [r['My Review'], r['Private Notes']].filter(Boolean).join('\n\n'));
  } else {
    put('title', r.Title);
    put('author', (r.Authors || '').split(',')[0].trim());
    put('isbn', isbnOf(r['ISBN/UID']).length >= 10 ? isbnOf(r['ISBN/UID']) : '');
    put('rating', Number(r['Star Rating']) || 0);
    const st = (r['Read Status'] || '').toLowerCase();
    // "Dates Read": "2021/03/01-2021/03/20, 2024/01/02-2024/02/01" — the last range is the current
    // finish, earlier ones go to finishHistory (re-reads).
    const ends = (r['Dates Read'] || '').split(',').map((x) => ymd(x.split('-').pop())).filter(Boolean);
    if (st === 'read') { b.completion = true; put('finishTime', ends.at(-1) || ymd(r['Last Date Read'])); if (ends.length > 1) b.finishHistory = ends.slice(0, -1); }
    else if (st === 'currently-reading') b.inProgress = true;
    else if (st === 'did-not-finish') b.shelf = 'abandoned';
    const tags = (r.Tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) b.tags = tags;
    put('notes', r.Review);
  }
  b.id = deriveId(b);
  return b;
}

const FILLABLE = ['author', 'isbn', 'rating', 'pages', 'pubYear', 'finishTime', 'notes', 'tags', 'finishHistory'];
const blank = (v) => v == null || v === '' || v === 0 || (Array.isArray(v) && !v.length);
const key = (b) => `${slug(b.title)}|${slug(String(b.author || '').split(/\s+/).pop())}`; // title + author surname

// → [{ action: 'new' | 'fill' | 'same', book (what would be saved), match?, fills: [field] }]
export function planShelfImport(incoming, library) {
  const byId = new Map(library.filter((b) => !b.deleted).map((b) => [b.id, b]));
  const byKey = new Map(library.filter((b) => !b.deleted).map((b) => [key(b), b]));
  return incoming.filter((b) => b.title).map((b) => {
    const match = byId.get(b.id) || byKey.get(key(b));
    if (!match) return { action: 'new', book: { ...b, addedAt: Date.now() }, fills: [] };
    const fills = FILLABLE.filter((k) => !blank(b[k]) && blank(match[k]));
    const status = {};
    const st = (x) => (x.completion ? 'read' : x.inProgress ? 'reading' : x.shelf === 'abandoned' ? 'dnf' : 'none');
    if (st(match) === 'none' && st(b) !== 'none') { // only an unset status is filled in
      Object.assign(status, { completion: b.completion, inProgress: b.inProgress, shelf: b.shelf });
      fills.push('status');
    }
    if (!fills.length) return { action: 'same', book: match, match, fills };
    const patch = Object.fromEntries(fills.filter((k) => k !== 'status').map((k) => [k, b[k]]));
    return { action: 'fill', book: { ...match, ...patch, ...status }, match, fills };
  });
}
