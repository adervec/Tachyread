// On-device hand-gesture controls (experimental). Watches the camera for one hand and turns it
// into reader commands:
//   • Open palm = a scroll joystick — hold your palm above/below your calibrated rest height to
//     scroll up/down; the farther from rest, the faster (deadzone at rest, quadratic curve).
//   • A wave (open hand swinging side-to-side) = play/pause toggle.
// Calibration learns YOUR rest / top / bottom palm heights, so speed maps to your comfortable
// range at your seating distance. Everything runs locally via MediaPipe GestureRecognizer —
// frames are analysed in the browser and never recorded or uploaded.

import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';

const MP_VERSION = '0.10.35';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const PALM = 9; // middle-finger MCP landmark — a stable palm-centre proxy

export const DEFAULT_HAND_CALIB = { centerY: 0.5, topY: 0.28, bottomY: 0.72 };

// Each gesture is individually toggleable (Application Settings) so unused ones can't false-fire.
// The discrete gestures default OFF — opt in to the ones you actually use. Every kind (except the
// joystick) is remappable to any reader command in Biometric Controls.
export const DEFAULT_GESTURES = {
  scroll: true, wave: true, thumbUp: false, thumbDown: false, fist: false, victory: false,
  pointUp: false, iLoveYou: false, pinch: false, swipeLeft: false, swipeRight: false,
};
export const GESTURE_INFO = {
  scroll: { icon: '✋', label: 'Palm joystick', desc: 'Open palm above/below your rest height scrolls up/down — farther is faster' },
  wave: { icon: '👋', label: 'Wave', desc: 'Wave side-to-side (3+ direction changes)' },
  thumbUp: { icon: '👍', label: 'Thumb up', desc: 'Hold to repeat' },
  thumbDown: { icon: '👎', label: 'Thumb down', desc: 'Hold to repeat' },
  fist: { icon: '✊', label: 'Fist', desc: 'Closed fist held for a moment' },
  victory: { icon: '✌', label: 'Victory', desc: 'Two-finger V held for a moment' },
  pointUp: { icon: '☝', label: 'Point up', desc: 'Index finger pointing up, held for a moment' },
  iLoveYou: { icon: '🤟', label: 'Rock / ILY', desc: 'Thumb + index + pinky extended, held for a moment' },
  pinch: { icon: '🤏', label: 'Pinch', desc: 'Thumb and index tips together (other fingers open), held for a moment' },
  swipeLeft: { icon: '👈', label: 'Swipe left', desc: 'One fast open-palm sweep toward your left' },
  swipeRight: { icon: '👉', label: 'Swipe right', desc: 'One fast open-palm sweep toward your right' },
};
const GESTURE_BY_LABEL = { Thumb_Up: 'thumbUp', Thumb_Down: 'thumbDown', Closed_Fist: 'fist', Victory: 'victory', Pointing_Up: 'pointUp', ILoveYou: 'iLoveYou' };

export const DEFAULT_HOLD_MS = 400;  // a discrete gesture must persist this long to fire (≈4 frames)
export const HOLD_MIN_MS = 150;      // floor for the per-gesture setting (below this it's a flicker)
export const HOLD_MAX_MS = 3000;
// The "held" discrete gestures a minimum-hold time applies to. Motion gestures (wave, swipes) and
// the scroll joystick aren't held poses, so a hold time is meaningless for them.
export const HELD_GESTURES = ['thumbUp', 'thumbDown', 'fist', 'victory', 'pointUp', 'iLoveYou', 'pinch'];

// Clamp a user-entered hold time into the allowed range (or the default when unset/garbage).
export function clampHoldMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_HOLD_MS;
  return Math.max(HOLD_MIN_MS, Math.min(HOLD_MAX_MS, n));
}

