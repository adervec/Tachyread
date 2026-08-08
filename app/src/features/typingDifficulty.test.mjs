// Self-check for difficulty-normalised typing progress. The anchor case: ordinary prose must score
// ~1.00, or every adjusted WPM in the app is quietly wrong.
import assert from 'node:assert/strict';
import {
  charCost, BASELINE_COST, runDifficulty, adjustedNet, difficultyLabel, normalizeRuns, difficultyRows,
} from './typingDifficulty.js';

// Build a `keys` histogram the way a run does — one entry per character actually typed.
const keysOf = (text) => {
  const k = {};
  for (const ch of text) { if (ch !== ' ') (k[ch] ||= { n: 0, err: 0 }).n += 1; }
  return k;
};
const run = (text, netWpm = 60) => ({ netWpm, accuracy: 97, keys: keysOf(text) });

// Ordering of the cost table, not just its values.
assert.ok(charCost('a') < charCost('q'), 'home row is cheaper than the top row');
assert.ok(charCost('q') < charCost(',') , 'letters are cheaper than punctuation');
assert.ok(charCost(',') < charCost('7'), 'punctuation is cheaper than the number row');
assert.ok(charCost('7') < charCost('A'), 'digits are cheaper than a held shift');
assert.ok(charCost('A') < charCost('%'), 'shifted symbols are the worst of the common cases');
assert.equal(charCost(''), 0);
assert.ok(charCost('—') > charCost('-'), 'an em dash is not a hyphen');

// ANCHOR: plain lowercase prose scores 1.00 ± 0.05. If this drifts, retune BASELINE_COST.
const PROSE = `the quick brown fox jumps over the lazy dog while a gentle rain begins to fall on the
quiet fields beyond the village and the evening light fades slowly into a soft and even darkness
that settles over everything without any sound at all beneath the wide and open sky`;
const proseD = runDifficulty(run(PROSE));
assert.ok(Math.abs(proseD - 1) <= 0.05, `plain prose should score ~1.00, got ${proseD} (BASELINE_COST=${BASELINE_COST})`);

// Harder text scores higher, easier text lower — the whole point.
const CAPS = PROSE.toUpperCase();
const CODE = 'const x = {a: 1, b: [2, 3]}; if (x.a !== 42) throw new Error("nope #7");';
const HOMEROW = 'asdf jkl; asdf jkl; sad lads fall glad flask hall shall gall dash sash lash gash';
const NUMBERS = '1234 5678 90 1357 2468 1029 3847 5601 7382 9405 1928 3746 5039 8172 6354 0917';
assert.ok(runDifficulty(run(CAPS)) > proseD, 'all caps is harder than prose');
assert.ok(runDifficulty(run(CODE)) > proseD, 'punctuation-dense code is harder than prose');
assert.ok(runDifficulty(run(NUMBERS)) > proseD, 'a numbers drill is harder than prose');
assert.ok(runDifficulty(run(HOMEROW)) < proseD, 'a home-row drill is easier than prose');

// Adjustment does what it says: the same hands on harder text read as a better pace.
assert.ok(adjustedNet(run(CODE, 50)) > 50, 'hard text at 50 WPM is worth more than 50');
assert.ok(adjustedNet(run(HOMEROW, 50)) < 50, 'easy text at 50 WPM is worth less than 50');
// The regression this feature exists to kill: same hands, different text, false "slump".
const easyDay = run(HOMEROW, 70);
const hardDay = run(CODE, 55);
assert.ok(hardDay.netWpm < easyDay.netWpm, 'raw WPM says you got slower…');
assert.ok(adjustedNet(hardDay) > adjustedNet(easyDay), '…adjusted says you did not');

// Guards: no key profile, or too little of one, must never distort a comparison.
assert.equal(runDifficulty({ netWpm: 60 }), 1);
assert.equal(runDifficulty(null), 1);
assert.equal(runDifficulty({ keys: {} }), 1);
assert.equal(runDifficulty(run('%%%')), 1, 'a handful of chars is not evidence about the text');
assert.equal(adjustedNet({ netWpm: 44 }), 44, 'an unscored run keeps its raw number');
assert.equal(adjustedNet({}), 0);
// Clamped, so one pathological run cannot dominate a trend.
assert.ok(runDifficulty(run('%'.repeat(200))) <= 2.5);
assert.ok(runDifficulty(run('a'.repeat(200))) >= 0.6);

assert.equal(difficultyLabel(0.8), 'Easy');
assert.equal(difficultyLabel(1), 'Normal');
assert.equal(difficultyLabel(1.2), 'Hard');
assert.equal(difficultyLabel(1.9), 'Very hard');

// normalizeRuns feeds the existing aggregates: netWpm is swapped, the raw figure is kept.
const norm = normalizeRuns([run(CODE, 50), run(HOMEROW, 50)]);
assert.equal(norm.length, 2);
assert.equal(norm[0].rawNetWpm, 50);
assert.ok(norm[0].netWpm > 50 && norm[1].netWpm < 50);
assert.ok(norm[0].difficulty > norm[1].difficulty);
assert.deepEqual(normalizeRuns(null), []);

// Bands roll up easiest-first and only include bands that occurred.
const rows = difficultyRows([run(HOMEROW, 70), run(PROSE, 60), run(CODE, 50), run(CODE, 52)]);
assert.deepEqual(rows.map((r) => r.band), ['Easy', 'Normal', 'Very hard']);
assert.equal(rows.at(-1).runs, 2);
assert.equal(rows.at(-1).avgNet, 51);
assert.ok(rows.at(-1).avgAdj > rows.at(-1).avgNet);
assert.deepEqual(difficultyRows([]), []);

console.log('typingDifficulty: all cases pass');
