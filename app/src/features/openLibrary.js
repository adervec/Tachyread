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

// Cover image URL for a book — hotlinks covers.openlibrary.org (only rendered after the user has
// fetched details or the book carries an ISBN, so browsing your library doesn't leak it wholesale).
export function bookCoverUrl(book, size = 'M') {
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
