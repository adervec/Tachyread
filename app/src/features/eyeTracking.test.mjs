// Self-check for the gaze math. Run: node app/src/features/eyeTracking.test.mjs
// (The camera half needs a browser; only the pure functions are covered here.)
import assert from 'node:assert';
import { gazeFeatures, fitGazeModel, applyGazeModel, createSmoother, averageCalibSamples, GAZE_FEATURES } from './eyeTracking.js';

// ── gazeFeatures ────────────────────────────────────────────────────────────
// Build a synthetic mesh: eyes 0.2 wide / 0.06 tall, irises placed at a known spot inside them.
function mesh({ irisU = 0.5, irisV = 0.5, noseDx = 0, noseDy = 0 } = {}) {
  const lm = [];
  const put = (i, x, y) => { lm[i] = { x, y, z: 0 }; };
  // left eye: inner 133 at 0.45, outer 33 at 0.25 (x decreases outward on this side)
  put(133, 0.45, 0.40); put(33, 0.25, 0.40); put(159, 0.37, 0.37); put(145, 0.37, 0.43);
  put(468, 0.45 + irisU * (0.25 - 0.45), 0.37 + irisV * (0.43 - 0.37));
  // right eye: inner 362 at 0.55, outer 263 at 0.75
  put(362, 0.55, 0.40); put(263, 0.75, 0.40); put(386, 0.63, 0.37); put(374, 0.63, 0.43);
  put(473, 0.55 + irisU * (0.75 - 0.55), 0.37 + irisV * (0.43 - 0.37));
  // face box + nose
  put(234, 0.20, 0.45); put(454, 0.80, 0.45); put(10, 0.10, 0.10); put(152, 0.10, 0.90);
  put(1, 0.50 + noseDx, 0.50 + noseDy);
  return lm;
}

const centred = gazeFeatures(mesh());
assert.equal(centred.length, GAZE_FEATURES, 'feature vector length');
assert.ok(Math.abs(centred[0] - 0.5) < 1e-9, `centred iris → 0.5 across, got ${centred[0]}`);
assert.ok(Math.abs(centred[1] - 0.5) < 1e-9, `centred iris → 0.5 down, got ${centred[1]}`);
assert.ok(Math.abs(centred[2]) < 1e-9 && Math.abs(centred[3]) < 1e-9, 'square-on head → zero yaw/pitch');

// Looking left/right must move feature 0 in a consistent direction on BOTH eyes (the mirrored
// inner/outer indices are the easy thing to get backwards).
const left = gazeFeatures(mesh({ irisU: 0.15 }));
const right = gazeFeatures(mesh({ irisU: 0.85 }));
assert.ok(left[0] < centred[0] && centred[0] < right[0], `iris ratio must be monotone: ${left[0]} < ${centred[0]} < ${right[0]}`);
const up = gazeFeatures(mesh({ irisV: 0.1 }));
assert.ok(up[1] < centred[1], 'iris high in the opening → smaller vertical ratio');
// Head turn shows up as yaw, not as gaze.
const turned = gazeFeatures(mesh({ noseDx: 0.06 }));
assert.ok(Math.abs(turned[2] - 0.1) < 1e-9, `yaw = nose offset / face width, got ${turned[2]}`);
assert.equal(turned[0], centred[0], 'turning the head alone must not change the iris ratio');
// No iris landmarks (the unrefined 468-point mesh) → no gaze.
assert.equal(gazeFeatures([{ x: 0, y: 0 }]), null, 'mesh without irises → null');
assert.equal(gazeFeatures(null), null, 'no mesh → null');

