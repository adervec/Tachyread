// ponytail: locks the queue's aggregate counts — words summed from records, sentences/lines derived.
// Run: node src/features/journeyQueueTotals.test.mjs
import assert from 'node:assert';
import { queueWithEstimates } from './journeyAnalytics.js';

// Two queued books (shelf:'queue') + one finished (ignored). Words: 1500 real, 550 from pages (2*275).
const books = [
  { id: 'a', title: 'A', shelf: 'queue', words: 1500 },
  { id: 'b', title: 'B', shelf: 'queue', pages: 2 },      // → 2 * 275 = 550 words
  { id: 'c', title: 'C', completion: true, words: 9999 }, // finished → not in queue
];
const q = queueWithEstimates(books, 250, { now: 0, wordsPerDay: 1000 });

assert.equal(q.count, 2, 'only the two queued books count');
assert.equal(q.totalWords, 2050, 'words sum real + page-estimated (1500 + 550)');
assert.equal(q.totalSentences, Math.round(2050 / 15), 'sentences derived at ~15 words each');
assert.equal(q.totalLines, Math.round(2050 / 12), 'lines derived at ~12 words each');
assert.equal(q.items.length, 2, 'items list matches the count');
assert.ok(q.items.every((i) => typeof i.words === 'number'), 'each item carries its own word count');

// Empty queue → zeros, no NaN.
const empty = queueWithEstimates([{ id: 'x', completion: true, words: 100 }], 250, { now: 0 });
assert.deepEqual([empty.count, empty.totalWords, empty.totalSentences, empty.totalLines], [0, 0, 0, 0]);

console.log('journeyQueueTotals: all cases pass');
