import assert from 'node:assert/strict';
import { sortTabIds, tabInfo, TAB_SORT_KEYS } from './tabSort.js';

const e = (id, fileName, rec, extra = {}) => ({ id, info: tabInfo({ fileName, rec, ...extra }) });
const tabs = [
  e(1, 'Dune.epub', { totalWords: 180000, wordIndex: 90000, persistentWordsRead: 100000, posUpdatedAt: 300, wpm: 300 }, { book: {}, status: 'reading', type: 'long', opened: 20 }),
  e(2, 'article.html', { totalWords: 2000, wordIndex: 2000, persistentWordsRead: 2000, posUpdatedAt: 100 }, { book: {}, status: 'finished', type: 'article', opened: 10 }),
  e(3, 'Notes.txt', { totalWords: 9000, wordIndex: 0 }, { opened: 30 }),
  e(4, 'lazy.pdf', {}), // a lazy tab with nothing saved yet
];

assert.deepEqual(sortTabIds(tabs, 'name'), [2, 1, 4, 3]);
assert.deepEqual(sortTabIds(tabs, 'name', 'desc'), [3, 4, 1, 2]);
// Unknown length/completion sinks to the end both ways.
assert.deepEqual(sortTabIds(tabs, 'length'), [2, 3, 1, 4]);
assert.deepEqual(sortTabIds(tabs, 'length', 'desc'), [1, 3, 2, 4]);
assert.deepEqual(sortTabIds(tabs, 'completion', 'desc'), [2, 1, 3, 4]);
// Time left uses each file's own wpm (default 250): Dune 90000/300=300 min, Notes 9000/250=36.
assert.deepEqual(sortTabIds(tabs, 'timeLeft'), [2, 3, 1, 4]);
assert.deepEqual(sortTabIds(tabs, 'lastRead'), [1, 2, 3, 4]);
assert.deepEqual(sortTabIds(tabs, 'opened'), [2, 1, 3, 4]);
// Status: reading, …, finished, then untracked (ties by name: lazy before Notes).
assert.deepEqual(sortTabIds(tabs, 'status'), [1, 2, 4, 3]);
assert.deepEqual(sortTabIds(tabs, 'type'), [1, 2, 4, 3]);
assert.deepEqual(sortTabIds(tabs, 'fileType'), [1, 2, 4, 3]);
// Unknown key leaves the order alone; every key has labels.
assert.deepEqual(sortTabIds(tabs, 'nope'), [1, 2, 3, 4]);
for (const [k, v] of Object.entries(TAB_SORT_KEYS)) assert.equal(v.length, 4, k);
console.log('tabSort: all cases pass');
