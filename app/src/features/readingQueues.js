// Named reading queues: hand-picked, hand-ordered lists of Trackyread books ("AI lore", "Sci-fi"…).
// Membership is kept apart from a book's status. A book sits in at most ONE queue, once (adding it
// elsewhere moves it; dedupeQueues cleans up older data). Stored as
// one array in the library refs (refs:queues), so it syncs with the library like goals do. These are
// the only queues — the old status-based "On deck" list is folded into one once (deckMigration).
// All functions here are pure.
import { readStatus, contentType, CONTENT_TYPES, STATUS_LABEL } from './journeyLibrary.js';

const bookWords = (b) => Number(b?.words) || (Number(b?.pages) ? Number(b.pages) * 275 : 0);

export const newQueue = (name, now = Date.now()) => ({ id: 'q' + now.toString(36), name: String(name || 'Queue').trim() || 'Queue', ids: [] });

const edit = (queues, qid, fn) => (queues || []).map((q) => (q.id === qid ? { ...q, ids: fn(q.ids || []) } : q));
// Adding moves the book here from any other queue — never in two places.
export const addToQueue = (queues, qid, bookId) => (queues || []).map((q) => {
  const ids = (q.ids || []).filter((x) => x !== bookId || q.id === qid);
  return q.id === qid ? { ...q, ids: ids.includes(bookId) ? ids : [...ids, bookId] } : (ids.length === (q.ids || []).length ? q : { ...q, ids });
});
// Older data (or a sync merge) can hold a book twice: keep its first place (queue order, then list
// order) and drop the rest. Returns null when nothing needed fixing.
export function dedupeQueues(queues) {
  const seen = new Set();
  let changed = false;
  const out = (queues || []).map((q) => {
    if (q.deleted) return q;
    const ids = (q.ids || []).filter((id) => (seen.has(id) ? false : seen.add(id)));
    if (ids.length === (q.ids || []).length) return q;
    changed = true;
    return { ...q, ids };
  });
  return changed ? out : null;
}
// The queue holding a book (live queues only), or null.
export const queueOf = (queues, bookId) => (queues || []).find((q) => !q.deleted && (q.ids || []).includes(bookId)) || null;
// Shift a queue one place left/right among the live ones (its pill order).
export function moveQueue(queues, qid, delta) {
  const live = (queues || []).map((q, i) => [q, i]).filter(([q]) => !q.deleted);
  const k = live.findIndex(([q]) => q.id === qid), j = k + delta;
  if (k < 0 || j < 0 || j >= live.length) return queues;
  const out = [...queues];
  [out[live[k][1]], out[live[j][1]]] = [out[live[j][1]], out[live[k][1]]];
  return out;
}

// Finished books always show at the top (in the order they were finished — so one read out of
// order rises there); the rest keep the queue's order.
export function splitFinished(qBooks) {
  const fin = qBooks.filter((b) => readStatus(b) === 'finished')
    .sort((a, b) => String(a.finishTime || '').localeCompare(String(b.finishTime || '')));
  return { fin, todo: qBooks.filter((b) => readStatus(b) !== 'finished') };
}
// New id order after moving an unfinished book to position `to` among the unfinished (finished first).
export function moveInTodo(qBooks, bookId, to) {
  const { fin, todo } = splitFinished(qBooks);
  const rest = todo.map((b) => b.id).filter((id) => id !== bookId);
  if (rest.length === todo.length) return [...fin, ...todo].map((b) => b.id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, bookId);
  return [...fin.map((b) => b.id), ...rest];
}
export const removeFromQueue = (queues, qid, bookId) => edit(queues, qid, (ids) => ids.filter((x) => x !== bookId));
export function moveInQueue(queues, qid, bookId, delta) {
  return edit(queues, qid, (ids) => {
    const i = ids.indexOf(bookId), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return ids;
    const out = [...ids];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });
}

