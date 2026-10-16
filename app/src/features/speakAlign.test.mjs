import assert from 'node:assert/strict';
import { alignSpoken, alignOrResync, alignDetail, wordsMatch, normWord, partsOf, STRICTNESS, strictnessOf, speakParams, SPEAK_DEFAULTS, scoreReading, moveQuality } from './speakAlign.js';

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
assert.equal(alignSpoken(doc, 4, 'it was the best of times it was', { fromHeard: 4 }), 8);
// Starting further ahead than the window doesn't jump there.
assert.equal(alignSpoken(doc, 0, 'age of wisdom'), null);
assert.equal(alignSpoken(doc, 0, 'age of wisdom', { window: 20 }), null, '3 words 15 ahead is a jump, not reading — re-sync needs a longer run');
// minRun 1 is the loosest setting.
assert.equal(alignSpoken(doc, 0, 'it was', { minRun: 1 }), 2);
assert.equal(alignSpoken(doc, 0, 'it', { minRun: 1 }), null, 'a lone short word is half a match');
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
// Narration scores: accuracy = said words that were right, completeness = text words said.
const chunk = 'The old lighthouse keeper — tired — climbed the 7 narrow stairs.';
const perfect = scoreReading(chunk, 'the old lighthouse keeper tired climbed the seven narrow stairs');
assert.equal(perfect.accuracy, 100); assert.equal(perfect.completeness, 100);
const skipped = scoreReading(chunk, 'the old lighthouse keeper climbed the stairs');
assert.equal(skipped.accuracy, 100, 'everything said was right');
assert.equal(skipped.completeness, 70, '7 of 10 text words');
const adlib = scoreReading(chunk, 'so the old lighthouse keeper you know tired climbed the seven narrow stairs');
assert.equal(adlib.completeness, 100);
assert.equal(adlib.accuracy, 77, '10 of 13 said words were the text');
// Live progress: matched word indexes and how far along.
const half = scoreReading(chunk, 'the old lighthouse keeper');
assert.deepEqual([...half.done], [0, 1, 2, 3]);
assert.equal(half.upTo, 4);
assert.equal(scoreReading(chunk, ''), null);
// No racing: a growing phrase re-sent by the recogniser only aligns its NEW words.
const grow = 'the old lighthouse keeper climbed the narrow stairs';
const first = alignDetail(ms, 0, 'the old lighthouse keeper climbed');
assert.equal(first.to, 5); assert.equal(first.usedHeard, 5);
const next = alignDetail(ms, 5, grow, { fromHeard: first.usedHeard });
assert.equal(next.to, 8, 'only "the narrow stairs" counts');
assert.ok(next.pairs.slice(0, 5).every((p) => p.stale));
assert.equal(alignDetail(ms, 8, grow, { fromHeard: next.usedHeard }), null, 'nothing new → no move');
// One right word can't carry it through a sentence, even at the most forgiving setting.
const { label: _l, ...vf } = STRICTNESS[1]; // eslint-disable-line no-unused-vars
assert.equal(alignSpoken(ms, 0, 'stairs', vf), null, 'one word 8 ahead');
const { label: _b, ...bal } = STRICTNESS[3]; // eslint-disable-line no-unused-vars
assert.equal(alignSpoken(ms, 0, 'mumble the mumble mumble mumble stairs every', bal), null, 'sparse matches far ahead (balanced)');
// Very strict still follows clean reading.
const { label: _v, ...vs } = STRICTNESS[5]; // eslint-disable-line no-unused-vars
assert.equal(alignSpoken(ms, 0, 'the old lighthouse keeper', vs), 4);
assert.equal(alignSpoken(ms, 0, 'the old like house keeper', vs), null, 'very strict needs it dense');
// Tabs tuned before density existed get their preset's density.
assert.equal(speakParams({ window: 4, skip: 0, fuzz: 0.9, minRun: 3 }).density, 0.8);
// Word-effect quality: exact 1, fuzzy in between, skipped 0.
const mv = alignDetail(ms, 0, 'the old lighthose keeper the narrow');
const mq = new Map(moveQuality(mv.pairs, 0, mv.to));
assert.equal(mq.get(0), 1); assert.equal(mq.get(1), 1);
assert.ok(mq.get(2) > 0.8 && mq.get(2) < 1, 'lighthose ≈ lighthouse');
assert.equal(mq.get(4), 0, '"climbed" skipped');
console.log('speakAlign: all cases pass');
