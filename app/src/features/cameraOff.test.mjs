// Self-check for the biometric ✕. The regression: eye gestures kept the camera alive, so the
// popup closed and instantly re-opened.
import assert from 'node:assert/strict';
import { cameraOffPatch, anyCameraSourceOn, CAMERA_SOURCE_KEYS } from './cameraOff.js';

const apply = (g) => ({ ...g, ...cameraOffPatch(g) });

// Each flat source alone keeps the camera up, and the patch clears it.
for (const k of CAMERA_SOURCE_KEYS) {
  const g = { [k]: true };
  assert.ok(anyCameraSourceOn(g), `${k} is a camera source`);
  assert.equal(anyCameraSourceOn(apply(g)), false, `${k} must be cleared`);
}

// THE BUG: eye gestures on, every guard off — the old patch left the camera running.
const eyeOnly = { eyeGestures: { on: true, rows: [{ gesture: 'blinkLeft', action: 'prevLine' }] } };
assert.ok(anyCameraSourceOn(eyeOnly), 'eye gestures alone keep the camera up');
const closed = apply(eyeOnly);
assert.equal(anyCameraSourceOn(closed), false, '✕ must switch eye gestures off too');
// …without throwing away the mappings the user built.
assert.deepEqual(closed.eyeGestures.rows, eyeOnly.eyeGestures.rows, 'gesture mappings survive the close');
assert.equal(closed.eyeGestures.on, false);

// Everything at once.
const all = { ...Object.fromEntries(CAMERA_SOURCE_KEYS.map((k) => [k, true])), eyeGestures: { on: true, rows: [] } };
assert.ok(anyCameraSourceOn(all));
assert.equal(anyCameraSourceOn(apply(all)), false);

// Nothing on: the patch is still safe, and doesn't invent an eyeGestures object.
assert.equal(anyCameraSourceOn({}), false);
assert.equal(anyCameraSourceOn(null), false);
assert.ok(!('eyeGestures' in cameraOffPatch({})), 'no eyeGestures key when there was none');
assert.ok(!('eyeGestures' in cameraOffPatch({ eyeGestures: { on: false, rows: [] } })), 'already-off gestures are left alone');

// The patch is exhaustive by construction: applying it must satisfy the check for ANY input.
for (const g of [{}, eyeOnly, all, { webcamDoze: true, eyeGestures: { on: true, rows: [] } }]) {
  assert.equal(anyCameraSourceOn(apply(g)), false, 'patch must always fully close the camera');
}

console.log('cameraOff: all cases pass');