// Deleting leaves a tombstone ({deleted:true}) rather than dropping the queue: otherwise the deleted
// "On deck" queue looked never-made and deckMigration rebuilt it (and a sync could resurrect any
// deleted queue). liveQueues() is what the UI shows.
export const deleteQueue = (queues, qid) => (queues || []).map((q) => (q.id === qid ? { ...q, deleted: true, ids: [] } : q));
export const liveQueues = (queues) => (queues || []).filter((q) => !q.deleted);

// Put a book at position `to` (0 = top; past the end = bottom).
export const moveToInQueue = (queues, qid, bookId, to) => edit(queues, qid, (ids) => {
  if (!ids.includes(bookId)) return ids;
  const out = ids.filter((x) => x !== bookId);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, bookId);
  return out;
});
export const setQueueIds = (queues, qid, ids) => edit(queues, qid, () => ids);

// Whole-queue reorders. `info(book)` → { pct (0–1), lastRead } for the progress-based keys.
// Stable, so ties keep their current order.
export const QUEUE_SORTS = {
  shortest: ['Shortest left first', (a, b) => a.left - b.left],
  longest: ['Longest left first', (a, b) => b.left - a.left],
  progress: ['Most read first', (a, b) => b.pct - a.pct],
  recent: ['Recently read first', (a, b) => String(b.lastRead || '').localeCompare(String(a.lastRead || ''))],
  title: ['Title A–Z', (a, b) => a.book.title.localeCompare(b.book.title)],
  author: ['Author A–Z', (a, b) => String(a.book.author || '').localeCompare(String(b.book.author || ''))],
  rec: ['Rec score', (a, b) => (Number(b.book.recScore) || 0) - (Number(a.book.recScore) || 0)],
  reverse: ['Reverse', null],
};
export function sortQueueIds(qBooks, key, info = () => ({})) {
  if (key === 'reverse') return qBooks.map((b) => b.id).reverse();
  const rows = qBooks.map((book) => {
    const i = info(book) || {};
    const fin = readStatus(book) === 'finished';
    const pct = fin ? 1 : i.pct || 0;
    return { book, pct, fin, lastRead: i.lastRead, left: bookWords(book) * (1 - pct) };
  });
  return rows.sort(QUEUE_SORTS[key][1]).map((r) => r.book.id);
}

// Fold the old "On deck" list (books with status 'queue') into a named queue, once. The queue is
// marked fromDeck so a sync from another device that already did it doesn't make a second one.
export function deckMigration(queues, books, now = Date.now()) {
  if ((queues || []).some((q) => q.fromDeck)) return null;
  const deck = (books || []).filter((b) => !b.deleted && readStatus(b) === 'queue' && !queueOf(queues, b.id))
    .sort((a, b) => (Number(b.recScore) || 0) - (Number(a.recScore) || 0));
  if (!deck.length) return null;
  return [...(queues || []), { ...newQueue('On deck', now), ids: deck.map((b) => b.id), fromDeck: true }];
}

// Shelving a book "On deck" elsewhere adds it to that queue (making it, with the rest of the old
// deck, if it doesn't exist yet). `books` must already show this book on deck.
// A deleted On deck queue comes back with just this book.
export function addToDeck(queues, books, bookId) {
  if (queueOf(queues, bookId)) return queues; // already queued somewhere — leave it where you put it
  const deck = (queues || []).find((q) => q.fromDeck);
  if (deck?.deleted) return queues.map((q) => (q === deck ? { ...q, deleted: false, ids: [bookId] } : q));
  return deck ? addToQueue(queues, deck.id, bookId) : deckMigration(queues, books) || queues || [];
}

