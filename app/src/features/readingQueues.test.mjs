import assert from 'node:assert/strict';
import { newQueue, addToQueue, removeFromQueue, moveInQueue, queueBooks, queueStats, nextInQueue } from './readingQueues.js';

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

// Stats: A finished (10k), B half read (10k of 20k), D untouched. Pace = overall (only 1 finish).
const files = { b: { words: 20000, coverage: 0.5, activeSecs: 3600 } };
const st = queueStats(qb, { wpm: 250, fileOf: (b) => files[b.id] || null, overallWordsPerDay: 5000, now });
assert.equal(st.count, 3);
assert.equal(st.done, 1);
assert.equal(st.wordsTotal, 70000);
assert.equal(st.wordsRead, 20000);
assert.equal(st.pctWords, 29);
assert.equal(st.hoursLeft, Math.round((50000 / 250 / 60) * 10) / 10);
assert.equal(st.hoursSpent, 1);
assert.equal(st.paceSource, 'overall');
assert.equal(st.etaById.b, day(-2), 'B: 10k words left at 5k/day');
assert.equal(st.eta, day(-10), 'queue done after 50k words');
assert.equal(st.next.id, 'b');

// Next in queue: skips the just-finished book, finished/abandoned ones, and unavailable files.
const order = [books[0], books[1], books[2], books[3]];
assert.deepEqual(await nextInQueue(order, 'b', async (b) => b.id === 'd'), { book: books[3], skipped: 0 });
assert.deepEqual(await nextInQueue(order, 'x', async (b) => b.id === 'd'), { book: books[3], skipped: 1 });
assert.deepEqual(await nextInQueue(order, 'x', () => false), { book: null, skipped: 2 });
console.log('readingQueues: all cases pass');
