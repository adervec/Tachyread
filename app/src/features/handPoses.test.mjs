// Self-check: 3D hand pose table — every pose is a well-formed joint target, every gesture the
// camera can report maps to one, and activities settle into sensible resting poses.
// Run: node src/features/handPoses.test.mjs
import assert from 'node:assert/strict';
import { HAND_POSES, poseIdFor, activityHandPose } from './handPoses.js';
import { GESTURE_INFO } from './handGestures.js';

// Well-formed: 4 finger curls in 0..1, a thumb curl, a spread, a 3-axis wrist.
for (const [id, p] of Object.entries(HAND_POSES)) {
  assert.equal(p.curl.length, 4, `${id} has four fingers`);
  assert.ok(p.curl.every((c) => c >= 0 && c <= 1), `${id} curls in range`);
  assert.ok(p.thumb >= 0 && p.thumb <= 1, `${id} thumb in range`);
  assert.ok(p.spread >= 0 && p.spread <= 1, `${id} spread in range`);
  assert.equal(p.wrist.length, 3, `${id} wrist is 3-axis`);
}
assert.ok(Object.keys(HAND_POSES).length >= 18, 'a rich pose set');

// Signature poses are actually distinct shapes, not copies.
assert.deepEqual(HAND_POSES.fist.curl, [1, 1, 1, 1]);
assert.equal(HAND_POSES.thumbUp.thumb, 0, 'thumb-up extends the thumb from a closed fist');
assert.deepEqual(HAND_POSES.thumbUp.curl, [1, 1, 1, 1]);
assert.deepEqual(HAND_POSES.point.curl, [0, 1, 1, 1], 'point extends only the index');
assert.deepEqual(HAND_POSES.victory.curl, [0, 0, 1, 1]);
assert.deepEqual(HAND_POSES.shaka.curl, [1, 1, 1, 0], 'shaka keeps the pinky out');
// Horns and ILY show the same fingers — the THUMB is the whole difference between them.
assert.deepEqual(HAND_POSES.horns.curl, HAND_POSES.ily.curl, 'same index+pinky shape');
assert.ok(HAND_POSES.horns.thumb > HAND_POSES.ily.thumb, 'horns tucks the thumb, ILY extends it');

// Every gesture the detector can report has a pose (no silent fallbacks for real gestures).
for (const [kind, info] of Object.entries(GESTURE_INFO)) {
  const id = poseIdFor(info.icon);
  assert.ok(id && HAND_POSES[id], `${kind} (${info.icon}) maps to a real pose, got ${id}`);
}
assert.equal(poseIdFor('👍'), 'thumbUp');
assert.equal(poseIdFor('✌️'), 'victory', 'variation selectors are tolerated');
assert.equal(poseIdFor('🎤'), 'mic');
assert.equal(poseIdFor('👏'), 'clap');
assert.equal(poseIdFor('🦄'), 'open', 'unknown emoji falls back to an open palm');
assert.equal(poseIdFor(''), null);
assert.equal(poseIdFor(null), null);

// Activity resting poses.
assert.equal(activityHandPose('typing'), 'typing');
assert.equal(activityHandPose('scroll'), 'open');
assert.equal(activityHandPose('page'), 'sweep');
assert.equal(activityHandPose('word'), 'reading');
assert.equal(activityHandPose('idle'), 'relaxed');
assert.equal(activityHandPose(null), 'relaxed');
assert.equal(activityHandPose('typing', true), 'relaxed', 'asleep always relaxes');
for (const a of ['typing', 'scroll', 'page', 'word', 'line', 'listen', 'idle', null]) {
  assert.ok(HAND_POSES[activityHandPose(a)], `${a} resolves to a real pose`);
}

console.log('handPoses: all checks passed');
