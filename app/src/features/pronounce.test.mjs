import assert from 'node:assert/strict';
import { tokenizeIpa, scorePronunciation } from './pronounce.js';

const vocab = new Set(['h', 'ə', 'l', 'oʊ', 'w', 'ɜː', 'd', 't', 'ʃ', 'tʃ', 'iː', 'z', 'θ', 's', 'ɪ', 'ŋ', 'k']);
assert.deepEqual(tokenizeIpa('həlˈoʊ', vocab), ['h', 'ə', 'l', 'oʊ'], 'stress dropped, oʊ one token');
assert.deepEqual(tokenizeIpa('tʃˈiːz', vocab), ['tʃ', 'iː', 'z'], 'longest match: tʃ not t+ʃ');
assert.deepEqual(tokenizeIpa('wˈɜːld', vocab), ['w', 'ɜː', 'l', 'd']);
assert.deepEqual(tokenizeIpa('x?', vocab), [], 'unknown chars skipped');

const hello = ['h', 'ə', 'l', 'oʊ'], world = ['w', 'ɜː', 'l', 'd'];
const perfect = scorePronunciation([hello, world], [...hello, ...world]);
assert.equal(perfect.overall, 100);
assert.deepEqual(perfect.words.map((w) => w.score), [100, 100]);
assert.deepEqual(perfect.words[1].heard, world);

// "thing" said as "sing": θ→s substitution in one word only
const thing = ['θ', 'ɪ', 'ŋ'], kick = ['k', 'ɪ', 'k'];
const r = scorePronunciation([thing, kick], ['s', 'ɪ', 'ŋ', 'k', 'ɪ', 'k']);
assert.deepEqual(r.words.map((w) => w.score), [67, 100]);
assert.deepEqual(r.words[0].heard, ['s', 'ɪ', 'ŋ']);
assert.equal(r.overall, 83);

// a dropped word and silence
const dropped = scorePronunciation([hello, world], hello);
assert.deepEqual(dropped.words.map((w) => w.score), [100, 0]);
assert.equal(scorePronunciation([hello], []).overall, 0);
// extra sounds don't crash and lower the word
assert.ok(scorePronunciation([hello], ['h', 'ə', 'ə', 'l', 'oʊ']).words[0].score < 100);
console.log('pronounce: all cases pass');
