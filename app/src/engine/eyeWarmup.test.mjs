// ponytail: sweep every exercise sampler over its full duration — coordinates stay on the
// stage, scalars stay normalized, nothing goes NaN. Run: node src/engine/eyeWarmup.test.mjs
import { EXERCISES, DEFAULT_IDS, buildPlan, planSeconds, MIN_MINUTES, MAX_MINUTES } from './eyeWarmup.js';
import assert from 'node:assert';

assert(EXERCISES.length >= 12, `expanded suite, got ${EXERCISES.length}`);
assert(DEFAULT_IDS.length >= 6 && DEFAULT_IDS.every((id) => EXERCISES.some((e) => e.id === id)), 'default set is real');
assert(new Set(EXERCISES.map((e) => e.id)).size === EXERCISES.length, 'exercise ids unique');

for (const ex of EXERCISES) {
  assert(ex.dur > 0 && ex.fade > 0 && ex.fade <= 1, `${ex.id}: sane dur/fade`);
  assert(ex.group && ex.name && ex.tip, `${ex.id}: has group/name/tip`);
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
    if ('offset' in d) assert(d.offset >= 0 && d.offset < 0.6, `${ex.id}: converge offset in range at t=${t}`);
    if ('close' in d) assert(d.close >= 0 && d.close <= 1, `${ex.id}: blink close in range at t=${t}`);
  }
}

// buildPlan: scales the chosen drills to roughly the target total (per-drill 6 s floor allowed).
const plan = buildPlan(DEFAULT_IDS, 3 * 60);
assert(plan.length === DEFAULT_IDS.length, 'plan keeps every selected drill');
assert(Math.abs(planSeconds(plan) - 180) <= plan.length, `plan ≈ target total, got ${planSeconds(plan)}`);
assert(plan.every((e) => e.dur >= 6), 'no drill below the floor');
// canonical order preserved regardless of selection order
const reordered = buildPlan([...DEFAULT_IDS].reverse(), 120);
assert.deepEqual(reordered.map((e) => e.id), EXERCISES.filter((e) => DEFAULT_IDS.includes(e.id)).map((e) => e.id));
// a longer total gives longer drills
assert(planSeconds(buildPlan(DEFAULT_IDS, MAX_MINUTES * 60)) > planSeconds(buildPlan(DEFAULT_IDS, MIN_MINUTES * 60)));
// empty selection → empty plan (Begin stays disabled)
assert.deepEqual(buildPlan([], 180), []);

console.log('ok');
