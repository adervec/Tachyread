// The AFK window is read in three places (active-time cap, mode-chip countdown, blur-when-idle
// veil). They must agree, so the clamp lives in one function — this pins it.
import assert from 'node:assert/strict';
import { idleGraceMs, IDLE_GRACE_MIN, IDLE_GRACE_MAX, defaultGlobalSettings } from './settings.js';

assert.equal(idleGraceMs({ idleGraceSecs: 60 }), 60000);
assert.equal(idleGraceMs({ idleGraceSecs: 90 }), 90000);

// Clamped to what the settings UI actually offers, from either end.
assert.equal(idleGraceMs({ idleGraceSecs: 1 }), IDLE_GRACE_MIN * 1000);
assert.equal(idleGraceMs({ idleGraceSecs: 99999 }), IDLE_GRACE_MAX * 1000);
assert.equal(idleGraceMs({ idleGraceSecs: -30 }), 60000, 'a negative value is nonsense, not a 5s window');

// Missing / unparseable falls back to the default rather than collapsing to the minimum, which
// would blur a reader every 5 seconds.
for (const bad of [undefined, null, 0, NaN, '', 'abc', {}]) {
  assert.equal(idleGraceMs({ idleGraceSecs: bad }), 60000, `idleGraceSecs=${JSON.stringify(bad)}`);
}
assert.equal(idleGraceMs({}), 60000);
assert.equal(idleGraceMs(null), 60000);
assert.equal(idleGraceMs(undefined), 60000);

// Numeric strings come back from number inputs; treat them as numbers.
assert.equal(idleGraceMs({ idleGraceSecs: '120' }), 120000);

// The shipped default sits inside the range and is opt-in.
const g = defaultGlobalSettings();
assert.equal(idleGraceMs(g), 60000);
assert.equal(g.blurWhenIdle, false, 'blur-when-idle must stay opt-in');

console.log('idleGrace: all cases pass');
