// ponytail: the gesture math truth table — joystick deadzone/direction/speed curve, the wave
// detector's reversal counting + cooldown, and the discrete-gesture hold trigger.
// Run: node src/features/handGestures.test.mjs
import { scrollVelocity, createWaveDetector, createGestureTrigger, createSwipeDetector, isPinch, fingerStates, detectHandPose, DEFAULT_HAND_CALIB, DEFAULT_GESTURES, GESTURE_INFO, HELD_GESTURES } from './handGestures.js';
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

// Hold trigger: a gesture must persist for at least its minimum hold TIME; single-frame flickers
// never fire. (Timed by the clock, so the threshold is a real duration, not a frame count.)
let tg = createGestureTrigger({ minHoldMs: 400, cooldownMs: 1500 });
assert.equal(tg.feed('thumbUp', 1000), null, 'first frame — hold clock starts');
assert.equal(tg.feed('thumbUp', 1200), null, '200ms held — not yet');
assert.equal(tg.feed('thumbUp', 1300), null, '300ms — still under 400');
assert.equal(tg.feed('thumbUp', 1400), 'thumbUp', '400ms held — fires');
assert.equal(tg.feed('thumbUp', 1600), null, 'cooldown holds (fired 200ms ago)');
assert.equal(tg.feed('thumbUp', 2800), null, 'still inside the 1500ms cooldown');
assert.equal(tg.feed('thumbUp', 2950), 'thumbUp', 'a continued hold re-fires once the cooldown clears (key repeat)');

// Per-gesture times: a getter can make one gesture slow and another quick.
tg = createGestureTrigger({ getMinHoldMs: (k) => (k === 'fist' ? 800 : 300), cooldownMs: 1500 });
assert.equal(tg.feed('fist', 0), null, 'fist start');
assert.equal(tg.feed('fist', 400), null, 'fist at 400ms — its floor is 800');
assert.equal(tg.feed('fist', 800), 'fist', 'fist fires at its own 800ms');
tg = createGestureTrigger({ getMinHoldMs: (k) => (k === 'fist' ? 800 : 300), cooldownMs: 1500 });
assert.equal(tg.feed('victory', 0), null, 'victory start');
assert.equal(tg.feed('victory', 300), 'victory', 'victory fires at its shorter 300ms');

// Raising the hold time filters an accidental that a shorter one would have let through.
const quick = createGestureTrigger({ minHoldMs: 200, cooldownMs: 1500 });
const slow = createGestureTrigger({ minHoldMs: 900, cooldownMs: 1500 });
// a ~500ms brush of the gesture then gone
const brush = [['fist', 0], ['fist', 200], ['fist', 400], [null, 500]];
let q = null, s = null;
brush.forEach(([k, t]) => { q = tg && (quick.feed(k, t) || q); s = slow.feed(k, t) || s; });
assert.equal(q, 'fist', 'a 200ms threshold fires on a half-second brush');
assert.equal(s, null, 'a 900ms threshold rejects the same brush as accidental');

// A flicker between different gestures never accumulates on any one of them.
tg = createGestureTrigger({ minHoldMs: 400, cooldownMs: 1500 });
[['fist', 0], [null, 100], ['fist', 200], ['thumbUp', 300], ['fist', 400], ['fist', 500]]
  .forEach(([k, t], i) => assert.equal(tg.feed(k, t), null, `flicker ${i} never fires`));

// Swipe: one fast directional sweep fires after the confirm delay; a reversal (a wave stroke) cancels.
let sd = createSwipeDetector({ sweep: 0.24, minStep: 0.015, windowMs: 700, confirmMs: 320, cooldownMs: 1400 });
let out = null;
[0.8, 0.7, 0.6, 0.5, 0.4].forEach((x, i) => { const r = sd.feed(x, 1000 + i * 100); if (r) out = r; }); // sweep left, 0.4 total
assert.equal(out, null, 'sweep arms but does not fire before confirm');
out = sd.feed(0.4, 1800); // hand rests past the confirm window
assert.equal(out, 'left', 'sustained sweep fires after the confirm delay');
assert.equal(sd.feed(0.5, 1900) || sd.feed(0.6, 2000) || sd.feed(0.7, 2100) || null, null, 'cooldown holds');

