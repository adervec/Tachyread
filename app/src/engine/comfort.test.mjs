// ponytail: the comfort/fatigue engine — clamp, comprehension-drop, noisy-OR fatigue, microbreak
// scheduling, WPM backoff. Pure (no clock), so fully deterministic. Run: node src/engine/comfort.test.mjs
import assert from 'node:assert';
import { DEFAULT_COMFORT, clamp01, comprehensionDrop, fatigueScore, shouldBreak, nextBreakInMs, backoffWpm } from './comfort.js';

const MIN = 60000;

// clamp01 tolerates junk
assert.equal(clamp01(-1), 0);
assert.equal(clamp01(2), 1);
assert.equal(clamp01(0.4), 0.4);
assert.equal(clamp01(NaN), 0, 'NaN → 0, never propagates');
assert.equal(clamp01('x'), 0, 'non-number → 0');
assert.equal(clamp01(Infinity), 0, 'infinite → 0 (not finite)');

// comprehensionDrop: only a DROP counts, needs ≥3 points
assert.equal(comprehensionDrop([]), 0, 'empty → 0');
assert.equal(comprehensionDrop([0.9, 0.9]), 0, 'fewer than 3 → 0');
assert.equal(comprehensionDrop([0.9, 0.9, 0.9]), 0, 'steady → 0');
assert.equal(comprehensionDrop([0.5, 0.6, 0.9, 1.0]), 0, 'improving → 0 (clamped)');
assert.ok(comprehensionDrop([1.0, 0.9, 0.4, 0.2]) > 0, 'a falling run → positive');
assert.ok(comprehensionDrop([1, 1, 0, 0]) > comprehensionDrop([1, 1, 0.5, 0.5]), 'bigger drop → bigger score');

// fatigueScore: noisy-OR of time-on-task + comprehension trend
assert.equal(fatigueScore({ readingMs: 0 }), 0, 'no time, no scores → 0');
const horizonMs = DEFAULT_COMFORT.fatigueHorizonMin * MIN;
assert.ok(Math.abs(fatigueScore({ readingMs: horizonMs }) - 1) < 1e-9 || fatigueScore({ readingMs: horizonMs }) > 0.99, 'at the horizon → ~1');
assert.ok(fatigueScore({ readingMs: horizonMs / 2 }) > 0.4 && fatigueScore({ readingMs: horizonMs / 2 }) < 0.6, 'half horizon → ~0.5');
// either signal alone raises it; together they compound (noisy-OR ≥ max of the two)
const tOnly = fatigueScore({ readingMs: horizonMs / 2 });
const both = fatigueScore({ readingMs: horizonMs / 2, recentScores: [1, 1, 0, 0] });
assert.ok(both > tOnly, 'adding a comprehension drop compounds fatigue');
assert.ok(both <= 1, 'stays clamped to 1');
assert.ok(fatigueScore({ readingMs: -5 }) === 0, 'negative time → 0');

// microbreak scheduling
assert.equal(shouldBreak(0), false, 'fresh → no break');
assert.equal(shouldBreak(DEFAULT_COMFORT.breakIntervalMin * MIN), true, 'at the interval → break due');
assert.equal(shouldBreak(DEFAULT_COMFORT.breakIntervalMin * MIN - 1), false, 'just under → not yet');
assert.equal(nextBreakInMs(0), DEFAULT_COMFORT.breakIntervalMin * MIN, 'full interval remaining when fresh');
assert.equal(nextBreakInMs(DEFAULT_COMFORT.breakIntervalMin * MIN + 5000), 0, 'never negative past the interval');
assert.equal(nextBreakInMs(5 * MIN), (DEFAULT_COMFORT.breakIntervalMin - 5) * MIN, 'counts down');

// backoffWpm: only lowers, and only past the threshold
assert.equal(backoffWpm(400, 0), 400, 'no fatigue → unchanged');
assert.equal(backoffWpm(400, DEFAULT_COMFORT.fatigueThreshold - 0.01), 400, 'below threshold → unchanged');
assert.ok(backoffWpm(400, 1) < 400, 'max fatigue → eased down');
assert.equal(backoffWpm(400, 1), Math.round(400 * (1 - DEFAULT_COMFORT.backoffPct)), 'at fatigue 1 → full backoffPct easing');
assert.ok(backoffWpm(400, 0.99) <= backoffWpm(400, 0.6), 'more fatigue → equal or slower');
assert.ok(backoffWpm(400, 2) >= 1 && backoffWpm(0, 1) >= 1, 'never below 1, junk-tolerant');
assert.equal(backoffWpm(400, 1) < 400 && backoffWpm(400, 1) > 300, true, 'a 15% easing keeps it sane, never raises');

console.log('comfort: all cases pass');
