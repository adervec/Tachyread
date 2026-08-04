// Self-check: typing-upgrade engine (consistency, PBs, streaks, problem words, key/finger
// profiles, pace-caret math). Run: node src/features/typingUpgrades.test.mjs
import assert from 'node:assert/strict';
import {
  runProgress,
  penaltyRewind,
  consistencyPct, pbFlags, bestNet, typingStreak, problemWords, reviewPassage,
  keyFinger, aggregateKeys, fingerStats, buildCum, paceChars, paceWordIndex, FINGERS,
} from './typingUpgrades.js';

// ── consistency ─────────────────────────────────────────────────────────────
assert.equal(consistencyPct([100, 100, 100, 100, 100, 100]), 100, 'metronomic typing = 100%');
const jittery = consistencyPct([80, 200, 60, 300, 90, 250, 70]);
assert.ok(jittery < 70 && jittery > 0, `jitter scores low, got ${jittery}`);
assert.ok(consistencyPct([100, 105, 95, 100, 102, 98]) > 90, 'small jitter stays high');
assert.equal(consistencyPct([100, 100]), null, 'too few samples → null');
assert.equal(consistencyPct(null), null);
const withPause = consistencyPct([100, 100, 100, 5000, 100, 100, 100]);
assert.equal(withPause, 100, 'a >2s thinking pause is not rhythm — filtered');
assert.equal(consistencyPct([100, 0, 100, 0, 100, 100, 100, 100]), 100, 'batch-scored 0ms keys filtered');

// ── personal bests ──────────────────────────────────────────────────────────
const past = [
  { netWpm: 50, mode: 'passage' }, { netWpm: 62, mode: 'passage' }, { netWpm: 40, mode: 'homeRow' },
];
assert.deepEqual(pbFlags(past, { netWpm: 63, mode: 'passage' }), { allTime: true, mode: false }, 'beats everything → all-time (mode flag folded in)');
assert.deepEqual(pbFlags(past, { netWpm: 45, mode: 'homeRow' }), { allTime: false, mode: true }, 'beats only its own mode');
assert.deepEqual(pbFlags(past, { netWpm: 30, mode: 'homeRow' }), { allTime: false, mode: false }, 'beats nothing');
assert.deepEqual(pbFlags([], { netWpm: 99, mode: 'passage' }), { allTime: false, mode: false }, 'first run is a baseline, not a record');
assert.deepEqual(pbFlags(past, { netWpm: 10, mode: 'numbers' }), { allTime: false, mode: false }, 'first run IN A MODE is a baseline too');
assert.equal(bestNet(past), 62);
assert.equal(bestNet(past, 'homeRow'), 40);
assert.equal(bestNet([]), null);

// ── streak (local days) ─────────────────────────────────────────────────────
const day = (offset, h = 12) => { const d = new Date(2026, 6, 20 + offset, h); return d.getTime(); }; // July 2026, local
const streakRuns = [
  { ts: day(0), words: 100, durationMs: 60000 },
  { ts: day(-1), words: 50, durationMs: 30000 },
  { ts: day(-2), words: 30, durationMs: 20000 },
  { ts: day(-5), words: 10, durationMs: 10000 },
];
let st = typingStreak(streakRuns, day(0, 18));
assert.equal(st.days, 3, '3 consecutive local days');
assert.equal(st.today, true);
assert.equal(st.todayWords, 100, 'today totals only today');
st = typingStreak(streakRuns, day(1, 9)); // next morning, nothing typed yet today
assert.equal(st.days, 3, 'a streak survives until a full day is missed');
assert.equal(st.today, false);
st = typingStreak(streakRuns, day(2, 9)); // a whole day skipped
assert.equal(st.days, 0, 'missing a full day breaks the streak');
// Late-night run: 23:30 vs next morning are DIFFERENT local days (regression guard for UTC drift).
const late = [{ ts: new Date(2026, 6, 20, 23, 30).getTime(), words: 5 }];
assert.equal(typingStreak(late, new Date(2026, 6, 21, 8, 0).getTime()).days, 1, 'late-night day counts as its own local day');

// ── problem words ───────────────────────────────────────────────────────────
const passage = ['the', 'labyrinth', 'was', 'inscrutable', 'and', 'quiet', 'labyrinth', 'still'];
const results = [
  { typed: 'the', perfect: true, ms: 300 },
  { typed: 'labrynth', perfect: false, ms: 900 },
  { typed: 'was', perfect: true, ms: 280 },
  { typed: 'inscrutable', perfect: true, ms: 2000 }, // slow (median ~300s range)
  { typed: 'and', perfect: true, ms: 250 },
  { typed: 'quiet', perfect: true, ms: 310 },
  { typed: 'labyrinth', perfect: false, ms: 700 },
  { typed: 'still', perfect: true, ms: 290 },
];
const probs = problemWords(passage, results);
assert.ok(probs.includes('labyrinth'), 'mistyped word mined');
assert.ok(probs.includes('inscrutable'), 'unusually slow word mined');
assert.equal(probs.filter((w) => w.toLowerCase() === 'labyrinth').length, 1, 'deduped');
assert.equal(probs[0], 'labyrinth', 'misses rank before slowness');
assert.ok(!probs.includes('the'), 'clean fast words are not problems');
assert.deepEqual(problemWords(['a'], [{ typed: 'x', perfect: false, ms: 100 }]), [], 'sub-2-char targets skipped');
assert.deepEqual(problemWords(['and'], [{ typed: 'anx', perfect: false, ms: 100 }]), ['and'], 'a mistyped 3-char word IS mined');
assert.deepEqual(problemWords([], []), []);

