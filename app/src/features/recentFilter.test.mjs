// Run: node src/features/recentFilter.test.mjs
import assert from 'node:assert';
import { finishedNotRereading } from './recentFilter.js';

const fin = { completions: [{ date: '2026-07-01T10:00:00Z' }], totalWords: 1000, wordIndex: 999, dailyHistory: [{ date: '2026-07-01', wordsRead: 500 }] };

assert.equal(finishedNotRereading(fin, undefined), true, 'finished, untouched since → hidden');
assert.equal(finishedNotRereading({ ...fin, dailyHistory: [...fin.dailyHistory, { date: '2026-07-05', wordsRead: 200 }] }, undefined), false, 'read after finishing → shown');
assert.equal(finishedNotRereading({ ...fin, wordIndex: 300 }, undefined), false, 'restarted mid-book same day → shown');
assert.equal(finishedNotRereading(fin, 'reading'), false, 'explicit reading shelf → shown');
assert.equal(finishedNotRereading({ totalWords: 1000, wordIndex: 400 }, undefined), false, 'unfinished → shown');
assert.equal(finishedNotRereading({ totalWords: 1000, wordIndex: 1000 }, undefined), true, 'parked at end, no completion → hidden');
assert.equal(finishedNotRereading({ totalWords: 225, wordIndex: 224 }, undefined), true, 'short file on its LAST word → finished');
assert.equal(finishedNotRereading({ totalWords: 225, wordIndex: 200 }, undefined), false, 'short file near the end → still reading');
assert.equal(finishedNotRereading({ totalWords: 1000, wordIndex: 100 }, 'finished'), true, 'explicit finished shelf → hidden');
assert.equal(finishedNotRereading(null, undefined), false, 'no record → shown');

console.log('recentFilter: all assertions passed');