// Hold-to-fire for discrete gestures: a classification must persist for at least its minimum hold
// TIME before it fires, then a cooldown gates the next fire (holding through the cooldown re-fires —
// natural key-repeat for the WPM nudges). Timing by the clock rather than a frame count means the
// threshold is a real duration the user can set, independent of the camera's sample rate. Single-
// frame misclassifications — the main false-positive source — never survive to fire; a longer hold
// filters the deliberate-looking accidentals too. `getMinHoldMs(kind)` supplies the per-gesture
// time; a plain `minHoldMs` is the fallback. Pure; see the test file.
export function createGestureTrigger({ getMinHoldMs, minHoldMs = DEFAULT_HOLD_MS, cooldownMs = 1500 } = {}) {
  const holdFor = (k) => {
    const v = getMinHoldMs ? getMinHoldMs(k) : minHoldMs;
    return Math.max(0, Number(v ?? minHoldMs) || 0);
  };
  let kind = null;
  let startedAt = 0;
  let firedAt = -Infinity;
  return {
    feed(k, now) {
      if (k !== kind) { kind = k; startedAt = now; } // a new (or lost) gesture restarts the hold clock
      if (!k) return null;
      if (now - startedAt >= holdFor(k) && now - firedAt >= cooldownMs) {
        firedAt = now;
        startedAt = now; // continued hold re-fires after another full hold (key repeat)
        return k;
      }
      return null;
    },
  };
}

// Palm height (0=frame top, 1=bottom) → scroll velocity in [-1, 1]. Negative = scroll up (hand
// above rest). Deadzone around the rest point, then a quadratic ramp over the calibrated range,
// so small drift does nothing and fine speeds live near the centre. Pure — see the test file.
export function scrollVelocity(y, calib = DEFAULT_HAND_CALIB, deadFrac = 0.18) {
  const { centerY, topY, bottomY } = calib;
  const half = Math.max(0.05, (bottomY - topY) / 2);
  const dead = deadFrac * half;
  const off = y - centerY;
  if (Math.abs(off) <= dead) return 0;
  const range = Math.max(0.05, off < 0 ? centerY - topY : bottomY - centerY);
  const t = Math.min(1, (Math.abs(off) - dead) / Math.max(0.02, range - dead));
  return Math.sign(off) * t * t;
}

// Wave = N direction reversals of sufficiently fast horizontal palm motion inside a short
// window, with a cooldown so one wave fires once. feed(x, now) → true when a wave completes.
export function createWaveDetector({ swing = 0.03, reversals = 3, windowMs = 1200, cooldownMs = 1600 } = {}) {
  let lastX = null;
  let lastDir = 0;
  let events = [];
  let firedAt = -Infinity;
  return {
    feed(x, now) {
      if (lastX == null) { lastX = x; return false; }
      const dx = x - lastX;
      lastX = x;
      if (Math.abs(dx) < swing) return false;
      const dir = Math.sign(dx);
      if (lastDir !== 0 && dir !== lastDir) {
        events.push(now);
        events = events.filter((t) => now - t <= windowMs);
        if (events.length >= reversals && now - firedAt > cooldownMs) {
          firedAt = now;
          events = [];
          lastDir = dir;
          return true;
        }
      }
      lastDir = dir;
      return false;
    },
    reset() { lastX = null; lastDir = 0; events = []; },
  };
}

// Pinch: thumb tip (4) and index tip (8) touching while middle/ring/pinky stay extended — the
// extension check keeps a closed fist (whose tips also bunch up) from reading as a pinch. All
// distances are in normalized frame coords, scaled by the wrist→middle-MCP span so it works at any
// distance from the camera. Pure — see the test file.
// ponytail: single-threshold heuristic; a landmark-angle model would be sturdier if this misfires.
export function isPinch(lm) {
  if (!lm || !lm[0] || !lm[4] || !lm[8] || !lm[9]) return false;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const span = Math.max(0.02, d(lm[0], lm[9])); // wrist → middle MCP
  if (d(lm[4], lm[8]) > span * 0.35) return false; // thumb+index must touch
  // at least two of middle/ring/pinky clearly extended (tip far from the wrist)
  let ext = 0;
  for (const tip of [12, 16, 20]) if (lm[tip] && d(lm[tip], lm[0]) > span * 1.45) ext++;
  return ext >= 2;
}

