import assert from 'node:assert/strict';
import { splitRun, splitsFor, holdGrade } from './typingSplits.js';

// A 120 s run sampled every second: 60 s at 300 chars/min (60 wpm), then 60 s at 200 chars/min
// (40 wpm). Every char correct, every word right.
const trend = [];
let c = 0;
for (let t = 1; t <= 120; t++) { c += t <= 60 ? 5 : 200 / 60; trend.push({ t, chars: c, ok: c, correct: c }); }

const h = splitRun(trend, 2);
assert.equal(h.parts.length, 2);
assert.equal(h.parts[0].net, 60);
assert.equal(h.parts[1].net, 40);
assert.equal(h.parts[0].acc, 100);
assert.equal(h.diffPct, -33);
assert.equal(h.diffGrade, 'F');

// Quarters land on the same two paces, interpolated between samples.
const q = splitRun(trend, 4);
assert.deepEqual(q.parts.map((p) => p.net), [60, 60, 40, 40]);

// Fixed-but-mistyped keys lower a part's accuracy, not its net.
const t2 = trend.map((p) => ({ ...p, correct: p.t > 60 ? p.correct - 10 : p.correct }));
assert.ok(splitRun(t2, 2).parts[1].acc < 100);

// Holding pace within 5% (or speeding up) is an A.
assert.equal(holdGrade(3), 'A');
assert.equal(holdGrade(-5), 'A');
assert.equal(holdGrade(-12), 'C');

// Too short / empty runs don't split.
assert.deepEqual(splitsFor(59), []);
assert.deepEqual(splitsFor(200), [2, 3]);
assert.deepEqual(splitsFor(300), [2, 3, 4]);
assert.equal(splitRun([], 2), null);
console.log('typingSplits: all cases pass');
