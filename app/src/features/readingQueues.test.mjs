import assert from 'node:assert/strict';
import { newQueue, addToQueue, removeFromQueue, moveInQueue, moveToInQueue, queueBooks, queueStats, nextInQueue, sortQueueIds, deckMigration, addToDeck, deleteQueue, liveQueues, dedupeQueues, queueOf, moveQueue, splitFinished, moveInTodo, queuesOverview, recentPace, candidateRows, filterCandidates } from './readingQueues.js';

const now = Date.parse('2026-10-11T12:00:00Z');
const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10);
const books = [
  { id: 'a', title: 'A', words: 10000, completion: true, finishTime: day(10) },
  { id: 'b', title: 'B', words: 20000 },
  { id: 'c', title: 'C', words: 30000, shelf: 'abandoned' },
  { id: 'd', title: 'D', words: 40000 },
  { id: 'gone', title: 'X', words: 1, deleted: true },
];

// Membership edits: no duplicates, order kept, moves clamp at the ends.
let qs = [{ ...newQueue('AI lore', 1), ids: [] }];
const qid = qs[0].id;
for (const id of ['a', 'b', 'c', 'd', 'b', 'gone']) qs = addToQueue(qs, qid, id);
assert.deepEqual(qs[0].ids, ['a', 'b', 'c', 'd', 'gone']);
qs = moveInQueue(qs, qid, 'd', -1);
assert.deepEqual(qs[0].ids, ['a', 'b', 'd', 'c', 'gone']);
assert.deepEqual(moveInQueue(qs, qid, 'a', -1)[0].ids, qs[0].ids, 'moving the first item up is a no-op');
qs = removeFromQueue(qs, qid, 'c');
const qb = queueBooks(qs[0], books);
assert.deepEqual(qb.map((b) => b.id), ['a', 'b', 'd'], 'deleted books are skipped');

// Stats: A finished (10k), B half read (10k of 20k), D untouched.
const files = { b: { words: 20000, coverage: 0.5, activeSecs: 3600 } };
const st = queueStats(qb, { wpm: 250, fileOf: (b) => files[b.id] || null, wordsPerDay: 5000, now });
assert.equal(st.count, 3);
assert.equal(st.done, 1);
assert.equal(st.wordsTotal, 70000);
assert.equal(st.wordsRead, 20000);
assert.equal(st.pctWords, 29);
assert.equal(st.hoursLeft, Math.round((50000 / 250 / 60) * 10) / 10);
assert.equal(st.hoursSpent, 1);
assert.deepEqual(st.pctById, { a: 1, b: 0.5, d: 0 });
assert.equal(st.etaById.b, day(-2), 'B: 10k words left at 5k/day');
assert.equal(st.eta, day(-10), 'queue done after 50k words');
assert.equal(st.next.id, 'b');

// Next in queue: skips the just-finished book, finished/abandoned ones, and unavailable files.
const order = [books[0], books[1], books[2], books[3]];
assert.deepEqual(await nextInQueue(order, 'b', async (b) => b.id === 'd'), { book: books[3], skipped: 0 });
assert.deepEqual(await nextInQueue(order, 'x', async (b) => b.id === 'd'), { book: books[3], skipped: 1 });
assert.deepEqual(await nextInQueue(order, 'x', () => false), { book: null, skipped: 2 });

// Reorders: move to top/bottom; sorts by words left, progress; reverse.
assert.deepEqual(moveToInQueue(qs, qid, 'd', 0)[0].ids, ['d', 'a', 'b', 'gone']);
assert.deepEqual(moveToInQueue(qs, qid, 'a', 99)[0].ids, ['b', 'd', 'gone', 'a']);
const info = (b) => ({ pct: b.id === 'b' ? 0.5 : 0 });
assert.deepEqual(sortQueueIds(qb, 'shortest', info), ['a', 'b', 'd']); // a finished (0 left), b 10k, d 40k
assert.deepEqual(sortQueueIds(qb, 'progress', info), ['a', 'b', 'd']);
assert.deepEqual(sortQueueIds(qb, 'longest', info), ['d', 'b', 'a']);
assert.deepEqual(sortQueueIds(qb, 'reverse'), ['d', 'b', 'a']);

