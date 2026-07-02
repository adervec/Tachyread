// ponytail: the gesture math truth table — joystick deadzone/direction/speed curve, the wave
// detector's reversal counting + cooldown, and the discrete-gesture hold trigger.
// Run: node src/features/handGestures.test.mjs
import { scrollVelocity, createWaveDetector, createGestureTrigger, DEFAULT_HAND_CALIB, DEFAULT_GESTURES, GESTURE_INFO } from './handGestures.js';
import assert from 'node:assert';

// Joystick: deadzone at rest, up = negative (scroll up), down = positive, farther = faster.
const cal = DEFAULT_HAND_CALIB; // center 0.5, top 0.28, bottom 0.72
assert.equal(scrollVelocity(cal.centerY, cal), 0, 'rest → no scroll');
assert.equal(scrollVelocity(cal.centerY - 0.02, cal), 0, 'small drift stays in the deadzone');
assert(scrollVelocity(0.35, cal) < 0, 'hand above rest scrolls up');
assert(scrollVelocity(0.65, cal) > 0, 'hand below rest scrolls down');
assert(Math.abs(scrollVelocity(cal.topY, cal)) > Math.abs(scrollVelocity(0.42, cal)), 'farther = faster');
assert(Math.abs(scrollVelocity(0.05, cal)) <= 1 && Math.abs(scrollVelocity(0.95, cal)) <= 1, 'clamped to ±1');
assert(Math.abs(scrollVelocity(cal.topY, cal) - -1) < 1e-9, 'calibrated top = full speed up');

// Asymmetric calibration maps each side over its own range.
const asym = { centerY: 0.5, topY: 0.4, bottomY: 0.9 };
assert(Math.abs(scrollVelocity(0.4, asym) - -1) < 1e-9, 'short top range still reaches full speed');
assert(scrollVelocity(0.65, asym) < 1, 'long bottom range is partial at mid-travel');

// Wave: 3 fast direction reversals inside the window → fire once, then cooldown.
let w = createWaveDetector({ swing: 0.03, reversals: 3, windowMs: 1200, cooldownMs: 1600 });
const swings = [0.5, 0.6, 0.5, 0.6, 0.5, 0.6]; // 5 reversals
let fired = 0;
swings.forEach((x, i) => { if (w.feed(x, 1000 + i * 150)) fired++; });
assert.equal(fired, 1, 'one wave fires once (cooldown swallows the rest)');
assert(w.feed(0.5, 4000) === false && w.feed(0.6, 4150) === false, 'fresh motion after cooldown starts over');

// Slow drift (reversals outside the window) never fires.
w = createWaveDetector({ swing: 0.03, reversals: 3, windowMs: 1200, cooldownMs: 1600 });
fired = 0;
[0.5, 0.6, 0.5, 0.6, 0.5].forEach((x, i) => { if (w.feed(x, 1000 + i * 900)) fired++; });
assert.equal(fired, 0, 'slow back-and-forth is not a wave');

// Tiny tremor below the swing threshold never fires.
w = createWaveDetector({ swing: 0.03, reversals: 3, windowMs: 1200, cooldownMs: 1600 });
fired = 0;
[0.5, 0.51, 0.5, 0.51, 0.5, 0.51].forEach((x, i) => { if (w.feed(x, 1000 + i * 100)) fired++; });
assert.equal(fired, 0, 'tremor is not a wave');

// Hold trigger: a gesture must persist holdTicks feeds; single-frame flickers never fire.
let tg = createGestureTrigger({ holdTicks: 4, cooldownMs: 1500 });
assert.equal(tg.feed('thumbUp', 1000), null, 'tick 1 — not yet');
assert.equal(tg.feed('thumbUp', 1100), null, 'tick 2');
assert.equal(tg.feed('thumbUp', 1200), null, 'tick 3');
assert.equal(tg.feed('thumbUp', 1300), 'thumbUp', 'tick 4 — fires');
assert.equal(tg.feed('thumbUp', 1400), null, 'cooldown holds');
assert.equal(tg.feed('thumbUp', 3100), null, 'post-cooldown, hold ticks still accumulating…');
assert.equal(tg.feed('thumbUp', 3200), null, '…');
assert.equal(tg.feed('thumbUp', 3300), 'thumbUp', '…and a continued hold re-fires (key repeat)');

tg = createGestureTrigger({ holdTicks: 4, cooldownMs: 1500 });
['fist', null, 'fist', 'thumbUp', 'fist', 'fist'].forEach((k, i) => assert.equal(tg.feed(k, 1000 + i * 100), null, `flicker ${i} never fires`));

// Config sanity: every configurable gesture has display info; discrete ones default off.
assert.deepEqual(Object.keys(DEFAULT_GESTURES).sort(), Object.keys(GESTURE_INFO).sort(), 'toggles and display info agree');
assert(DEFAULT_GESTURES.scroll && DEFAULT_GESTURES.wave, 'original gestures stay on by default');
assert(!DEFAULT_GESTURES.thumbUp && !DEFAULT_GESTURES.fist && !DEFAULT_GESTURES.victory, 'new discrete gestures default off');
console.log('ok');
