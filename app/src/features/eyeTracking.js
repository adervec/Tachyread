// On-device gaze tracking (experimental) — where on the stage are you actually looking?
//
// Runs entirely in the browser off the MediaPipe FaceLandmarker mesh, which includes the two iris
// rings (landmarks 468–477). No frame ever leaves the machine and nothing is recorded.
//
// How it works: per frame we reduce the mesh to four numbers — how far each iris sits across its
// eye opening (horizontal + vertical), plus head yaw and pitch — and map those to a screen point
// with an affine model fitted during calibration. That's the cheap, classic webcam-gaze approach:
// no per-user 3-D eye model, just "look at these dots and we'll learn your face". Accuracy is
// roughly a fist at arm's length, which is plenty for warmup drills and nowhere near enough to,
// say, drive a cursor.
//
// The math half (gazeFeatures / fitGazeModel / applyGazeModel) is pure and unit-tested in
// eyeTracking.test.mjs; only createGazeTracker touches the camera.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MP_VERSION = '0.10.35';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Face-mesh indices. Iris centres come from the refined (478-point) mesh; the rest are the eye
// corners / lids and the two face-contour points used as a size reference.
const IDX = {
  lIris: 468, rIris: 473,
  lOuter: 33, lInner: 133, lTop: 159, lBottom: 145,
  rInner: 362, rOuter: 263, rTop: 386, rBottom: 374,
  nose: 1, faceL: 234, faceR: 454, chin: 152, brow: 10,
};

export const GAZE_FEATURES = 4; // [irisX, irisY, yaw, pitch]

// Reduce a landmark array to the feature vector the model is fitted on, or null if the mesh is
// missing the iris points (an unrefined 468-point model — gaze isn't recoverable from those).
export function gazeFeatures(lm) {
  if (!lm || !lm[IDX.rIris] || !lm[IDX.lIris]) return null;
  const p = (i) => lm[i];
  const span = (a, b) => b - a;
  // Iris position inside each eye opening, 0..1 across and down. Both eyes are averaged: one eye
  // alone is noisier, and squinting/asymmetry cancels out.
  const eye = (iris, inner, outer, top, bottom) => {
    const wx = span(p(inner).x, p(outer).x);
    const wy = span(p(top).y, p(bottom).y);
    if (Math.abs(wx) < 1e-6 || Math.abs(wy) < 1e-6) return null;
    return {
      x: (p(iris).x - p(inner).x) / wx,
      y: (p(iris).y - p(top).y) / wy,
    };
  };
  const l = eye(IDX.lIris, IDX.lInner, IDX.lOuter, IDX.lTop, IDX.lBottom);
  const r = eye(IDX.rIris, IDX.rInner, IDX.rOuter, IDX.rTop, IDX.rBottom);
  if (!l || !r) return null;

  // Head pose, roughly: the nose's offset from the face box. Feeding these to the model lets it
  // absorb small head movements instead of reading them as gaze.
  const fw = span(p(IDX.faceL).x, p(IDX.faceR).x);
  const fh = span(p(IDX.brow).y, p(IDX.chin).y);
  const yaw = Math.abs(fw) > 1e-6 ? (p(IDX.nose).x - (p(IDX.faceL).x + p(IDX.faceR).x) / 2) / fw : 0;
  const pitch = Math.abs(fh) > 1e-6 ? (p(IDX.nose).y - (p(IDX.brow).y + p(IDX.chin).y) / 2) / fh : 0;

  return [(l.x + r.x) / 2, (l.y + r.y) / 2, yaw, pitch];
}

// Solve (AᵀA + λI)x = Aᵀb by Gaussian elimination with partial pivoting. n is small (5), so the
// naive version is fine and has no dependency. Returns null if the system is degenerate.
function solve(m, b) {
  const n = b.length;
  const a = m.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]); // Gauss-Jordan leaves only the diagonal
}

