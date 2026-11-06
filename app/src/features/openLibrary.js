// Open Library metadata lookup for tracker books. Fetches happen only on an explicit user click
// (privacy: the query sends the book's title/author — or ISBN — to openlibrary.org). Pure helpers
// here except olFetch; see openLibrary.demo.mjs.

const clean = (s) => String(s || '').trim();

// Search URL: ISBN when we have one (exact identity), else title+author fielded search.
export function olSearchUrl(book) {
  const isbn = clean(book?.isbn).replace(/[^0-9xX]/g, '');
  const base = 'https://openlibrary.org/search.json?limit=5&fields=title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,key';
  if (isbn.length >= 10) return `${base}&q=isbn:${isbn}`;
  const t = clean(book?.title), a = clean(book?.author);
  if (!t) return null;
  return `${base}&title=${encodeURIComponent(t)}${a ? `&author=${encodeURIComponent(a)}` : ''}`;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

// Pick the search doc that actually matches the book: title tokens must overlap strongly, and the
// author's last name must appear when we know it. Guards against grabbing a same-titled other book.
export function pickOlMatch(json, book) {
  const docs = json?.docs || [];
  const wantT = new Set(norm(book?.title).split(' ').filter(Boolean));
  const lastName = norm(book?.author).split(' ').filter(Boolean).pop() || '';
  let best = null, bestScore = 0;
  for (const d of docs) {
    const got = norm(d.title).split(' ').filter(Boolean);
    if (!got.length || !wantT.size) continue;
    const overlap = got.filter((w) => wantT.has(w)).length / Math.max(wantT.size, got.length);
    if (overlap < 0.5) continue;
    const authorOk = !lastName || (d.author_name || []).some((a) => norm(a).includes(lastName));
    if (!authorOk) continue;
    const score = overlap + (d.cover_i ? 0.1 : 0) + (d.number_of_pages_median ? 0.1 : 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

// Patch = the fields the match can add. Blanks-only: never overwrites what the user already has.
export function olPatch(book, doc) {
  if (!doc) return {};
  const p = {};
  if (!book.pages && doc.number_of_pages_median) p.pages = doc.number_of_pages_median;
  if (!book.pubDate && doc.first_publish_year) p.pubDate = String(doc.first_publish_year);
  if (!clean(book.isbn) && doc.isbn?.length) p.isbn = doc.isbn[0];
  if (!book.coverId && doc.cover_i) p.coverId = doc.cover_i;
  if (!clean(book.author) && doc.author_name?.length) p.author = doc.author_name[0];
  return p;
}

// Cover image URL for a book — a user-set custom URL wins; otherwise hotlinks covers.openlibrary.org
// (only rendered after the user has fetched details or the book carries an ISBN, so browsing your
// library doesn't leak it wholesale).
export function bookCoverUrl(book, size = 'M') {
  if (clean(book?.coverUrl)) return book.coverUrl;
  if (book?.coverId) return `https://covers.openlibrary.org/b/id/${book.coverId}-${size}.jpg`;
  const isbn = clean(book?.isbn).replace(/[^0-9xX]/g, '');
  if (isbn.length >= 10) return `https://covers.openlibrary.org/b/isbn/${isbn}-${size}.jpg`;
  return null;
}

// The one impure call: search Open Library and return { doc, patch } (or throw on network/HTTP error).
export async function olFetch(book) {
  const url = olSearchUrl(book);
  if (!url) throw new Error('Needs a title or ISBN to search.');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open Library: HTTP ${r.status}`);
  const doc = pickOlMatch(await r.json(), book);
  return { doc, patch: doc ? olPatch(book, doc) : {} };
}

// ── Add by ISBN (typed or scanned) ────────────────────────────────────────────────────────────────
// ISBN-10 / ISBN-13 checksum check (a camera misread or a non-book EAN fails it). Returns the clean
// digits, or null.
export function validIsbn(raw) {
  const s = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13 && /^97[89]\d{10}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((a, d, i) => a + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    return sum % 11 === 0 ? s : null;
  }
  return null;
}

// An ISBN search result → a new tracker book (to-read), or null when Open Library doesn't know it.
export function isbnBook(json, isbn) {
  const d = json?.docs?.[0];
  if (!d?.title) return null;
  const b = { title: d.title, author: d.author_name?.[0] || '', isbn, fnf: 'F', type: 'long', genre: '' };
  if (d.number_of_pages_median) b.pages = d.number_of_pages_median;
  if (d.first_publish_year) b.pubDate = String(d.first_publish_year);
  if (d.cover_i) b.coverId = d.cover_i;
  return b;
}
export async function lookupIsbn(raw) {
  const isbn = validIsbn(raw);
  if (!isbn) throw new Error('That isn’t a valid ISBN (check the digits).');
  const r = await fetch(olSearchUrl({ isbn }));
  if (!r.ok) throw new Error(`Open Library: HTTP ${r.status}`);
  return isbnBook(await r.json(), isbn);
}
