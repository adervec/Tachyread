import assert from 'node:assert/strict';
import { similar, alignTranscript, timeForWord, wordForTime, syncCoverage } from './audioSync.js';

assert.equal(similar('colour', 'color') > 0.8, true);
assert.equal(similar('fear', 'mind') < 0.5, true);

const book = 'Chapter One. I must not fear. Fear is the mind-killer. Fear is the little death that brings total obliteration.'.split(' ');
// Whisper: reads "chapter one" fine, mishears "obliteration", adds an ad-lib, drops "little"
const heard = 'chapter one i must not fear fear is the mind killer uh fear is the death that brings total oblivion'.split(' ').map((text, k) => ({ text, ms: k * 400 }));
const { anchors, next } = alignTranscript(book, heard, { fileIndex: 0 });
const byWord = Object.fromEntries(anchors.map(([wi, , ms]) => [wi, ms]));
assert.equal(byWord[0], 0, '"Chapter" at 0 ms');
assert.equal(byWord[2], 800, '"I" at 800 ms');
assert.ok(!(9 in byWord) || byWord[9] === 3600, 'mind-killer: punctuation-only difference tolerated or skipped');
assert.equal(byWord[10], 4800, 'second "Fear" (heard word 12 — after the split "mind killer" and the ad-lib)');
assert.ok(anchors.every((a, k) => k === 0 || a[0] > anchors[k - 1][0]), 'monotonic');
assert.ok(next >= 16, 'continues near the end');

// lookups
const A = [[0, 0, 0], [10, 0, 4000], [20, 1, 1000], [30, 1, 5000]];
assert.deepEqual(timeForWord(A, 15), { file: 0, ms: 4000 });
assert.deepEqual(timeForWord(A, 20), { file: 1, ms: 1000 });
assert.deepEqual(timeForWord(A, -3), { file: 0, ms: 0 });
assert.equal(timeForWord([], 5), null);
assert.equal(wordForTime(A, 0, 4500), 10);
assert.equal(wordForTime(A, 1, 999), 10, 'start of file 2 before its first anchor → last word of file 1');
assert.equal(wordForTime(A, 1, 6000), 30);
assert.equal(syncCoverage(A, 62), 0.5);
console.log('audioSync: all cases pass');