// Recent reading pace from per-day totals [{date:'YYYY-MM-DD', wordsRead, activeSecs}], weighted so
// recent days count most (half-life `halfLife` days, over the last `windowDays`; days without
// reading count as zero). A slow stretch months ago no longer drags today's estimate down.
export function recentPace(days, { now = Date.now(), halfLife = 10, windowDays = 42 } = {}) {
  const byDate = new Map((days || []).map((d) => [d.date, d]));
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return { wordsPerDay: null, wpm: null };
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  const span = Math.max(1, Math.min(windowDays, Math.round((today - Date.parse(dates[0])) / 86400000) + 1));
  let w = 0, words = 0, wWords = 0, wMins = 0;
  for (let age = 0; age < span; age++) {
    const d = byDate.get(new Date(today - age * 86400000).toISOString().slice(0, 10));
    const k = 0.5 ** (age / halfLife);
    w += k;
    words += k * (d?.wordsRead || 0);
    if (d?.activeSecs > 0) { wWords += k * (d.wordsRead || 0); wMins += k * (d.activeSecs / 60); }
  }
  return {
    wordsPerDay: words > 0 ? Math.round(words / w) : null,
    wpm: wMins > 1 ? Math.round(wWords / wMins) : null,
  };
}

// Candidate rows for the "add books" table: one per library book in no queue at all, with the
// text of each filterable column. `info(book)` → { pct, file, open, lastRead }; `file` may be a path
// ('Books/SF/dune.epub'), split here into Folder ('Books/SF') and File ('dune.epub').
export const CAND_COLS = { title: 'Title', author: 'Author', genre: 'Genre', type: 'Type', status: 'Status', folder: 'Folder', file: 'File' };
export function candidateRows(books, queues, info = () => ({})) {
  const inQ = new Set(liveQueues(queues).flatMap((q) => q.ids || []));
  return (books || []).filter((b) => !b.deleted && !inQ.has(b.id)).map((book) => {
    const i = info(book) || {};
    const st = readStatus(book);
    const pct = st === 'finished' ? 1 : i.pct || 0;
    const path = i.file || '', cut = path.lastIndexOf('/');
    return {
      book, pct, fin: pct >= 0.99, open: !!i.open, lastRead: i.lastRead || null,
      cols: {
        title: book.title || '', author: book.author || '', genre: [book.genre, book.subgenre].filter(Boolean).join(' / '),
        type: CONTENT_TYPES[contentType(book)], status: STATUS_LABEL[st].replace(/^\S+\s/, ''), folder: path.slice(0, Math.max(0, cut)), file: path.slice(cut + 1),
      },
    };
  });
}

// Completion filter values. Default 'unfinished' — finished books stay out of the way.
export const CAND_STATES = { unfinished: 'Not finished', unstarted: 'Not started', started: 'In progress', finished: 'Finished', all: 'Any' };
const stateOk = (r, s) => s === 'all' || (s === 'finished' ? r.fin : s === 'unfinished' ? !r.fin : s === 'unstarted' ? !r.fin && r.pct < 0.02 : !r.fin && r.pct >= 0.02);

// Per-column filter text → case-insensitive regex. Text that isn't a valid regex is matched
// literally (and reported in `bad`, so the box can say so).
export function filterCandidates(rows, { cols = {}, state = 'unfinished' } = {}) {
  const bad = [];
  const tests = Object.entries(cols).filter(([, t]) => t && t.trim()).map(([k, t]) => {
    try { const re = new RegExp(t.trim(), 'i'); return [k, (v) => re.test(v)]; }
    catch { bad.push(k); const lc = t.trim().toLowerCase(); return [k, (v) => v.toLowerCase().includes(lc)]; }
  });
  const out = rows.filter((r) => stateOk(r, state) && tests.every(([k, f]) => f(r.cols[k] || '')))
    // Open files first, then most recently read, then rec score.
    .sort((a, b) => (Number(b.open) - Number(a.open)) || String(b.lastRead || '').localeCompare(String(a.lastRead || ''))
      || (Number(b.book.recScore) || 0) - (Number(a.book.recScore) || 0));
  return { rows: out, bad };
}

// The queue's books in its own order; deleted/unknown ids are skipped (not removed — a book that
// syncs in later reappears in place).
export function queueBooks(queue, books) {
  const byId = new Map((books || []).filter((b) => !b.deleted).map((b) => [b.id, b]));
  return (queue?.ids || []).map((id) => byId.get(id)).filter(Boolean);
}

