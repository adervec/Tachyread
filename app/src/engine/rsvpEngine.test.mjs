import assert from 'node:assert/strict';
import { chunkLen, rampFactor, hyphenSplit, wordDurationMs } from './rsvpEngine.js';

const words = 'the quick brown fox, jumps over the lazy dog. Then more'.split(' ');
const line = (i) => (i < 9 ? 0 : 1); // "Then more" is on the next line
assert.equal(chunkLen(words, 0, 3, line), 3, 'the quick brown');
assert.equal(chunkLen(words, 2, 3, line), 2, 'brown fox, — stops at the comma');
assert.equal(chunkLen(words, 0, 1, line), 1, 'size 1 = one word');
assert.equal(chunkLen(words, 7, 3, line), 2, 'lazy dog. — stops at the full stop');
assert.equal(chunkLen(words, 8, 3, line), 1, 'never crosses onto the next line');
assert.equal(chunkLen(words, 10, 3, line), 1, 'end of text');

assert.equal(rampFactor(0), 0.7);
assert.equal(rampFactor(10), 0.85);
assert.equal(rampFactor(20), 1);
assert.equal(rampFactor(-5), 1, 'jumped backwards while playing: no ramp');

assert.equal(hyphenSplit('short', 12), null);
assert.equal(hyphenSplit('anything', 0), null, '0 = off');
assert.deepEqual(hyphenSplit('extraordinarily', 12), ['extraor-', 'dinarily']);
assert.deepEqual(hyphenSplit('well-established', 12), ['well-', 'established'], 'own hyphen first');
const [a, b] = hyphenSplit('internationalization', 12);
assert.equal((a.slice(0, -1) + b), 'internationalization', 'halves rejoin to the word');
assert.ok(a.length >= 4 && b.length >= 3);

assert.ok(wordDurationMs('word,', { wpm: 300 }) > wordDurationMs('word', { wpm: 300 }), 'comma pause still applies');
console.log('rsvpEngine: all cases pass');
