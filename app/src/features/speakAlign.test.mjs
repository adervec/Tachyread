import assert from 'node:assert/strict';
import { alignSpoken, alignOrResync, alignDetail, wordsMatch, normWord, partsOf, STRICTNESS, strictnessOf, speakParams, SPEAK_DEFAULTS } from './speakAlign.js';

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
// Re-sync: reading from further down the page re-finds the place, but only on a longer run.
const lh = 'The old lighthouse keeper climbed the narrow stairs every evening and carried a lantern with a small notebook where he wrote down the weather while ships passed far out at sea'.split(' ');
assert.equal(alignOrResync(lh, 0, 'the old lighthouse').to, 3);
assert.equal(alignOrResync(lh, 0, 'the old lighthouse').resync, false);
assert.equal(alignOrResync(lh, 0, 'he wrote down the weather').to, 24);
assert.equal(alignOrResync(lh, 0, 'he wrote down the weather').resync, true);
assert.equal(alignOrResync(lh, 0, 'wrote down'), null, 'two far words are not enough to jump');
// Punctuation never matters: words joined by dashes/slashes split, lone dashes/asterisks vanish.
const pd = ['The', 'old', 'keeper', '—', 'tired—climbed', 'the', 'narrow/winding', 'stairs', '*', 'every', 'evening.'];
assert.equal(alignSpoken(pd, 0, 'the old keeper tired climbed the narrow winding stairs every evening'), 11);
assert.equal(alignSpoken(pd, 3, 'tired climbed'), 5, 'reading from a lone dash token');
assert.deepEqual(partsOf('“Hello,'), ['hello']);
assert.deepEqual(partsOf('—'), []);
// Several misheard words in a row don't stall it: each one widens the look-ahead.
const ms = 'The old lighthouse keeper climbed the narrow stairs every evening with his lantern'.split(' ');
assert.equal(alignSpoken(ms, 0, 'the old like house keepers climb the narrow stairs'), 8);
assert.equal(alignSpoken(ms, 0, 'the old hmm uh er stairs every evening'), 10);
// Sound-alikes and digits.
assert.equal(normWord('two'), normWord('to'));
assert.equal(alignSpoken(['I', 'went', 'to', 'the', 'shop'], 0, 'i went two the shop'), 5);
assert.equal(alignSpoken(['chapter', '7', 'begins'], 0, 'chapter seven begins'), 3);
// The trace marks what matched, what didn't, and what was stale.
const tr = alignDetail(ms, 2, 'the old lighthouse keeper climbed', {});
assert.deepEqual(tr.pairs.map((p) => [p.w, p.i, !!p.stale]), [['the', null, true], ['old', null, true], ['lighthouse', 2, false], ['keeper', 3, false], ['climbed', 4, false]]);
// Strictness presets round-trip.
for (let k = 1; k < STRICTNESS.length; k++) assert.equal(strictnessOf(STRICTNESS[k]), k);
assert.equal(strictnessOf({ window: 99 }), null);
// First-release defaults migrate to today's; real customisations are kept.
assert.deepEqual(speakParams({ window: 6, skip: 2, fuzz: 0.7, minRun: 2, enabled: true }), SPEAK_DEFAULTS);
assert.equal(speakParams({ window: 6, skip: 2, fuzz: 0.8, minRun: 2 }).fuzz, 0.8);
console.log('speakAlign: all cases pass');
