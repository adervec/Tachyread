// Self-check for the eye-gesture detector and its mapping rules.
// Run: node app/src/features/eyeGestures.test.mjs
import assert from 'node:assert';
import {
  createEyeGestureDetector, validateEyeMappings, eyeMappingsUsable, matchEyeHold, nextEyeWindow,
  DELIBERATE_MS, MAX_HOLD_MS, WINK_MARGIN,
} from './eyeGestures.js';

const row = (kind, minMs, maxMs, commandId = 'playPause', on = true) => ({ kind, minMs, maxMs, commandId, on });

// ── validation ──────────────────────────────────────────────────────────────
const good = [row('blink', 500, 900), row('blink', 1000, 1600), row('winkL', 500, 1200)];
assert.deepEqual(validateEyeMappings(good), [], 'a clean set has no problems');
assert.equal(eyeMappingsUsable(good), true);

// Overlap on the SAME gesture is the headline rule.
const overlapping = [row('blink', 500, 1000), row('blink', 900, 1400)];
const ovProblems = validateEyeMappings(overlapping);
assert.equal(ovProblems.filter((p) => p.code === 'overlap').length, 1, `one overlap reported, got ${JSON.stringify(ovProblems)}`);
assert.equal(ovProblems.find((p) => p.code === 'overlap').index, 1, 'blamed on the later row');
assert.equal(eyeMappingsUsable(overlapping), false, 'an overlapping set is not usable');
// Touching at the boundary is fine — ranges are inclusive-min, and 1000 belongs to the first.
assert.equal(validateEyeMappings([row('blink', 500, 1000), row('blink', 1000, 1500)]).filter((p) => p.code === 'overlap').length, 0,
  'abutting windows do not count as overlapping');
// The same range on DIFFERENT gestures is perfectly legal — that's the whole point of L vs R.
assert.deepEqual(validateEyeMappings([row('winkL', 500, 1000), row('winkR', 500, 1000)]), [], 'different eyes may share a window');
// A disabled row can overlap freely; it isn't armed.
assert.deepEqual(validateEyeMappings([row('blink', 500, 1000), row('blink', 900, 1400, 'playPause', false)]), [],
  'a disabled row cannot conflict');

// Natural-blink floor and the resting ceiling.
assert.ok(validateEyeMappings([row('blink', 200, 800)]).some((p) => p.code === 'floor'), 'a 200ms window is natural blinking');
assert.ok(validateEyeMappings([row('blink', 500, MAX_HOLD_MS + 1000)]).some((p) => p.code === 'ceiling'), 'a 6s window is resting');
assert.ok(validateEyeMappings([row('blink', 900, 500)]).some((p) => p.code === 'range'), 'inverted range');
assert.ok(validateEyeMappings([row('blink', 500, 560)]).some((p) => p.code === 'narrow' && p.level === 'warn'), 'a 60ms window warns but is allowed');
assert.ok(validateEyeMappings([{ kind: 'blink', minMs: 500, maxMs: 900 }]).some((p) => p.code === 'command'), 'a row with no action');
assert.ok(validateEyeMappings([row('nope', 500, 900)]).some((p) => p.code === 'kind'), 'unknown gesture');

// ── matching ────────────────────────────────────────────────────────────────
assert.equal(matchEyeHold(good, 'blink', 700).commandId, 'playPause');
assert.equal(matchEyeHold(good, 'blink', 950), null, 'the gap between windows matches nothing');
assert.equal(matchEyeHold(good, 'winkR', 700), null, 'the other eye is a different gesture');
assert.equal(nextEyeWindow(good, 'blink', 300).minMs, 500, 'the window you are heading for');
assert.equal(nextEyeWindow(good, 'blink', 950).minMs, 1000, 'the next one up');
assert.equal(nextEyeWindow(good, 'blink', 2000), null, 'past them all');

// ── detector ────────────────────────────────────────────────────────────────
// Drive it with a synthetic eye at 60ms per sample, the rate the camera feeds it.
function run(script, rows = good, opts = {}) {
  const fired = [], ignored = [], cues = [];
  const d = createEyeGestureDetector({
    getRows: () => rows,
    onGesture: (g) => fired.push(g),
    onIgnored: (g) => ignored.push(g),
    onCue: (c) => cues.push(c),
    ...opts,
  });
  for (const s of script) d.push(s);
  return { fired, ignored, cues };
}
// helper: eyes shut for `ms` starting at `t0`, then open for `openMs`
function hold({ t0 = 0, ms, l = 1, r = 1, openMs = 900, step = 60 }) {
  const out = [];
  for (let t = t0; t < t0 + ms; t += step) out.push({ t, blinkL: l, blinkR: r, irisX: 0.5, irisY: 0.5 });
  for (let t = t0 + ms; t < t0 + ms + openMs; t += step) out.push({ t, blinkL: 0, blinkR: 0, irisX: 0.5, irisY: 0.5 });
  return out;
}