// Review passage: only the given words, deterministic per seed, drill-length.
const rp = reviewPassage(['alpha', 'beta', 'gamma'], { max: 30, seed: 2 });
assert.equal(rp.length, 30);
assert.ok(rp.every((w) => ['alpha', 'beta', 'gamma'].includes(w)), 'review uses only problem words');
assert.deepEqual(rp, reviewPassage(['alpha', 'beta', 'gamma'], { max: 30, seed: 2 }), 'deterministic per seed');
assert.notDeepEqual(rp, reviewPassage(['alpha', 'beta', 'gamma'], { max: 30, seed: 3 }), 'seed varies the shuffle');
assert.deepEqual(reviewPassage([], { max: 10 }), [], 'no words → empty');

// ── key / finger profile ────────────────────────────────────────────────────
assert.equal(keyFinger('a'), 'L pinky');
assert.equal(keyFinger('F'), 'L index');
assert.equal(keyFinger('j'), 'R index');
assert.equal(keyFinger(';'), 'R pinky');
assert.equal(keyFinger('é'), null, 'exotic chars have no finger');
const agg = aggregateKeys([
  { keys: { a: { n: 10, err: 2 }, j: { n: 5, err: 0 } } },
  { keys: { a: { n: 6, err: 1 }, q: { n: 4, err: 3 } } },
  { /* legacy run without keys */ },
]);
assert.deepEqual(agg.a, { n: 16, err: 3 }, 'per-key merge across runs');
const fs = fingerStats(agg);
assert.equal(fs[0].finger, 'L pinky', 'worst finger first (a+q are both L pinky)');
assert.ok(Math.abs(fs[0].rate - 6 / 20) < 1e-9, 'rate = errors/attempts');
assert.ok(FINGERS.includes(fs[0].finger));

// ── pace caret math ─────────────────────────────────────────────────────────
const cum = buildCum(['one', 'two', 'three']); // 4, 8, 14
assert.deepEqual(cum, [4, 8, 14]);
assert.equal(paceWordIndex(cum, 0), 0, 'pacer starts on word 0');
assert.equal(paceWordIndex(cum, 4.5), 1, 'past word 0’s span → word 1');
assert.equal(paceWordIndex(cum, 999), 2, 'parks on the last word');
assert.equal(Math.round(paceChars(60, 10)), 50, '60wpm = 300 chars/min = 50 chars in 10s');
assert.equal(paceChars(60, 0), 0);

// runProgress: each run mode measures the thing that actually ends it, clamped to 0..1.
assert.equal(runProgress('seconds', { secs: 15, limit: 60 }), 0.25);
assert.equal(runProgress('seconds', { secs: 90, limit: 60 }), 1, 'overrun clamps');
assert.equal(runProgress('seconds', { secs: 15, limit: 0 }), 0, 'no limit → no progress, never NaN');
assert.equal(runProgress('words', { words: 25, limit: 50 }), 0.5);
assert.equal(runProgress('words', { words: 25, limit: 50, secs: 999 }), 0.5, 'word runs ignore the clock');
assert.equal(runProgress('endless', { pos: 30, total: 120 }), 0.25, 'endless measures the passage');
assert.equal(runProgress('endless', { pos: 5, total: 0 }), 0, 'empty passage is safe');
assert.equal(runProgress('endless', {}), 0);
assert.equal(runProgress('seconds'), 0, 'missing opts never throw');

// penaltyRewind: setback mode erases committed words when one is mistyped.
const R = [{ perfect: true }, { perfect: true }, { perfect: false }, { perfect: true }, { perfect: false }];
assert.deepEqual(penaltyRewind(R, 5, 0), { pos: 5, dropped: 0, perfectLost: 0, kept: R }, 'off = untouched');
const one = penaltyRewind(R, 5, 1);
assert.equal(one.pos, 4, 'one-word penalty erases just the bad word');
assert.equal(one.dropped, 1);
assert.equal(one.perfectLost, 0, 'the erased word was the imperfect one');
assert.equal(one.kept.length, 4);
const three = penaltyRewind(R, 5, 3);
assert.equal(three.pos, 2);
assert.equal(three.dropped, 3);
assert.equal(three.perfectLost, 1, 'a perfect word was among the erased');
const deep = penaltyRewind(R, 2, 9);
assert.equal(deep.pos, 0, 'never rewinds past the start');
assert.equal(deep.dropped, 2);
assert.deepEqual(deep.kept, []);
assert.equal(penaltyRewind([], 0, 3).pos, 0, 'empty run is safe');

console.log('typingUpgrades: all checks passed');