// Stats for one queue. `fileOf(book)` → that book's linked-file facts { words, coverage (0–1),
// activeSecs } or null. `wordsPerDay` = recent pace (recentPace) for the ETAs.
export function queueStats(qBooks, { wpm = 250, fileOf = () => null, wordsPerDay = null, now = Date.now() } = {}) {
  let wordsTotal = 0, wordsRead = 0, secs = 0, done = 0, lastFinish = null;
  const left = [];
  const pctById = {};
  for (const b of qBooks) {
    const w = bookWords(b);
    const f = fileOf(b);
    const finished = readStatus(b) === 'finished';
    wordsTotal += w;
    const read = finished ? w : Math.round(w * Math.min(1, f?.coverage || 0));
    wordsRead += read;
    pctById[b.id] = finished ? 1 : w ? read / w : Math.min(1, f?.coverage || 0);
    secs += f?.activeSecs || 0;
    if (finished) { done += 1; if (b.finishTime && (!lastFinish || b.finishTime > lastFinish)) lastFinish = b.finishTime; }
    else left.push({ book: b, wordsLeft: Math.max(0, w - read) });
  }
  let cum = 0;
  const etas = left.map(({ book, wordsLeft }) => {
    cum += wordsLeft;
    return { id: book.id, eta: wordsPerDay && cum ? new Date(now + (cum / wordsPerDay) * 86400000).toISOString().slice(0, 10) : null };
  });
  const wordsLeft = Math.max(0, wordsTotal - wordsRead);
  return {
    count: qBooks.length, done, wordsTotal, wordsRead, wordsLeft,
    pctWords: wordsTotal ? Math.round((wordsRead / wordsTotal) * 100) : 0,
    hoursLeft: Math.round((wordsLeft / wpm / 60) * 10) / 10,
    hoursSpent: Math.round((secs / 3600) * 10) / 10,
    readingWpm: secs > 60 ? Math.round(qBooks.reduce((a, b) => a + (fileOf(b)?.pacedWords ?? (fileOf(b)?.coverage || 0) * (fileOf(b)?.words || 0)), 0) / (secs / 60)) : null,
    wordsPerDay, pctById,
    etaById: Object.fromEntries(etas.map((e) => [e.id, e.eta])),
    eta: etas.length ? etas.at(-1).eta : null,
    lastFinish,
    next: left[0]?.book || null,
  };
}

// The first unfinished book after (or other than) `finishedId` that `available(book)` says can be
// opened. `available` may be async (file lookups). Returns { book, skipped } — skipped counts the
// unfinished books passed over because their file couldn't be found.
export async function nextInQueue(order, finishedId, available) {
  let skipped = 0;
  for (const b of order) {
    if (b.id === finishedId || readStatus(b) === 'finished' || readStatus(b) === 'abandoned') continue;
    if (await available(b)) return { book: b, skipped };
    skipped += 1;
  }
  return { book: null, skipped };
}

// The view-only dashboard: every live queue's stats, plus totals over all of them (books are in one
// queue each, so the totals don't double count). The overall ETA is everything left at your pace.
// `isLinked(book)` (optional) adds `linked` stats per row: the same, over books with a linked file.
export function queuesOverview(queues, books, opts = {}) {
  const rows = liveQueues(queues).map((q) => {
    const qb = queueBooks(q, books);
    return { queue: q, st: queueStats(qb, opts), linked: opts.isLinked ? queueStats(qb.filter(opts.isLinked), opts) : null };
  });
  const sum = (k) => rows.reduce((a, r) => a + r.st[k], 0);
  const wordsLeft = sum('wordsLeft'), wpd = opts.wordsPerDay, now = opts.now ?? Date.now();
  return {
    rows,
    total: {
      queues: rows.length, count: sum('count'), done: sum('done'), wordsTotal: sum('wordsTotal'), wordsLeft,
      hoursLeft: Math.round((wordsLeft / (opts.wpm || 250) / 60) * 10) / 10,
      hoursSpent: Math.round(sum('hoursSpent') * 10) / 10,
      eta: wpd && wordsLeft ? new Date(now + (wordsLeft / wpd) * 86400000).toISOString().slice(0, 10) : null,
    },
  };
}
