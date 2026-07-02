// ponytail: sweep every exercise sampler over its full duration — coordinates stay on the
// stage, scalars stay normalized, nothing goes NaN. Run: node src/engine/eyeWarmup.test.mjs
import { EXERCISES, TOTAL_SECONDS } from './eyeWarmup.js';
import assert from 'node:assert';

assert(EXERCISES.length === 8, 'full suite of 8 exercises');
assert(TOTAL_SECONDS > 120 && TOTAL_SECONDS < 300, `routine is a few minutes, got ${TOTAL_SECONDS}s`);

for (const ex of EXERCISES) {
  assert(ex.dur > 0 && ex.fade > 0 && ex.fade < 1, `${ex.id}: sane dur/fade`);
  for (let t = 0; t <= ex.dur; t += 0.05) {
    const d = ex.sample(t, t / ex.dur, ex.dur);
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'number') assert(Number.isFinite(v), `${ex.id}: ${k} finite at t=${t}`);
    }
    if ('x' in d) {
      assert(d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1, `${ex.id}: (${d.x},${d.y}) on stage at t=${t}`);
    }
    if ('scale' in d) assert(d.scale > 0 && d.scale <= 1.001, `${ex.id}: scale in range at t=${t}`);
    if ('breath' in d) assert(d.breath >= 0 && d.breath <= 1.001, `${ex.id}: breath in range at t=${t}`);
    if ('ecc' in d) assert(d.ecc > 0 && d.ecc <= 1, `${ex.id}: eccentricity in range at t=${t}`);
  }
}
console.log('ok');
