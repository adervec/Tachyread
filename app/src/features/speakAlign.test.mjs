import assert from 'node:assert/strict';
import { alignSpoken, wordsMatch, normWord } from './speakAlign.js';

const doc = 'It was the best of times, it was the worst of times; it was the age of wisdom.'.split(' ');
//            0   1   2    3    4  5      6  7   8    9    10  11     12 13  14  15  16  17

// Reading the next words aloud moves just past the last one matched.
assert.equal(alignSpoken(doc, 0, 'it was the best'), 4);
// Punctuation/case don't matter.
assert.equal(alignSpoken(doc, 4, 'Of times it'), 7);
// A missed word in the middle doesn't stall it ("the" skipped).
assert.equal(alignSpoken(doc, 0, 'it was best of'), 5);
// A misheard word is fuzzily accepted ("tymes" ≈ "times,").
assert.equal(alignSpoken(doc, 4, 'of tymes it was'), 8);
// Grunts and a single stray word move nothing.
assert.equal(alignSpoken(doc, 0, 'uh hmm'), null);
assert.equal(alignSpoken(doc, 0, 'best'), null, 'one word is below the minimum run');
// Stale words from earlier in the phrase are ignored; only the new ones count.
assert.equal(alignSpoken(doc, 4, 'it was the best of times'), 6);
// Starting further ahead than the window doesn't jump there.
assert.equal(alignSpoken(doc, 0, 'age of wisdom'), null);
assert.equal(alignSpoken(doc, 0, 'age of wisdom', { window: 20 }), 18);
// minRun 1 is the loosest setting.
assert.equal(alignSpoken(doc, 0, 'it', { minRun: 1 }), 1);
// Never moves backwards.
assert.equal(alignSpoken(doc, 16, 'it was the best of'), null);

assert.ok(wordsMatch('wisdom', 'wisdon'));
assert.ok(!wordsMatch('of', 'or'), 'short words need an exact match');
assert.equal(normWord('Times,'), 'times');
// An exact word later in the look-ahead wins over a near-identical earlier one.
const ids = 'w1 w2 w3 w4 w5 w6 w7 w8'.split(' ').map((w) => 'item' + w);
assert.equal(alignSpoken(ids, 0, 'itemw1 itemw3 itemw4'), 4);
console.log('speakAlign: all cases pass');