sd = createSwipeDetector({ sweep: 0.24, minStep: 0.015, windowMs: 700, confirmMs: 320, cooldownMs: 1400 });
out = null;
// a wave: big stroke right then IMMEDIATE stroke back — the reversal must cancel the pending swipe
[0.3, 0.45, 0.6, 0.45, 0.3, 0.45, 0.6].forEach((x, i) => { const r = sd.feed(x, 1000 + i * 100); if (r) out = r; });
assert.equal(out, null, 'back-and-forth (wave) never fires a swipe');

sd = createSwipeDetector();
out = null;
[0.5, 0.52, 0.54, 0.56, 0.58, 0.6].forEach((x, i) => { const r = sd.feed(x, 1000 + i * 400); if (r) out = r; }); // slow drift
assert.equal(sd.feed(0.6, 4500), null, 'slow drift never arms');
assert.equal(out, null, 'slow drift never fires');

// Pinch: thumb+index tips touching with other fingers extended; a fist (all tips bunched) is NOT a pinch.
const mkHand = (over) => {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 })); // default: bunched at the wrist
  lm[0] = { x: 0.5, y: 0.95 }; // wrist
  lm[9] = { x: 0.5, y: 0.75 }; // middle MCP → span 0.2
  Object.assign(lm, over);
  return lm;
};
const pinchHand = mkHand({
  4: { x: 0.44, y: 0.62 }, 8: { x: 0.45, y: 0.6 },               // thumb+index tips touching
  12: { x: 0.5, y: 0.55 }, 16: { x: 0.55, y: 0.57 }, 20: { x: 0.6, y: 0.6 }, // others extended (~0.4 from wrist)
});
assert(isPinch(pinchHand), 'thumb+index together with open fingers = pinch');
const fistHand = mkHand({
  4: { x: 0.48, y: 0.8 }, 8: { x: 0.5, y: 0.8 },
  12: { x: 0.5, y: 0.82 }, 16: { x: 0.52, y: 0.82 }, 20: { x: 0.54, y: 0.83 }, // all tips near the palm
});
assert(!isPinch(fistHand), 'a fist is not a pinch');
const openHand = mkHand({
  4: { x: 0.3, y: 0.6 }, 8: { x: 0.42, y: 0.5 },                 // thumb and index apart
  12: { x: 0.5, y: 0.48 }, 16: { x: 0.58, y: 0.5 }, 20: { x: 0.66, y: 0.55 },
});
assert(!isPinch(openHand), 'open hand is not a pinch');

// ── landmark-derived poses (finger patterns + pointing directions) ──────────
// Synthetic hands: wrist at (0.5,0.95), middle MCP at (0.5,0.75) → span 0.2. Extended tips sit
// ≥0.30 from the wrist (ratio ≥1.5); curled tips ≈0.15–0.18 (ratio ≤0.9). Index MCP is lm[5].
const mkPose = (over) => mkHand({ 5: { x: 0.46, y: 0.78 }, ...over });
const EXT = { index: { x: 0.44, y: 0.63 }, middle: { x: 0.5, y: 0.62 }, ring: { x: 0.56, y: 0.64 }, pinky: { x: 0.62, y: 0.68 } };
const CURL = { index: { x: 0.5, y: 0.8 }, middle: { x: 0.52, y: 0.8 }, ring: { x: 0.54, y: 0.8 }, pinky: { x: 0.6, y: 0.8 } };
const THUMB_CURL = { x: 0.48, y: 0.8 };   // hugs the index MCP
const THUMB_EXT = { x: 0.3, y: 0.75 };    // well away from the index MCP

