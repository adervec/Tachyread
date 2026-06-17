// On-device webcam attention + doze monitor (experimental). Watches the user via the front camera
// and reports two signals the app acts on:
//   • attention — are you facing the screen with your eyes open? (drives the visual reading pause)
//   • doze      — have your eyes been shut a while, or have you been gone a while? (stops read-aloud)
//
// Everything runs locally: frames are analysed in the browser and are never recorded or uploaded.
//
// Two detection backends, best first:
//   1. MediaPipe FaceLandmarker — gives eye-blink blendshapes, so we know eyes open vs closed and can
//      estimate head yaw (facing). The model + wasm load from a CDN on first use (like the OCR data),
//      so this needs network the first time and a WebGL-capable browser.
//   2. The browser FaceDetector — presence/forward-facing only (no eye state); doze then falls back to
//      "absent for a while".
// If neither is available the monitor reports 'unsupported' and never pauses anything.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MP_VERSION = '0.10.35';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const BLINK_CLOSED = 0.5; // mean eyeBlink blendshape score above this = eyes shut

export function cameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
export function faceDetectionSupported() {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
}

// ── backend 1: MediaPipe FaceLandmarker (eyes-open + yaw) ────────────────────────────────────────
async function createLandmarkBackend() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  let landmarker;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      break;
    } catch { /* try next delegate */ }
  }
  if (!landmarker) throw new Error('FaceLandmarker init failed');
  return {
    eyesAvail: true,
    detect(video, tsMs) {
      const res = landmarker.detectForVideo(video, tsMs);
      const lm = res.faceLandmarks?.[0];
      if (!lm) return { present: false, facing: false, blinkScore: null };
      // raw eye-blink score (0 = open, 1 = shut); the monitor applies the (calibrated) threshold.
      let blinkScore = null;
      const cats = res.faceBlendshapes?.[0]?.categories;
      if (cats) {
        const score = (name) => cats.find((c) => c.categoryName === name)?.score ?? 0;
        blinkScore = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2;
      }
      // rough yaw: nose tip relative to the two outer eye corners (0.5 = centred / facing forward)
      let facing = true;
      if (lm[1] && lm[33] && lm[263]) {
        const span = lm[263].x - lm[33].x;
        if (Math.abs(span) > 1e-3) {
          const r = (lm[1].x - lm[33].x) / span;
          facing = r > 0.27 && r < 0.73;
        }
      }
      // face width as a fraction of the frame (left/right face-contour landmarks) — a distance proxy.
      const faceSpan = lm[234] && lm[454] ? Math.abs(lm[454].x - lm[234].x) : null;
      return { present: true, facing, blinkScore, faceSpan };
    },
    close() { try { landmarker.close(); } catch { /* ignore */ } },
  };
}

