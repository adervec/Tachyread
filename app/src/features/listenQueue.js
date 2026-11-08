// Listen mode: when read-aloud reaches the end of a book, record the finish the Book Finished popup
// would have recorded and move on to the next book of the chosen queue that this device can open —
// pocket listening through a queue without touching the screen. The I/O glue lives here; App.jsx
// only wires the read-aloud driver's end event to it.
import { getBinding, getLibraryBooks, getLibraryRef, saveLibraryBook } from '../state/storage.js';
import { setReadStatus } from './journeyLibrary.js';
import { queueBooks, nextInQueue } from './readingQueues.js';
import { getSearchDirs } from './fileLocator.js';
import { fileWhere } from './openBook.js';

// The completion entry the Book Finished popup writes (tab.tracker's lifetime figures; no rating).
export function completionEntry(tr, now = new Date()) {
  return {
    date: now.toISOString(),
    coveragePct: Math.round((tr?.coverage?.() || 0) * 100),
    activeSecs: Math.round((tr?.lifetimeActiveMs || 0) / 1000),
    wpm: tr?.lifetimeWpm?.() || 0,
    rating: 0,
  };
}

// Mark the document's bound Trackyread book finished. Returns the book, or null when unbound.
export async function finishBoundBook(checksum, today = new Date().toISOString().slice(0, 10)) {
  const id = (await getBinding())?.[checksum];
  const book = id && (await getLibraryBooks()).find((b) => b.id === id);
  if (!book) return null;
  await saveLibraryBook(setReadStatus(book, 'finished', today));
  return book;
}

// The queue order rotated to start after `currentId` (dir 1) or, reversed, to start just before it
// (dir -1): "next" continues down the queue and wraps round, "previous" walks back up it.
export function queueFrom(order, currentId, dir = 1) {
  const i = order.findIndex((b) => b.id === currentId);
  const rest = i < 0 ? [...order] : [...order.slice(i + 1), ...order.slice(0, i)];
  return dir < 0 ? rest.reverse() : rest;
}

// The next (dir 1) or previous (dir -1) unfinished book of queue `qid` from the one bound to
// `checksum` whose text this device has (open tab, saved copy, or a file in the search folders).
// null = nothing left to listen to.
export async function nextListenBook(qid, checksum, openChecksums = [], { dir = 1 } = {}) {
  const [queues, books, map, dirs] = await Promise.all([getLibraryRef('queues'), getLibraryBooks(), getBinding(), getSearchDirs().catch(() => [])]);
  const q = (queues || []).find((x) => x.id === qid && !x.deleted);
  if (!q) return null;
  const csOf = {};
  for (const [cs, id] of Object.entries(map || {})) if (!csOf[id]) csOf[id] = cs;
  const order = queueFrom(queueBooks(q, books), map?.[checksum] || null, dir).filter((b) => csOf[b.id] !== checksum);
  const available = async (b) => ['open', 'local', 'folder'].includes((await fileWhere(csOf[b.id], b.title, { openChecksums, dirs, search: true })).where);
  const { book } = await nextInQueue(order, map?.[checksum] || null, available);
  return book ? { book, cs: csOf[book.id], dirs } : null;
}
