// ponytail: typing-plan model factories + set-count ops (double/halve/inc/dec, never below 1).
// Run: node src/engine/typingPlans.test.mjs
import assert from 'node:assert';
import { makeStep, makePlan, duplicatePlan, applySetOp, totalSets } from './typingPlans.js';

// makeStep: sane defaults + overrides, and a unique id
const s = makeStep();
assert.equal(s.mode, 'commonWords');
assert.equal(s.runMode, 'seconds');
assert.equal(s.sets, 1);
assert.ok(s.id && makeStep().id !== s.id, 'each step gets its own id');
assert.equal(makeStep({ sets: 5, mode: 'numbers' }).sets, 5, 'overrides apply');

// makePlan: blank name → default, empty steps → one starter step
assert.equal(makePlan('', []).name, 'New plan', 'blank name defaults');
assert.equal(makePlan('  Speed  ', []).name, 'Speed', 'name trimmed');
assert.equal(makePlan('P', []).steps.length, 1, 'empty steps → one starter step');
assert.equal(makePlan('P', [makeStep(), makeStep()]).steps.length, 2, 'given steps kept');

// duplicatePlan: new ids everywhere, default copy name
const plan = makePlan('Workout', [makeStep({ sets: 2 }), makeStep({ sets: 3 })]);
const dup = duplicatePlan(plan);
assert.equal(dup.name, 'Workout (copy)', 'default copy name');
assert.notEqual(dup.id, plan.id, 'new plan id');
assert.ok(dup.steps.every((ds, i) => ds.id !== plan.steps[i].id), 'every step gets a new id');
assert.deepEqual(dup.steps.map((x) => x.sets), [2, 3], 'step contents preserved');
assert.equal(duplicatePlan(null).steps.length, 0, 'null plan → empty steps, no throw');
assert.equal(duplicatePlan(plan, 'Custom').name, 'Custom', 'explicit name');

// applySetOp: bulk set adjustments, floored at 1
const p = makePlan('x', [makeStep({ sets: 4 }), makeStep({ sets: 1 })]);
assert.deepEqual(applySetOp(p, 'double').steps.map((x) => x.sets), [8, 2], 'double');
assert.deepEqual(applySetOp(p, 'halve').steps.map((x) => x.sets), [2, 1], 'halve rounds, floors at 1');
assert.deepEqual(applySetOp(p, 'inc').steps.map((x) => x.sets), [5, 2], 'inc');
assert.deepEqual(applySetOp(p, 'dec').steps.map((x) => x.sets), [3, 1], 'dec never drops below 1');
assert.deepEqual(applySetOp(makePlan('y', [makeStep({ sets: 1 })]), 'halve').steps[0].sets, 1, 'halve of 1 stays 1');
assert.equal(applySetOp(p, 'bogus'), p, 'unknown op → unchanged plan');
assert.equal(applySetOp(null, 'double'), null, 'null plan → null');

// totalSets
assert.equal(totalSets(p), 5, 'sums set counts');
assert.equal(totalSets({ steps: [{ sets: 0 }, { sets: -3 }] }), 2, 'each step counts at least 1');
assert.equal(totalSets(null), 0, 'null → 0');
assert.equal(totalSets({}), 0, 'no steps → 0');

console.log('typingPlans: all cases pass');