// On-deck migration: once, rec-score order; not again once a fromDeck queue exists.
const deckBooks = [{ id: 'x', title: 'X', shelf: 'queue', recScore: 1 }, { id: 'y', title: 'Y', shelf: 'queue', recScore: 5 }, books[1]];
const mig = deckMigration([], deckBooks, 2);
assert.equal(mig.length, 1);
assert.deepEqual([mig[0].name, mig[0].ids, mig[0].fromDeck], ['On deck', ['y', 'x'], true]);
assert.equal(deckMigration(mig, deckBooks), null);
assert.equal(deckMigration([], [books[1]]), null, 'nothing on deck → no queue');
assert.deepEqual(addToDeck(mig, deckBooks, 'b')[0].ids, ['y', 'x', 'b'], 'shelving on deck joins the deck queue');
assert.deepEqual(addToDeck([], deckBooks, 'x')[0].ids, ['y', 'x'], 'no deck queue yet → made from the whole deck');
// Deleting On deck sticks: no re-migration; the other queue is untouched; re-shelving revives it with one book.
const two = [...mig, { ...newQueue('Other', 3), ids: ['b'] }];
const del = deleteQueue(two, mig[0].id);
assert.deepEqual(liveQueues(del).map((q) => q.name), ['Other']);
assert.equal(deckMigration(del, deckBooks), null);
assert.deepEqual(liveQueues(addToDeck(del, deckBooks, 'x')).map((q) => [q.name, q.ids]), [['On deck', ['x']], ['Other', ['b']]]);

// Recent pace: recent days dominate; zero days count; wpm from active time.
const pace = recentPace([
  { date: day(60), wordsRead: 100, activeSecs: 3600 },  // old and slow — outside the window
  { date: day(1), wordsRead: 10000, activeSecs: 1800 },
  { date: day(0), wordsRead: 10000, activeSecs: 1800 },
], { now });
assert.ok(pace.wordsPerDay > 1000 && pace.wordsPerDay < 2000, `recent pace ${pace.wordsPerDay}`); // 20k over 2 days, spread over a 6-week window
assert.equal(pace.wpm, 333);
const slowNow = recentPace([{ date: day(30), wordsRead: 30000, activeSecs: 3600 }, { date: day(0), wordsRead: 30000, activeSecs: 3600 }], { now });
const fastNow = recentPace([{ date: day(30), wordsRead: 0, activeSecs: 0 }, { date: day(0), wordsRead: 60000, activeSecs: 3600 }], { now });
assert.ok(fastNow.wordsPerDay > slowNow.wordsPerDay, 'today weighs more than a month ago');
assert.deepEqual(recentPace([], { now }), { wordsPerDay: null, wpm: null });

