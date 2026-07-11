// Pure helpers for the Literary Journey reading tracker: normalize an imported library.json into the
// per-book envelope the store merges, and the filter / sort / stats / export logic behind the Library
// and Dashboard views (ported from the standalone index.html tracker). No storage/React imports here
// so it stays trivially testable — see journeyLibrary.demo.mjs.

export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Stable id so re-imports and cross-device merges land on the same book. ISBN when present (the real
// identity), else author|title. A book with no title at all falls back to a content slug.
export function deriveId(b) {
  const isbn = String(b.isbn || '').replace(/[^0-9xX]/g, '');
  if (isbn.length >= 10) return `isbn:${isbn.toLowerCase()}`;
  const t = slug(b.title);
  if (t) return `bk:${slug(b.author)}|${t}`;
  return `bk:anon|${slug(JSON.stringify(b)).slice(0, 24)}`;
}

// Difficulty comes as either a level (1–5) or a label like "5 — Formidable".
export function parseDifficulty(d) {
  if (typeof d === 'number') return d;
  const m = String(d ?? '').match(/[1-5]/);
  return m ? parseInt(m[0], 10) : null;
}

// pubDate may be a year, an ISO date, or free text ("March 1997", "-380"). Pull the first year.
export function pubYear(b) {
  const v = b?.pubDate ?? b?.pubYear;
  if (v == null || v === '') return null;
  const m = String(v).match(/-?\d{1,4}/);
  return m ? parseInt(m[0], 10) : null;
}

// finishTime as epoch ms (accepts a number or a parseable date string); null when unknown.
export function finishMs(b) {
  const v = b?.finishTime;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// Reading lifecycle. `completion`/`inProgress` are the original sources of truth (finished/reading);
// `shelf` is the newer explicit slot for the two states they can't express: 'queue' (shortlisted /
// on-deck, pulled out of the vast to-read pile) and 'abandoned' (started-then-dropped, i.e. DNF /
// reshelved). Anything with none of these is a plain 'toread' recommendation.
export function readStatus(b) {
  if (b?.shelf === 'abandoned') return 'abandoned';   // an explicit DNF wins even if a date lingers
  if (b?.completion === true) return 'finished';
  if (b?.inProgress) return 'reading';                // actively reading now (e.g. a re-read) beats a stale date
  if (b?.shelf === 'queue') return 'queue';
  // Some library.json records carry a completion DATE without the completion flag set — a finished
  // book that never got ticked. Treat the date as the finish it plainly is (fallback, so explicit
  // states above still win).
  if (finishMs(b) != null) return 'finished';
  return 'toread';
}

export const READ_STATUSES = ['reading', 'queue', 'toread', 'finished', 'abandoned'];

// Content categories — each gets its own queue. `type` historically held 'long'/'short' (from the
// library.json longForm/shortForm split); the vocabulary now covers more shapes of reading.
export const CONTENT_TYPES = {
  long: 'Long-form',
  short: 'Short-form',
  article: 'Articles',
  'ai-gen': 'AI-generated',
  poetry: 'Poetry',
  reference: 'Reference',
  other: 'Other',
};
// A book's content category (untyped legacy records read as long-form books).
export function contentType(b) {
  return CONTENT_TYPES[b?.type] ? b.type : 'long';
}
export const STATUS_LABEL = { finished: '✅ Finished', reading: '📖 Reading', queue: '📋 On deck', toread: '· To read', abandoned: '✕ Abandoned' };

// Pure status setter — clears the fields a status doesn't own so transitions never leave a book in two
// states at once (e.g. abandoning something you were reading clears inProgress). `today` is injected
// so this stays free of Date; the caller stamps a finish date when none is given.
export function setReadStatus(b, status, today = null) {
  const base = { ...b, completion: false, inProgress: false, shelf: null };
  if (status === 'finished') return { ...base, completion: true, finishTime: b.finishTime || today || undefined };
  if (status === 'reading') return { ...base, inProgress: true };
  if (status === 'queue') return { ...base, shelf: 'queue' };
  if (status === 'abandoned') return { ...base, shelf: 'abandoned' };
  return base; // toread
}

// Who recommended this book. The seed library.json is entirely Claude's picks and carries no attribution,
// so a missing recBy reads as 'Claude'; books the user adds set recBy explicitly (the editor defaults it).
export const DEFAULT_RECOMMENDER = 'Claude';
export function recommender(b) { return (b?.recBy && String(b.recBy).trim()) || DEFAULT_RECOMMENDER; }

export function bookRating(b) {
  return Number(b?.rating) || Number(b?.stars) || 0;
}

function normalizeBook(b, type) {
  return { ...b, id: deriveId(b), type, difficultyLevel: b.difficultyLevel ?? parseDifficulty(b.difficulty) };
}

// Turn a raw library.json ({meta, longForm, shortForm, authors, genres, subgenres}) — or an already
// wrapped tracker envelope — into the { protocol, books:[…with id/type], refs } bundle importLibraryData
// expects. de-dupes by id (last wins).
export function normalizeSeed(raw) {
  if (raw && raw.protocol === 'tachyread-journey') return raw;
  const long = raw.longForm || raw.long || [];
  const short = raw.shortForm || raw.short || [];
  const map = new Map();
  for (const b of long) { const n = normalizeBook(b, 'long'); map.set(n.id, n); }
  for (const b of short) { const n = normalizeBook(b, 'short'); map.set(n.id, n); }
  return {
    protocol: 'tachyread-journey', protocolVersion: 1, kind: 'library', generatedAt: Date.now(),
    meta: raw.meta || null, books: [...map.values()],
    authors: raw.authors || null, genres: raw.genres || null, subgenres: raw.subgenres || null,
  };
}

export function distinctValues(books, field) {
  return [...new Set(books.map((b) => b[field]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

// A book's user tags, normalized. Accepts an array or the editor's comma-separated string.
export function bookTags(b) {
  const raw = b?.tags;
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))];
}
export function allTags(books) {
  return [...new Set((books || []).flatMap(bookTags))].sort((a, b) => a.localeCompare(b));
}

// Re-reads: `finishHistory` keeps every PRIOR finish date; `finishTime` is always the latest one.
export function finishCount(b) {
  return (readStatus(b) === 'finished' ? 1 : 0) + (Array.isArray(b?.finishHistory) ? b.finishHistory.length : 0);
}
// Log a re-read: the current finish date moves into history, today becomes the finish. Pure.
export function logReread(b, today) {
  const hist = [...(Array.isArray(b.finishHistory) ? b.finishHistory : []), b.finishTime].filter(Boolean);
  return { ...b, finishHistory: hist, finishTime: today, completion: true, inProgress: false, shelf: null };
}

// readState: all | finished | reading | toread(=unread) · fnf: all|F|NF · difficulty: array of levels
// (empty = any) · recMin: recScore floor · genre: exact | all · search: title/author/series substring
// · tag: exact user tag | all.
export function filterBooks(books, f = {}) {
  const { readState = 'all', fnf = 'all', difficulty = [], recMin = 0, genre = 'all', search = '', recBy = 'all', tag = 'all', ctype = 'all' } = f;
  const q = search.trim().toLowerCase();
  const diffSet = difficulty && difficulty.length ? new Set(difficulty.map(Number)) : null;
  return books.filter((b) => {
    if (readState !== 'all') {
      const st = readStatus(b);
      if (readState === 'unread' ? st !== 'toread' : st !== readState) return false;
    }
    if (fnf !== 'all' && (b.fnf || '') !== fnf) return false;
    if (diffSet && !diffSet.has(Number(b.difficultyLevel))) return false;
    if (recMin && !(Number(b.recScore) >= recMin)) return false;
    if (genre !== 'all' && (b.genre || '') !== genre) return false;
    if (recBy !== 'all' && recommender(b) !== recBy) return false;
    if (tag !== 'all' && !bookTags(b).includes(tag)) return false;
    if (ctype !== 'all' && contentType(b) !== ctype) return false;
    if (q && !`${b.title || ''} ${b.author || ''} ${b.series || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function sortBooks(books, key = 'rec') {
  const num = (v) => (v == null || v === '' ? -Infinity : Number(v));
  const cmp = {
    rec: (a, b) => num(b.recScore) - num(a.recScore),
    title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
    author: (a, b) => String(a.author || '').localeCompare(String(b.author || '')),
    pages: (a, b) => num(b.pages) - num(a.pages),
    pub: (a, b) => (pubYear(b) ?? -Infinity) - (pubYear(a) ?? -Infinity),
    finished: (a, b) => (finishMs(b) ?? -Infinity) - (finishMs(a) ?? -Infinity),
  }[key] || (() => 0);
  return [...books].sort(cmp);
}

export function libraryStats(books) {
  const st = {
    total: books.length, finished: 0, reading: 0, queue: 0, toread: 0, abandoned: 0, fiction: 0, nonfiction: 0,
    words: 0, pages: 0, byDifficulty: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, byGenre: {}, byRecommender: {}, recentFinishes: [],
  };
  for (const b of books) {
    st[readStatus(b)]++;
    st.byRecommender[recommender(b)] = (st.byRecommender[recommender(b)] || 0) + 1;
    if (b.fnf === 'F') st.fiction++; else if (b.fnf === 'NF') st.nonfiction++;
    if (readStatus(b) === 'finished') {
      st.words += Number(b.words) || 0;
      st.pages += Number(b.pages) || 0;
      const d = Number(b.difficultyLevel);
      if (d >= 1 && d <= 5) st.byDifficulty[d]++;
    }
    if (b.genre) st.byGenre[b.genre] = (st.byGenre[b.genre] || 0) + 1;
  }
  st.recentFinishes = books
    .filter((b) => readStatus(b) === 'finished' && finishMs(b) != null)
    .sort((a, b) => finishMs(b) - finishMs(a)).slice(0, 10);
  return st;
}

// Human-readable, grouped-by-status Markdown. No tech-tree / vectors — just the reading history, so it
// doubles as something to paste into a Claude chat or keep as a record. Respects whatever `books` it's
// handed (i.e. already filtered by the caller).
export function exportJourneyMarkdown(books, { title = 'Reading Journey' } = {}) {
  const groups = { finished: [], reading: [], queue: [], toread: [], abandoned: [] };
  for (const b of books) groups[readStatus(b)].push(b);
  const out = [`# ${title} — ${books.length} books`, ''];
  const date = (b) => { const ms = finishMs(b); return ms ? new Date(ms).toISOString().slice(0, 10) : ''; };
  const stars = (b) => { const r = bookRating(b); return r > 0 ? ' — ' + '★'.repeat(Math.round(r)) : ''; };
  const label = { finished: 'Finished', reading: 'Reading', queue: 'On deck', toread: 'To read', abandoned: 'Abandoned' };
  for (const g of ['finished', 'reading', 'queue', 'toread', 'abandoned']) {
    const list = sortBooks(groups[g], g === 'finished' ? 'finished' : 'title');
    if (!list.length) continue;
    out.push(`## ${label[g]} (${list.length})`, '');
    for (const b of list) {
      const diff = b.difficultyLevel ? `, Difficulty ${b.difficultyLevel}` : '';
      const fin = g === 'finished' && date(b) ? ` — finished ${date(b)}` : '';
      out.push(`- **${b.title || 'Untitled'}** — ${b.author || 'Unknown'} (${b.genre || 'Uncategorized'}${diff})${fin}${stars(b)}`);
      if (b.notes) out.push(`  ${String(b.notes).replace(/\s*\n\s*/g, ' ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}
