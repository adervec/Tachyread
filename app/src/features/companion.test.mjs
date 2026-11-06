import assert from 'node:assert/strict';
import { companionLine } from './companion.js';

// companion: 10 words, 2 per line → lines 0..4
const doc = { words: Array.from({ length: 10 }, (_, i) => `w${i}`), wordToLine: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4] };
assert.equal(companionLine(0, 1000, doc), 0, 'start → start');
assert.equal(companionLine(999, 1000, doc), 4, 'end → end');
assert.equal(companionLine(500, 1001, doc), 2, 'halfway → halfway');
assert.equal(companionLine(5, 1, doc), 0, 'one-word book is safe');
assert.equal(companionLine(3, 10, { words: [] }), 0);
console.log('companion: all cases pass');