// Candidates: excludes queue members, finished hidden by default, per-column regex, bad regex → literal.
const lib = [
  { id: 'p', title: 'Dune', author: 'Frank Herbert', genre: 'SF' },
  { id: 'q', title: 'Emma', author: 'Jane Austen', completion: true },
  { id: 'r', title: 'Dracula (1897)', author: 'Bram Stoker' },
  { id: 's', title: 'In queue', author: 'Someone' },
];
const rows = candidateRows(lib, [{ id: 'z', ids: ['s'] }, { id: 'gone', deleted: true, ids: ['p'] }], (b) => ({ pct: b.id === 'p' ? 0.4 : 0, file: b.id === 'r' ? 'gothic/dracula.epub' : '', open: b.id === 'r' }));
assert.deepEqual(filterCandidates(rows).rows.map((r) => r.book.id), ['r', 'p'], 'open first; finished and queued hidden');
assert.deepEqual(filterCandidates(rows, { state: 'all' }).rows.map((r) => r.book.id).sort(), ['p', 'q', 'r']);
assert.deepEqual(filterCandidates(rows, { state: 'finished' }).rows.map((r) => r.book.id), ['q']);
assert.deepEqual(filterCandidates(rows, { state: 'started' }).rows.map((r) => r.book.id), ['p']);
assert.deepEqual(filterCandidates(rows, { state: 'unstarted' }).rows.map((r) => r.book.id), ['r']);
assert.deepEqual(filterCandidates(rows, { cols: { title: '^d', author: 'herb' } }).rows.map((r) => r.book.id), ['p']);
assert.deepEqual(filterCandidates(rows, { cols: { folder: '^gothic$' } }).rows.map((r) => r.book.id), ['r']);
assert.deepEqual(filterCandidates(rows, { cols: { file: '^dracula' } }).rows.map((r) => r.book.id), ['r']);
const bad = filterCandidates(rows, { cols: { title: '(1897' } });
assert.deepEqual([bad.rows.map((r) => r.book.id), bad.bad], [['r'], ['title']]);

// One queue per book: adding elsewhere moves it; duplicates from old data are dropped (first place wins).
const pair = [{ id: 'q1', name: 'One', ids: ['a', 'b'] }, { id: 'q2', name: 'Two', ids: ['c'] }];
assert.deepEqual(addToQueue(pair, 'q2', 'a').map((q) => q.ids), [['b'], ['c', 'a']]);
assert.deepEqual(addToQueue(pair, 'q1', 'a').map((q) => q.ids), [['a', 'b'], ['c']], 'already there → unchanged');
assert.deepEqual(dedupeQueues([{ id: 'q1', ids: ['a', 'b', 'a'] }, { id: 'q2', ids: ['b', 'c'] }]).map((q) => q.ids), [['a', 'b'], ['c']]);
assert.equal(dedupeQueues(pair), null);
assert.equal(queueOf(pair, 'c').id, 'q2');
assert.deepEqual(addToDeck([{ id: 'q1', ids: ['x'] }], deckBooks, 'x'), [{ id: 'q1', ids: ['x'] }], 'shelving On deck leaves an already-queued book alone');
assert.deepEqual(deckMigration([{ id: 'q1', ids: ['y'] }], deckBooks).at(-1).ids, ['x'], 'migration skips books already queued');

// Pill order: moves among live queues, skipping tombstones.
const three = [{ id: 'q1', ids: [] }, { id: 'dead', deleted: true, ids: [] }, { id: 'q3', ids: [] }];
assert.deepEqual(moveQueue(three, 'q3', -1).map((q) => q.id), ['q3', 'dead', 'q1']);
assert.deepEqual(moveQueue(three, 'q1', -1), three);

// Finished on top, in finish order; moves only reorder the unfinished part.
const mix = [{ id: 'u1', title: 'U1' }, { id: 'f2', title: 'F2', completion: true, finishTime: '2026-10-02' }, { id: 'u2', title: 'U2' }, { id: 'f1', title: 'F1', completion: true, finishTime: '2026-10-01' }];
const sp = splitFinished(mix);
assert.deepEqual([sp.fin.map((b) => b.id), sp.todo.map((b) => b.id)], [['f1', 'f2'], ['u1', 'u2']]);
assert.deepEqual(moveInTodo(mix, 'u2', 0), ['f1', 'f2', 'u2', 'u1']);

// Dashboard totals over all live queues.
const ov = queuesOverview([{ id: 'q1', name: 'One', ids: ['a', 'b'] }, { id: 'q2', name: 'Two', ids: ['d'] }, { id: 'x', deleted: true, ids: ['c'] }], books, { wpm: 250, wordsPerDay: 10000, now });
assert.deepEqual([ov.total.queues, ov.total.count, ov.total.done, ov.total.wordsLeft], [2, 3, 1, 60000]);
assert.equal(ov.total.eta, day(-6));
console.log('readingQueues: all cases pass');