// A natural blink must be invisible — this is the requirement the whole feature lives or dies on.
for (const ms of [120, 200, 300, 400]) {
  const { fired, ignored } = run(hold({ ms }));
  assert.equal(fired.length, 0, `${ms}ms blink must not fire`);
  assert.equal(ignored.length, 0, `${ms}ms blink must not even be reported`);
}
// A deliberate hold inside a window fires it.
const long = run(hold({ ms: 720 }));
assert.equal(long.fired.length, 1, `a 720ms blink fires, got ${JSON.stringify(long)}`);
assert.equal(long.fired[0].kind, 'blink');
assert.ok(long.fired[0].ms >= 700 && long.fired[0].ms <= 780, `duration reported ~720ms, got ${long.fired[0].ms}`);
// A hold in the gap between windows is reported as a miss, not silently swallowed.
const miss = run(hold({ ms: 960 }));
assert.equal(miss.fired.length, 0, 'the gap fires nothing');
assert.equal(miss.ignored[0].why, 'no window', 'and says why');
// Resting your eyes is not a command.
assert.equal(run(hold({ ms: MAX_HOLD_MS + 600, openMs: 200 })).fired.length, 0, 'a 5.6s hold is resting');

// Winks: one eye clearly more closed than the other.
const wink = run(hold({ ms: 720, l: 1, r: 0 }));
assert.equal(wink.fired.length, 1, 'a left wink fires');
assert.equal(wink.fired[0].kind, 'winkL', `left eye shut → winkL, got ${wink.fired[0].kind}`);
const winkR = run(hold({ ms: 720, l: 0, r: 1 }), [row('winkR', 500, 1200, 'nextLine')]);
assert.equal(winkR.fired[0].kind, 'winkR', 'right eye is its own gesture');
assert.equal(winkR.fired[0].row.commandId, 'nextLine', 'and carries its own action');
// A lopsided but basically two-eyed closure is a BLINK, not a wink — this is the classic false
// positive (nobody winks cleanly).
const lopsided = run(hold({ ms: 720, l: 1, r: 0.9 }));
assert.equal(lopsided.fired[0].kind, 'blink', `both eyes closing → blink, got ${lopsided.fired[0].kind}`);
assert.ok(0.1 < WINK_MARGIN, 'sanity: that asymmetry is under the wink margin');

// Refractory: the recovery blink right after a fire must not fire again.
const doubled = run([...hold({ ms: 720, openMs: 120 }), ...hold({ t0: 840, ms: 720 })]);
assert.equal(doubled.fired.length, 1, `the rebound is swallowed, got ${doubled.fired.length} fires`);

// Cues: entering a window ticks, falling out of it into a gap ticks differently, and past the last
// window it's 'over'.
const cued = run(hold({ ms: 1800, openMs: 200 }));
assert.deepEqual(cued.cues.slice(0, 3), ['enter', 'leave', 'enter'], `window 1 → gap → window 2, got ${JSON.stringify(cued.cues)}`);
assert.equal(cued.cues[cued.cues.length - 1], 'over', 'and finally past everything');

// ── eye rolls ───────────────────────────────────────────────────────────────
// A full circuit of the iris at a decent radius.
function circle({ t0 = 0, ms = 900, turns = 1, dir = 1, radius = 0.3, step = 60 }) {
  const out = [];
  const n = Math.round(ms / step);
  for (let i = 0; i <= n; i++) {
    const a = dir * turns * 2 * Math.PI * (i / n);
    out.push({ t: t0 + i * step, blinkL: 0, blinkR: 0, irisX: 0.5 + radius * Math.cos(a), irisY: 0.5 + radius * Math.sin(a) });
  }
  return out;
}
const rollRows = [row('rollCW', 500, 2000, 'nextPara'), row('rollCCW', 500, 2000, 'prevPara')];
const cw = run(circle({}), rollRows);
assert.equal(cw.fired.length, 1, `a clockwise circuit fires, got ${JSON.stringify(cw)}`);
assert.equal(cw.fired[0].kind, 'rollCW');
assert.equal(cw.fired[0].row.commandId, 'nextPara');
const ccw = run(circle({ dir: -1 }), rollRows);
assert.equal(ccw.fired[0].kind, 'rollCCW', 'direction is part of the gesture');

// Reading is not a roll: horizontal sweeps back and forth must cancel, never accumulate.
const sweeps = [];
for (let i = 0; i < 300; i++) {
  const x = 0.5 + 0.35 * Math.sin(i / 4);
  sweeps.push({ t: i * 60, blinkL: 0, blinkR: 0, irisX: x, irisY: 0.5 + 0.02 * Math.sin(i / 40) });
}
assert.equal(run(sweeps, rollRows).fired.length, 0, 'left-right reading sweeps must never look like a roll');
// Nor does a single quadrant flick.
assert.equal(run(circle({ turns: 0.25 }), rollRows).fired.length, 0, 'a quarter turn is not a roll');
// A blink mid-roll resets it — you can't stitch two half-rolls together across a blink.
const broken = [...circle({ ms: 420, turns: 0.45 }), ...hold({ t0: 500, ms: 200, openMs: 60 }), ...circle({ t0: 800, ms: 420, turns: 0.45 })];
assert.equal(run(broken, rollRows).fired.length, 0, 'a blink breaks the roll accumulator');

console.log('eyeGestures: all assertions passed ✅');
