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
// The discrete gestures default OFF — opt in to the ones you actually use.
export const DEFAULT_GESTURES = { scroll: true, wave: true, thumbUp: false, thumbDown: false, fist: false, victory: false };
export const GESTURE_INFO = {
  scroll: { icon: '✋', label: 'Palm joystick', desc: 'Open palm above/below your rest height scrolls up/down — farther is faster' },
  wave: { icon: '👋', label: 'Wave', desc: 'Wave side-to-side to toggle play/pause' },
  thumbUp: { icon: '👍', label: 'Thumb up', desc: 'Speed up (+25 WPM) — hold to repeat' },
  thumbDown: { icon: '👎', label: 'Thumb down', desc: 'Slow down (−25 WPM) — hold to repeat' },
  fist: { icon: '✊', label: 'Fist', desc: 'Pause reading (pause only — never starts playback)' },
  victory: { icon: '✌', label: 'Victory', desc: 'Jump to the next paragraph' },
};
const GESTURE_BY_LABEL = { Thumb_Up: 'thumbUp', Thumb_Down: 'thumbDown', Closed_Fist: 'fist', Victory: 'victory' };

// Hold-to-fire for discrete gestures: a classification must persist `holdTicks` consecutive
// feeds before it fires, then a cooldown gates the next fire (holding through the cooldown
// re-fires — natural key-repeat for the WPM nudges). Single-frame misclassifications — the main
// false-positive source — never accumulate enough ticks to fire. Pure; see the test file.
export function createGestureTrigger({ holdTicks = 4, cooldownMs = 1500 } = {}) {
  let kind = null;
  let ticks = 0;
  let firedAt = -Infinity;
  return {
    feed(k, now) {
      if (k !== kind) { kind = k; ticks = 0; }
      if (!k) return null;
      ticks++;
      if (ticks >= holdTicks && now - firedAt >= cooldownMs) {
        firedAt = now;
        ticks = 0;
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// onState: starting | watching | denied | unsupported | error | off
// onHand({ present, gesture, y, v }) fires every tick; onScroll(v) on velocity changes and while
// scrolling; onWave() once per wave; onGesture(kind) for held discrete gestures (thumbUp,
// thumbDown, fist, victory) — each gated by the `gestures` config.
export function createGestureMonitor({
  onState, onHand, onScroll, onWave, onGesture, onStream,
  calib = DEFAULT_HAND_CALIB, gestures = DEFAULT_GESTURES, intervalMs = 100, deadFrac = 0.18,
} = {}) {
  let stream = null;
  let video = null;
  let recognizer = null;
  let timer = null;
  let running = false;
  let state = 'off';
  let cal = { ...DEFAULT_HAND_CALIB, ...(calib || {}) };
  let gest = { ...DEFAULT_GESTURES, ...(gestures || {}) };
  let lastY = null; // latest palm height while a hand is visible (calibration reads this)
  let lastV = 0;
  let suppressScrollUntil = 0; // a wave wobbles y too — don't scroll off the wave itself
  const wave = createWaveDetector();
  const trigger = createGestureTrigger();

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
    const now = Date.now();
    if (!lm || !lm[PALM]) {
      lastY = null;
      wave.reset();
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
      onWave?.();
      onHand?.({ present: true, gesture, y, v: 0 });
      return;
    }
    // Held discrete gestures (thumb up/down, fist, victory) — only enabled kinds accumulate hold.
    const kind = GESTURE_BY_LABEL[gesture] || null;
    const fired = trigger.feed(kind && gest[kind] ? kind : null, now);
    if (fired) onGesture?.(fired);
    const v = gest.scroll && open && now > suppressScrollUntil ? scrollVelocity(y, cal, deadFrac) : 0;
    emitScroll(v);
    onHand?.({ present: true, gesture, y, v });
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
  };
}
