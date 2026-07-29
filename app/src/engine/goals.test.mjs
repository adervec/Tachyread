// ponytail: reading-goal math (fraction + status string). Guards the 0-word-doc NaN%/Infinity% bug
// that the focus-panel goal widget rendered. Run: node src/engine/goals.test.mjs
import assert from 'node:assert';
import { goalFraction, computeGoalStatus } from './goals.js';

// a minimal tab stub: wordIndex + a doc with N words (+ wordToLine so line goals don't throw)
const tab = (words, idx, extra = {}) => ({
  settings: { wordIndex: idx, wpm: 250, ...extra.settings },
  doc: { words: Array(words).fill('w'), wordToLine: Array(Math.max(1, words)).fill(0), lines: [{ startWordIndex: 0 }] },
  tracker: null,
});

// goalFraction
assert.equal(goalFraction(tab(100, 25), { type: 'AbsoluteWords', value: 50 }), 0.5, 'absolute words fraction');
assert.equal(goalFraction(tab(200, 100), { type: 'AbsolutePercent', value: 50 }), 1, '100/200 = 50% → 1.0 of a 50% goal');
assert.equal(goalFraction(tab(100, 25), null), null, 'no goal → null');
assert.equal(goalFraction(tab(100, 25), { type: 'AbsoluteWords', value: 0 }), null, 'zero value → null');
assert.equal(goalFraction(tab(0, 0), { type: 'AbsolutePercent', value: 50 }), 0, 'empty doc → 0 (guarded), not NaN');

// computeGoalStatus — the fixed bug: 0-word doc must NOT produce NaN%/Infinity%
const empty = tab(0, 0);
const emptyMid = tab(0, 5);
for (const type of ['AbsolutePercent', 'RelativePercent']) {
  assert.ok(!/NaN|Infinity/.test(computeGoalStatus(empty, { type, value: 50 })), `${type} on empty doc has no NaN/Infinity`);
  assert.ok(!/NaN|Infinity/.test(computeGoalStatus(emptyMid, { type, value: 50, baseline: 0 })), `${type} empty+idx has no NaN/Infinity`);
}
// normal percent status renders a real number
assert.match(computeGoalStatus(tab(200, 50), { type: 'AbsolutePercent', value: 50 }), /25\.0% \/ 50%/, 'percent status is sane');
assert.equal(computeGoalStatus(tab(100, 10), null), 'No active goal', 'no goal message');
assert.equal(computeGoalStatus(tab(100, 10), { type: 'AbsoluteWords', value: 0 }), 'Set a value to begin', 'zero value message');
assert.match(computeGoalStatus(tab(100, 30), { type: 'AbsoluteWords', value: 60 }), /30 \/ 60 words/, 'absolute words status');

console.log('goals: all cases pass');