// ── backend 2: browser FaceDetector (presence / forward-facing only) ─────────────────────────────
function looksForward(face) {
  const eyes = (face.landmarks || []).filter((l) => l.type === 'eye');
  if (eyes.length >= 2 && eyes[0].locations?.[0] && eyes[1].locations?.[0]) {
    const a = eyes[0].locations[0];
    const b = eyes[1].locations[0];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx > 8 && dy <= dx;
  }
  return true;
}
function createFaceDetectorBackend() {
  const det = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
  return {
    eyesAvail: false,
    async detect(video) {
      let faces = [];
      try { faces = await det.detect(video); } catch { /* transient */ }
      const present = faces.length > 0;
      const w = video.videoWidth || 320;
      const faceSpan = present && faces[0].boundingBox ? faces[0].boundingBox.width / w : null;
      return { present, facing: present && looksForward(faces[0] || {}), blinkScore: null, faceSpan };
    },
    close() {},
  };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// onState: starting | watching | away | drowsy | unsupported | denied | error | off
export function createAttentionMonitor({
  onState, onAttention, onDoze, onAway, onProximity, onStream, blinkThreshold = BLINK_CLOSED,
  intervalMs = 250, attentionGraceMs = 1300, dozeMs = 7000, absentMs = 20000,
  proximityThreshold = 0.52, proximityHoldMs = 2500,
} = {}) {
  let stream = null;
  let video = null;
  let backend = null;
  let timer = null;
  let running = false;
  let lastAttentive = 0;
  let lastEyesOpen = 0;
  let lastPresent = 0;
  let attentiveLostAt = 0; // when attention was continuously lost (for the away alarm)
  let tooCloseSince = 0;   // when the face first looked too close (for the posture nudge)
  let tooClose = false;
  let lastBlinkScore = null; // latest raw blink score (for calibration), null when no eye data
  let threshold = blinkThreshold;
  let state = 'off';
  let attentive = true;
  let dozing = false;

  const setState = (s) => { if (s !== state) { state = s; onState?.(s); } };
  const setAttentive = (v) => { if (v !== attentive) { attentive = v; onAttention?.(v); } };
  const setDozing = (v) => { if (v !== dozing) { dozing = v; onDoze?.(v); } };
  const setTooClose = (v) => { if (v !== tooClose) { tooClose = v; onProximity?.(v); } };

  async function start() {
    if (running) return;
    running = true;
    setState('starting');
    if (!cameraSupported()) { setState('unsupported'); running = false; return; }
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
    try { backend = await createLandmarkBackend(); }
    catch { backend = faceDetectionSupported() ? createFaceDetectorBackend() : null; }
    if (!running) { stop(); return; }
    if (!backend) { setState('unsupported'); stop(); return; }
    const now = Date.now();
    lastAttentive = lastEyesOpen = lastPresent = now;
    timer = setInterval(tick, intervalMs);
    setState('watching');
  }

  async function tick() {
    if (!running || !video || !backend) return;
    let r;
    try { r = await backend.detect(video, performance.now()); } catch { return; }
    if (!r) return;
    const now = Date.now();
    const score = typeof r.blinkScore === 'number' ? r.blinkScore : null;
    lastBlinkScore = score;
    const eyesOpen = score != null ? score < threshold : null; // null = no eye data (presence-only)
    if (r.present) lastPresent = now;
    if (eyesOpen === true) lastEyesOpen = now;
    if (r.facing && eyesOpen !== false) lastAttentive = now;

    const att = now - lastAttentive <= attentionGraceMs;
    const eyesClosedLong = backend.eyesAvail && now - lastEyesOpen > dozeMs && now - lastPresent < absentMs;
    const absentLong = now - lastPresent > absentMs;
    const dz = eyesClosedLong || absentLong;

    setAttentive(att);
    setDozing(dz);
    // Continuous time not-attentive, for the escalating away alarm (0 while engaged).
    if (att) attentiveLostAt = 0;
    else if (!attentiveLostAt) attentiveLostAt = now;
    onAway?.(att ? 0 : now - attentiveLostAt);

    // Posture nudge: face filling too much of the frame, sustained.
    const closeNow = typeof r.faceSpan === 'number' && r.faceSpan > proximityThreshold;
    if (closeNow) { if (!tooCloseSince) tooCloseSince = now; } else { tooCloseSince = 0; }
    setTooClose(!!tooCloseSince && now - tooCloseSince > proximityHoldMs);

    setState(dz ? 'drowsy' : att ? 'watching' : 'away');
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (backend) { backend.close(); backend = null; }
    if (video) { video.srcObject = null; video = null; }
    onStream?.(null);
    setState('off');
    setAttentive(true);
    setDozing(false);
  }

  // Learn the user's eyes-open vs eyes-shut blink scores so the threshold fits their face / glasses /
  // lighting. Samples the live score over an open phase then a closed phase; returns the chosen
  // threshold (and applies it). Needs the eye-capable backend; returns null otherwise.
  async function runCalibration({ openMs = 2800, closedMs = 2800 } = {}, onTick) {
    if (!backend?.eyesAvail) return null;
    const sampleAvg = async (ms, phase) => {
      const scores = [];
      const startTs = Date.now();
      while (running && Date.now() - startTs < ms) {
        if (typeof lastBlinkScore === 'number') scores.push(lastBlinkScore);
        onTick?.(phase, Math.ceil((ms - (Date.now() - startTs)) / 1000));
        await delay(120);
      }
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    };
    const open = await sampleAvg(openMs, 'open');
    const closed = await sampleAvg(closedMs, 'closed');
    let t;
    if (open != null && closed != null && closed > open + 0.1) t = (open + closed) / 2;
    else if (open != null) t = Math.min(0.6, open + 0.3);
    else return null;
    threshold = t;
    return { open, closed, threshold: t };
  }

  return {
    start,
    stop,
    getState: () => state,
    eyesAvailable: () => !!backend?.eyesAvail,
    getBlinkScore: () => lastBlinkScore,
    setBlinkThreshold: (v) => { if (typeof v === 'number') threshold = v; },
    runCalibration,
  };
}