const threeHand = mkPose({ 4: THUMB_CURL, 8: EXT.index, 12: EXT.middle, 16: EXT.ring, 20: CURL.pinky });
assert.equal(detectHandPose(threeHand), 'threeUp', 'index+middle+ring up, pinky+thumb tucked = three');
const fourHand = mkPose({ 4: THUMB_CURL, 8: EXT.index, 12: EXT.middle, 16: EXT.ring, 20: EXT.pinky });
assert.equal(detectHandPose(fourHand), 'fourUp', 'four fingers up, thumb tucked = four');
const shakaHand = mkPose({ 4: THUMB_EXT, 8: CURL.index, 12: CURL.middle, 16: CURL.ring, 20: EXT.pinky });
assert.equal(detectHandPose(shakaHand), 'callMe', 'thumb+pinky out = call me');
const hornsHand = mkPose({ 4: THUMB_CURL, 8: EXT.index, 12: CURL.middle, 16: CURL.ring, 20: EXT.pinky });
assert.equal(detectHandPose(hornsHand), 'horns', 'index+pinky out, thumb tucked = horns');

// Pointing directions come from the index tip relative to its MCP (unmirrored frame: the USER's
// left is frame-x-increasing, like the swipes).
const downHand = mkHand({ 0: { x: 0.5, y: 0.5 }, 9: { x: 0.5, y: 0.7 }, 5: { x: 0.46, y: 0.68 },
  4: { x: 0.47, y: 0.66 }, 8: { x: 0.46, y: 0.88 }, 12: { x: 0.5, y: 0.62 }, 16: { x: 0.52, y: 0.62 }, 20: { x: 0.54, y: 0.62 } });
assert.equal(detectHandPose(downHand), 'pointDown', 'index alone, tip well below its MCP = point down');
const leftHand = mkHand({ 0: { x: 0.3, y: 0.8 }, 9: { x: 0.5, y: 0.8 }, 5: { x: 0.48, y: 0.76 },
  4: { x: 0.5, y: 0.78 }, 8: { x: 0.72, y: 0.76 }, 12: { x: 0.36, y: 0.78 }, 16: { x: 0.36, y: 0.8 }, 20: { x: 0.36, y: 0.82 } });
assert.equal(detectHandPose(leftHand), 'pointLeft', 'index tip toward frame-right = the USER\'s left');
const rightHand = mkHand({ 0: { x: 0.7, y: 0.8 }, 9: { x: 0.5, y: 0.8 }, 5: { x: 0.52, y: 0.76 },
  4: { x: 0.5, y: 0.78 }, 8: { x: 0.28, y: 0.76 }, 12: { x: 0.64, y: 0.78 }, 16: { x: 0.64, y: 0.8 }, 20: { x: 0.64, y: 0.82 } });
assert.equal(detectHandPose(rightHand), 'pointRight', 'index tip toward frame-left = the USER\'s right');

// Fail-closed: a half-bent finger is neither extended nor curled → no pose, not the wrong pose.
const midHand = mkPose({ 4: THUMB_CURL, 8: EXT.index, 12: EXT.middle, 16: EXT.ring, 20: { x: 0.6, y: 0.76 } }); // pinky ratio ~1.07 = mid
assert.equal(detectHandPose(midHand), null, 'ambiguous finger → no pose');
assert.equal(detectHandPose(null), null, 'no landmarks → null');
const fs1 = fingerStates(threeHand);
assert.deepEqual([fs1.index, fs1.middle, fs1.ring, fs1.pinky, fs1.thumb], ['ext', 'ext', 'ext', 'curl', 'curl'], 'finger states read as expected');

// Config sanity: every configurable gesture has display info; discrete ones default off.
assert.deepEqual(Object.keys(DEFAULT_GESTURES).sort(), Object.keys(GESTURE_INFO).sort(), 'toggles and display info agree');
assert(DEFAULT_GESTURES.scroll && DEFAULT_GESTURES.wave, 'original gestures stay on by default');
assert(!DEFAULT_GESTURES.thumbUp && !DEFAULT_GESTURES.fist && !DEFAULT_GESTURES.victory, 'new discrete gestures default off');
assert(!DEFAULT_GESTURES.pointUp && !DEFAULT_GESTURES.iLoveYou && !DEFAULT_GESTURES.pinch && !DEFAULT_GESTURES.swipeLeft && !DEFAULT_GESTURES.swipeRight, 'expanded gestures default off');
assert(['pointDown', 'pointLeft', 'pointRight', 'threeUp', 'fourUp', 'callMe', 'horns'].every((k) => DEFAULT_GESTURES[k] === false && HELD_GESTURES.includes(k)), 'derived poses default off and are hold-gated');
console.log('ok');
