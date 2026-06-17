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
      if (!lm) return { present: false, facing: false, eyesOpen: null };
      // eyes-open from blink blendshapes
      let eyesOpen = null;
      const cats = res.faceBlendshapes?.[0]?.categories;
      if (cats) {
        const score = (name) => cats.find((c) => c.categoryName === name)?.score ?? 0;
        eyesOpen = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2 < BLINK_CLOSED;
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
      return { present: true, facing, eyesOpen };
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
      return { present, facing: present && looksForward(faces[0] || {}), eyesOpen: null };
    },
    close() {},
  };
}

// onState: starting | watching | away | drowsy | unsupported | denied | error | off
export function createAttentionMonitor({
  onState, onAttention, onDoze,
  intervalMs = 250, attentionGraceMs = 1300, dozeMs = 7000, absentMs = 20000,
} = {}) {
  let stream = null;
  let video = null;
  let backend = null;
  let timer = null;
  let running = false;
  let lastAttentive = 0;
  let lastEyesOpen = 0;
  let lastPresent = 0;
  let state = 'off';
  let attentive = true;
  let dozing = false;

  const setState = (s) => { if (s !== state) { state = s; onState?.(s); } };
  const setAttentive = (v) => { if (v !== attentive) { attentive = v; onAttention?.(v); } };
  const setDozing = (v) => { if (v !== dozing) { dozing = v; onDoze?.(v); } };

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
    if (r.present) lastPresent = now;
    if (r.eyesOpen === true) lastEyesOpen = now;
    if (r.facing && r.eyesOpen !== false) lastAttentive = now;

    const att = now - lastAttentive <= attentionGraceMs;
    const eyesClosedLong = backend.eyesAvail && now - lastEyesOpen > dozeMs && now - lastPresent < absentMs;
    const absentLong = now - lastPresent > absentMs;
    const dz = eyesClosedLong || absentLong;

    setAttentive(att);
    setDozing(dz);
    setState(dz ? 'drowsy' : att ? 'watching' : 'away');
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (backend) { backend.close(); backend = null; }
    if (video) { video.srcObject = null; video = null; }
    setState('off');
    setAttentive(true);
    setDozing(false);
  }

  return { start, stop, getState: () => state, eyesAvailable: () => !!backend?.eyesAvail };
}
