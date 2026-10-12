// Named reading queues: hand-picked, hand-ordered lists of Trackyread books ("AI lore", "Sci-fi"…).
// Membership is kept apart from a book's status, so one book can sit in several queues and the
// built-in "On deck" (status = queue) keeps working as before. Stored as one array in the library
// refs (refs:queues), so it syncs with the library like goals do. All functions here are pure.
import { readStatus } from './journeyLibrary.js';
import { recentWordsPerDay } from './journeyAnalytics.js';

const bookWords = (b) => Number(b?.words) || (Number(b?.pages) ? Number(b.pages) * 275 : 0);

export const newQueue = (name, now = Date.now()) => ({ id: 'q' + now.toString(36), name: String(name || 'Queue').trim() || 'Queue', ids: [] });

const edit = (queues, qid, fn) => (queues || []).map((q) => (q.id === qid ? { ...q, ids: fn(q.ids || []) } : q));
export const addToQueue = (queues, qid, bookId) => edit(queues, qid, (ids) => (ids.includes(bookId) ? ids : [...ids, bookId]));
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

// The queue's books in its own order; deleted/unknown ids are skipped (not removed — a book that
// syncs in later reappears in place).
export function queueBooks(queue, books) {
  const byId = new Map((books || []).filter((b) => !b.deleted).map((b) => [b.id, b]));
  return (queue?.ids || []).map((id) => byId.get(id)).filter(Boolean);
}

// Stats for one queue. `fileOf(book)` → that book's linked-file facts { words, coverage (0–1),
// activeSecs } or null. Pace: this queue's own recent finishes when it has at least 3 in the last
// 90 days, otherwise `overallWordsPerDay`.
export function queueStats(qBooks, { wpm = 250, fileOf = () => null, overallWordsPerDay = null, now = Date.now() } = {}) {
  let wordsTotal = 0, wordsRead = 0, secs = 0, done = 0, lastFinish = null;
  const left = [];
  for (const b of qBooks) {
    const w = bookWords(b);
    const f = fileOf(b);
    const finished = readStatus(b) === 'finished';
    wordsTotal += w;
    const read = finished ? w : Math.round(w * Math.min(1, f?.coverage || 0));
    wordsRead += read;
    secs += f?.activeSecs || 0;
    if (finished) { done += 1; if (b.finishTime && (!lastFinish || b.finishTime > lastFinish)) lastFinish = b.finishTime; }
    else left.push({ book: b, wordsLeft: Math.max(0, w - read) });
  }
  const recentDone = qBooks.filter((b) => readStatus(b) === 'finished' && Date.parse(b.finishTime || '') > now - 90 * 86400000).length;
  const ownPace = recentDone >= 3 ? recentWordsPerDay(qBooks, 90, now) : null;
  const wordsPerDay = ownPace || overallWordsPerDay || null;
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
    readingWpm: secs > 60 ? Math.round(qBooks.reduce((a, b) => a + (fileOf(b)?.coverage || 0) * (fileOf(b)?.words || 0), 0) / (secs / 60)) : null,
    paceSource: ownPace ? 'queue' : wordsPerDay ? 'overall' : null,
    wordsPerDay,
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