// Fit screen position from features. samples: [{ f: number[GAZE_FEATURES], x, y }] with x/y in 0..1
// stage coordinates. Needs at least GAZE_FEATURES + 1 distinct samples; ridge λ keeps a user who
// barely moved their eyes from producing a wild extrapolating model.
export function fitGazeModel(samples, lambda = 1e-4) {
  const rows = (samples || []).filter((s) => Array.isArray(s.f) && s.f.length === GAZE_FEATURES);
  const n = GAZE_FEATURES + 1; // + bias
  if (rows.length < n) return null;
  const ata = Array.from({ length: n }, () => new Array(n).fill(0));
  const atx = new Array(n).fill(0);
  const aty = new Array(n).fill(0);
  for (const s of rows) {
    const v = [...s.f, 1];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) ata[i][j] += v[i] * v[j];
      atx[i] += v[i] * s.x;
      aty[i] += v[i] * s.y;
    }
  }
  for (let i = 0; i < n; i++) ata[i][i] += lambda;
  const ax = solve(ata, atx); // solve() works on its own copy, so ata is reusable
  const ay = solve(ata, aty);
  if (!ax || !ay) return null;
  // Residual error on the calibration points themselves — shown to the user as "fit quality".
  const model = { ax, ay };
  let err = 0;
  for (const s of rows) {
    const g = applyGazeModel(model, s.f);
    err += Math.hypot(g.x - s.x, g.y - s.y);
  }
  model.rms = err / rows.length;
  return model;
}

export function applyGazeModel(model, f) {
  if (!model || !f) return null;
  const v = [...f, 1];
  const dot = (a) => a.reduce((s, k, i) => s + k * v[i], 0);
  return { x: dot(model.ax), y: dot(model.ay) };
}

// Exponential smoothing — raw per-frame gaze jitters by a few percent of the stage, which reads as
// a twitching dot. alpha is the weight of the NEW sample (lower = smoother, laggier).
// Collapse a calibration walk into one mean feature vector per target, so a long dwell can't
// outvote a short one when the model is fitted.
export function averageCalibSamples(samples) {
  const byPoint = new Map();
  for (const s of samples || []) {
    if (!Array.isArray(s.f) || s.f.length !== GAZE_FEATURES) continue;
    const k = `${s.x},${s.y}`;
    const cur = byPoint.get(k) || { n: 0, f: new Array(GAZE_FEATURES).fill(0), x: s.x, y: s.y };
    cur.n++;
    for (let i = 0; i < GAZE_FEATURES; i++) cur.f[i] += s.f[i];
    byPoint.set(k, cur);
  }
  return [...byPoint.values()].map((c) => ({ f: c.f.map((v) => v / c.n), x: c.x, y: c.y }));
}

export function createSmoother(alpha = 0.35) {
  let cur = null;
  return {
    push(p) {
      if (!p) return cur;
      cur = cur ? { x: cur.x + alpha * (p.x - cur.x), y: cur.y + alpha * (p.y - cur.y) } : { ...p };
      return cur;
    },
    reset() { cur = null; },
    get() { return cur; },
  };
}

// ── camera side ─────────────────────────────────────────────────────────────────────────────────
// onFeatures(f | null) fires every frame with the raw feature vector (null = no face). onState:
// starting | tracking | denied | unsupported | error | off.
// `source` is a test seam: pass { start, read, stop } to drive the tracker without a camera.
export function createGazeTracker({ onFeatures, onState, intervalMs = 60, source = null } = {}) {
  let stream = null, video = null, landmarker = null, timer = null, running = false;
  let state = 'off';
  const setState = (s) => { if (s !== state) { state = s; onState?.(s); } };

  async function start() {
    if (running) return;
    running = true;
    setState('starting');
    if (source) {
      try { await source.start?.(); } catch { setState('error'); running = false; return; }
      timer = setInterval(() => onFeatures?.(source.read()), intervalMs);
      setState('tracking');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); running = false; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
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
    try { await video.play(); } catch { /* frames are still readable */ }
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      for (const delegate of ['GPU', 'CPU']) {
        try {
          landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
          });
          break;
        } catch { /* try next delegate */ }
      }
    } catch { /* handled below */ }
    if (!running) { stop(); return; }
    if (!landmarker) { setState('unsupported'); stop(); return; }
    timer = setInterval(tick, intervalMs);
    setState('tracking');
  }

  function tick() {
    if (!running || !video || !landmarker) return;
    let f = null;
    try {
      const res = landmarker.detectForVideo(video, performance.now());
      f = gazeFeatures(res.faceLandmarks?.[0]);
    } catch { /* transient frame error */ }
    onFeatures?.(f);
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (source) { try { source.stop?.(); } catch { /* ignore */ } }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (landmarker) { try { landmarker.close(); } catch { /* ignore */ } landmarker = null; }
    if (video) { video.srcObject = null; video = null; }
    setState('off');
  }

  return { start, stop, getState: () => state };
}