// ── fit / apply ─────────────────────────────────────────────────────────────
// A known affine must be recovered near-exactly from clean samples.
const TRUE_X = [2.0, 0.1, -0.5, 0.0, -0.4];
const TRUE_Y = [0.05, 1.7, 0.0, -0.6, -0.3];
const truth = (f) => ({
  x: TRUE_X.reduce((s, k, i) => s + k * [...f, 1][i], 0),
  y: TRUE_Y.reduce((s, k, i) => s + k * [...f, 1][i], 0),
});
const grid = [];
// Every axis has to vary independently — a pitch derived from u would make the system singular.
for (const u of [0.3, 0.5, 0.7]) {
  for (const v of [0.3, 0.5, 0.7]) {
    for (const yaw of [-0.03, 0.04]) {
      for (const pitch of [-0.02, 0.03]) {
        const f = [u, v, yaw, pitch];
        grid.push({ f, ...truth(f) });
      }
    }
  }
}
const model = fitGazeModel(grid, 1e-9);
assert.ok(model, 'model fits');
for (const s of grid.slice(0, 5)) {
  const g = applyGazeModel(model, s.f);
  assert.ok(Math.hypot(g.x - s.x, g.y - s.y) < 1e-4, `recovers the true mapping (off by ${Math.hypot(g.x - s.x, g.y - s.y)})`);
}
assert.ok(model.rms < 1e-4, `rms on the calibration points is tiny, got ${model.rms}`);

// Noisy samples still fit, and the reported rms grows to say so.
const noisy = grid.map((s, i) => ({ ...s, x: s.x + (i % 3 - 1) * 0.02, y: s.y + (i % 2 ? 0.02 : -0.02) }));
const nm = fitGazeModel(noisy);
assert.ok(nm.rms > model.rms, 'noisy calibration reports a worse fit');
assert.ok(nm.rms < 0.05, `…but still a usable one, got ${nm.rms}`);

// Too few points, or all-identical points, must fail loudly rather than return a wild model.
assert.equal(fitGazeModel(grid.slice(0, 3)), null, 'fewer samples than unknowns → null');
assert.equal(fitGazeModel([]), null, 'no samples → null');
assert.equal(applyGazeModel(null, [0, 0, 0, 0]), null, 'no model → null');
const degenerate = fitGazeModel(Array.from({ length: 9 }, () => ({ f: [0.5, 0.5, 0, 0], x: 0.5, y: 0.5 })));
if (degenerate) { // ridge makes it solvable; it must at least not explode
  const g = applyGazeModel(degenerate, [0.5, 0.5, 0, 0]);
  assert.ok(Math.abs(g.x - 0.5) < 0.2 && Math.abs(g.y - 0.5) < 0.2, `degenerate fit stays near the only point it saw: ${JSON.stringify(g)}`);
}

// ── calibration averaging ───────────────────────────────────────────────────
// Two targets, uneven dwell: the long one must not drown out the short one, and each target must
// collapse to exactly one row (the fit is per POINT, not per frame).
const walk = [
  ...Array.from({ length: 20 }, () => ({ f: [0.4, 0.5, 0, 0], x: 0.1, y: 0.1 })),
  ...Array.from({ length: 4 }, () => ({ f: [0.6, 0.5, 0, 0], x: 0.9, y: 0.9 })),
  { f: [1, 2], x: 0.5, y: 0.5 }, // wrong length → dropped
];
const avg = averageCalibSamples(walk);
assert.equal(avg.length, 2, `one row per target, got ${avg.length}`);
const close = (got, want, msg) => want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) < 1e-9, `${msg} — [${i}] ${got[i]} vs ${w}`));
close(avg.find((a) => a.x === 0.1).f, [0.4, 0.5, 0, 0], 'mean of identical samples is the sample');
close(avg.find((a) => a.x === 0.9).f, [0.6, 0.5, 0, 0], 'short dwell survives the long one');
const mixed = averageCalibSamples([{ f: [0, 0, 0, 0], x: 0.5, y: 0.5 }, { f: [1, 1, 1, 1], x: 0.5, y: 0.5 }]);
close(mixed[0].f, [0.5, 0.5, 0.5, 0.5], 'genuine mean, not last-wins');
assert.deepEqual(averageCalibSamples(null), [], 'no samples → no rows');

// ── smoother ────────────────────────────────────────────────────────────────
const sm = createSmoother(0.5);
assert.deepEqual(sm.push({ x: 1, y: 1 }), { x: 1, y: 1 }, 'first sample passes through');
assert.deepEqual(sm.push({ x: 0, y: 0 }), { x: 0.5, y: 0.5 }, 'halfway on alpha 0.5');
assert.deepEqual(sm.push(null), { x: 0.5, y: 0.5 }, 'a dropped frame holds the last point');
sm.reset();
assert.equal(sm.get(), null, 'reset clears');

console.log('eyeTracking: all assertions passed ✅');