// Swipe = ONE fast sustained horizontal sweep (unlike the wave's back-and-forth): displacement
// accumulates while the direction holds; reaching `sweep` within `windowMs` arms a pending swipe
// that fires after `confirmMs` with no reversal — a wave's return stroke cancels it, so the two
// can coexist. feed(x, now) → 'left' | 'right' | null (frame-coordinate direction; the camera is
// unmirrored, so the USER's rightward sweep is x-decreasing — callers map that).
export function createSwipeDetector({ sweep = 0.24, minStep = 0.015, windowMs = 700, confirmMs = 320, cooldownMs = 1400 } = {}) {
  let lastX = null;
  let dir = 0;
  let cum = 0;
  let startT = 0;
  let pending = null; // { dir, at }
  let firedAt = -Infinity;
  return {
    feed(x, now) {
      const px = lastX;
      lastX = x;
      if (px == null) return null;
      const dx = x - px;
      const d = Math.abs(dx) >= minStep ? Math.sign(dx) : 0;
      if (pending) {
        if (d !== 0 && d !== pending.dir) { pending = null; dir = d; cum = dx; startT = now; return null; } // reversal = a wave, not a swipe
        if (now - pending.at >= confirmMs) {
          const out = pending.dir > 0 ? 'right' : 'left';
          pending = null; dir = 0; cum = 0;
          firedAt = now;
          return out;
        }
        return null;
      }
      if (d === 0) { if (now - startT > windowMs) { dir = 0; cum = 0; } return null; }
      if (d !== dir) { dir = d; cum = 0; startT = now; }
      cum += dx;
      if (Math.abs(cum) >= sweep && now - startT <= windowMs && now - firedAt > cooldownMs) {
        pending = { dir: d, at: now };
        cum = 0;
      }
      return null;
    },
    reset() { lastX = null; dir = 0; cum = 0; pending = null; },
  };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// onState: starting | watching | denied | unsupported | error | off
// onHand({ present, gesture, y, v }) fires every tick; onScroll(v) on velocity changes and while
// scrolling; onWave() once per wave; onGesture(kind) for held discrete gestures (thumbUp,
// thumbDown, fist, victory) — each gated by the `gestures` config.
export function createGestureMonitor({
  onState, onHand, onScroll, onWave, onGesture, onStream,
  calib = DEFAULT_HAND_CALIB, gestures = DEFAULT_GESTURES, holdMs = null, intervalMs = 100, deadFrac = 0.18,
} = {}) {
  let stream = null;
  let video = null;
  let recognizer = null;
  let timer = null;
  let running = false;
  let state = 'off';
  let cal = { ...DEFAULT_HAND_CALIB, ...(calib || {}) };
  let gest = { ...DEFAULT_GESTURES, ...(gestures || {}) };
  let hold = { ...(holdMs || {}) }; // per-gesture minimum hold time (ms); missing → the default
  let lastY = null; // latest palm height while a hand is visible (calibration reads this)
  let lastV = 0;
  let suppressScrollUntil = 0; // a wave/swipe wobbles y too — don't scroll off the gesture itself
  const wave = createWaveDetector();
  const swipe = createSwipeDetector();
  // Per-gesture hold time, read live so tuning it in Settings takes effect without a restart.
  const trigger = createGestureTrigger({ getMinHoldMs: (k) => hold[k] });

  const setState = (s) => { if (s !== state) { state = s; onState?.(s); } };
  const emitScroll = (v) => { if (v !== lastV) { lastV = v; onScroll?.(v); } else if (v) onScroll?.(v); };

  async function start() {
    if (running) return;
    running = true;
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); running = false; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
    } catch (e) {
      running = false;
      setState(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'error');
      return;
    }
    if (!running) { stream.getTracks().forEach((t) => t.stop()); return; }
    onStream?.(stream);
    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try { await video.play(); } catch { /* still readable for detection */ }
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      for (const delegate of ['GPU', 'CPU']) {
        try {
          recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
          });
          break;
        } catch { /* try next delegate */ }
      }
    } catch { /* handled below */ }
    if (!recognizer) { setState('unsupported'); stop(); return; }
    if (!running) { stop(); return; }
    timer = setInterval(tick, intervalMs);
    setState('watching');
  }

  function tick() {
    if (!running || !video || !recognizer || !video.videoWidth) return;
    let res;
    try { res = recognizer.recognizeForVideo(video, performance.now()); } catch { return; }
    const lm = res?.landmarks?.[0];
    const gesture = res?.gestures?.[0]?.[0]?.categoryName || null;
    // Which hand made it — MediaPipe labels handedness for a MIRRORED (selfie) view, and our raw
    // stream is unmirrored, so the label flips: their 'Left' is the user's RIGHT hand.
    const handed = res?.handednesses?.[0]?.[0]?.categoryName || res?.handedness?.[0]?.[0]?.categoryName || null;
    const hand = handed === 'Left' ? 'R' : handed === 'Right' ? 'L' : null;
    const now = Date.now();
    if (!lm || !lm[PALM]) {
      lastY = null;
      wave.reset();
      swipe.reset();
      emitScroll(0);
      onHand?.({ present: false, gesture: null, y: null, v: 0 });
      return;
    }
    const y = lm[PALM].y;
    const x = lm[PALM].x;
    lastY = y;
    const open = gesture === 'Open_Palm';
    if (gest.wave && open && wave.feed(x, now)) {
      suppressScrollUntil = now + 900;
      emitScroll(0);
      onWave?.(hand);
      onHand?.({ present: true, gesture, y, v: 0, hand });
      return;
    }
    // One-shot open-palm sweeps. The detector's directions are frame coords; the (unmirrored)
    // selfie camera flips them, so the USER's rightward sweep is frame-left — map accordingly.
    if ((gest.swipeLeft || gest.swipeRight) && open) {
      const sw = swipe.feed(x, now);
      if (sw) {
        const kind = sw === 'left' ? 'swipeRight' : 'swipeLeft';
        if (gest[kind]) {
          suppressScrollUntil = now + 600;
          emitScroll(0);
          onGesture?.(kind, hand);
          onHand?.({ present: true, gesture, y, v: 0, hand });
          return;
        }
      }
    } else swipe.reset();
    // Held discrete gestures — canned classifications plus the landmark-derived pinch. Only
    // enabled kinds accumulate hold ticks.
    let kind = GESTURE_BY_LABEL[gesture] || null;
    if (!kind && gest.pinch && isPinch(lm)) kind = 'pinch';
    const fired = trigger.feed(kind && gest[kind] ? kind : null, now);
    if (fired) onGesture?.(fired, hand);
    const v = gest.scroll && open && now > suppressScrollUntil ? scrollVelocity(y, cal, deadFrac) : 0;
    emitScroll(v);
    onHand?.({ present: true, gesture, y, v, hand });
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (recognizer) { try { recognizer.close(); } catch { /* ignore */ } recognizer = null; }
    if (video) { video.srcObject = null; video = null; }
    onStream?.(null);
    emitScroll(0);
    setState('off');
  }

  // Learn the user's rest / top / bottom palm heights (median of each ~2.5s phase). Requires a
  // visible hand; returns the calibration (and applies it) or null if a phase saw no hand or the
  // heights aren't sensibly ordered.
  async function runCalibration({ phaseMs = 2600 } = {}, onTick) {
    const samplePhase = async (phase) => {
      const ys = [];
      const t0 = Date.now();
      while (running && Date.now() - t0 < phaseMs) {
        if (typeof lastY === 'number') ys.push(lastY);
        onTick?.(phase, Math.ceil((phaseMs - (Date.now() - t0)) / 1000));
        await delay(120);
      }
      if (ys.length < 5) return null;
      ys.sort((a, b) => a - b);
      return ys[ys.length >> 1];
    };
    const centerY = await samplePhase('rest');
    const topY = await samplePhase('top');
    const bottomY = await samplePhase('bottom');
    if (centerY == null || topY == null || bottomY == null) return null;
    if (!(topY < centerY - 0.03 && bottomY > centerY + 0.03)) return null; // top must be above rest, bottom below
    cal = { centerY, topY, bottomY };
    return cal;
  }

  return {
    start,
    stop,
    runCalibration,
    getState: () => state,
    setCalib: (c) => { cal = { ...DEFAULT_HAND_CALIB, ...(c || {}) }; },
    setGestures: (g) => { gest = { ...DEFAULT_GESTURES, ...(g || {}) }; },
    setHoldMs: (h) => { hold = { ...(h || {}) }; },
  };
}
