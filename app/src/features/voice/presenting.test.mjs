// node src/features/voice/presenting.test.mjs
import assert from 'node:assert/strict';
import { presentingScorer, PRESENTING_SHAPES } from './presenting.js';

assert.ok(PRESENTING_SHAPES.includes('jawOpen') && PRESENTING_SHAPES.includes('browInnerUp'));

// A steady, attentive, lively, clearly articulating reader.
let s = presentingScorer();
for (let i = 0; i < 200; i++) {
  const w = Math.sin(i / 3); // brows and mouth moving
  s.frame({ present: true, yaw: 0.01 * Math.sin(i), pitch: 0, eyesOpen: true,
    shapes: { browInnerUp: 0.3 + 0.2 * w, browOuterUpLeft: 0.2 + 0.15 * w, browOuterUpRight: 0.2 + 0.15 * w, mouthSmileLeft: 0.2 + 0.2 * w, mouthSmileRight: 0.2 + 0.2 * w, eyeWideLeft: 0.1, eyeWideRight: 0.1, jawOpen: 0.25 + 0.1 * Math.abs(w) } });
}
let r = s.summary();
assert.equal(r.frames, 200);
assert.equal(r.presence, 100);
assert.equal(r.eyeContact, 100);
assert.ok(r.headSteadiness >= 85, `steady head: ${r.headSteadiness}`);
assert.ok(r.expressiveness >= 70, `lively face: ${r.expressiveness}`);
assert.ok(r.articulation >= 70, `open jaw: ${r.articulation}`);
assert.ok(r.overall >= 80);

// Reading with the head tilted down a little the whole time is still facing the screen.
s = presentingScorer();
for (let i = 0; i < 50; i++) s.frame({ present: true, yaw: 0, pitch: -0.2, eyesOpen: true });
assert.equal(s.summary().eyeContact, 100, 'the resting pitch is the baseline, not the horizon');

// Glancing down at notes 40% of the time, frozen face, mumbling.
s = presentingScorer();
for (let i = 0; i < 100; i++) {
  s.frame({ present: true, yaw: 0, pitch: i % 5 < 2 ? 0.3 : 0, eyesOpen: true,
    shapes: { browInnerUp: 0.1, browOuterUpLeft: 0.1, browOuterUpRight: 0.1, mouthSmileLeft: 0.05, mouthSmileRight: 0.05, jawOpen: 0.03 } });
}
r = s.summary();
assert.equal(r.eyeContact, 60, 'the glances away don’t count');
assert.ok(r.headSteadiness < 20, `nodding constantly: ${r.headSteadiness}`);
assert.equal(r.expressiveness, 0, 'nothing moves');
assert.equal(r.articulation, 0, 'jaw barely opens');

// Eyes shut doesn't count as contact; absence lowers presence but not the per-present scores.
s = presentingScorer();
for (let i = 0; i < 10; i++) s.frame({ present: false });
for (let i = 0; i < 10; i++) s.frame({ present: true, yaw: 0, pitch: 0, eyesOpen: false });
for (let i = 0; i < 20; i++) s.frame({ present: true, yaw: 0, pitch: 0, eyesOpen: true });
r = s.summary();
assert.equal(r.presence, 75);
assert.equal(r.eyeContact, 67);
assert.ok(!('expressiveness' in r) && !('articulation' in r), 'no blendshapes → those scores are simply absent');
assert.equal(r.overall, Math.round((67 + 100) / 2));

// Presence-only backend (no yaw numbers): `facing` false counts as turned away.
s = presentingScorer();
for (let i = 0; i < 4; i++) s.frame({ present: true, facing: i < 3 });
assert.equal(s.summary().eyeContact, 75);

// Nothing seen → null, never a throw or a 0 score.
assert.equal(presentingScorer().summary(), null);
s = presentingScorer(); s.frame({ present: false });
assert.equal(s.summary(), null);
console.log('presenting: all cases pass');
