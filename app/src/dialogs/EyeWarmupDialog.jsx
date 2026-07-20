import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { EXERCISES, DEFAULT_IDS, MIN_MINUTES, MAX_MINUTES, buildPlan, planSeconds, TAU } from '../engine/eyeWarmup.js';
import { createGazeTracker, fitGazeModel, applyGazeModel, createSmoother, averageCalibSamples } from '../features/eyeTracking.js';

// Guided eye-warmup routine before a reading session: smooth pursuit (sweeps, figure-eight,
// orbits), saccade drills (jumps, corner darts), peripheral flashes, an accommodation pulse,
// and a palming rest. One canvas, one rAF loop; the per-frame low-alpha fill leaves glow
// trails behind the moving dot. Pattern math lives in engine/eyeWarmup.js.

const BG = '#080b12';

function glowDot(ctx, x, y, r, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function cross(ctx, x, y, s, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x, y + s);
  ctx.stroke();
  ctx.restore();
}

// One frame of the active exercise. w/h in CSS pixels; t = seconds into the exercise.
function drawExercise(ctx, w, h, ex, t) {
  const u = Math.min(t / ex.dur, 1);
  ctx.fillStyle = `rgba(8, 11, 18, ${ex.fade})`; // trail fade, not a clear
  ctx.fillRect(0, 0, w, h);

  const pad = 26;
  const px = (x) => pad + x * (w - 2 * pad);
  const py = (y) => pad + y * (h - 2 * pad);
  const d = ex.sample(t, u, ex.dur);

  if (ex.kind === 'dot') {
    glowDot(ctx, px(d.x), py(d.y), 9, ex.color);
  } else if (ex.kind === 'jump') {
    const x = px(d.x), y = py(d.y);
    if (d.age < 0.35) { // landing ripple
      ctx.save();
      ctx.strokeStyle = ex.color;
      ctx.globalAlpha = (1 - d.age / 0.35) * 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12 + d.age * 110, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    glowDot(ctx, x, y, 10, ex.color);
  } else if (ex.kind === 'flash') {
    cross(ctx, w / 2, h / 2, 11, 'rgba(255,255,255,0.9)');
    if (d.on) {
      const R = Math.min(w, h) / 2 - 30;
      const x = w / 2 + Math.cos(d.angle) * d.ecc * R * (w / Math.min(w, h));
      const y = h / 2 + Math.sin(d.angle) * d.ecc * R;
      ctx.save(); // glowing diamond
      ctx.translate(Math.min(Math.max(x, 24), w - 24), Math.min(Math.max(y, 24), h - 24));
      ctx.rotate(TAU / 8);
      ctx.shadowColor = ex.color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = ex.color;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    }
  } else if (ex.kind === 'focus') {
    const cx = w / 2, cy = h / 2;
    const R = (Math.min(w, h) / 2 - 34) * d.scale;
    ctx.save();
    ctx.strokeStyle = ex.color;
    ctx.shadowColor = ex.color;
    ctx.shadowBlur = 6 + 26 * d.scale; // softer when "near" (large)
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(R, 6), 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(R * 0.55, 3), 0, TAU);
    ctx.stroke();
    for (let k = 0; k < 4; k++) { // tick marks
      const a = (k / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10));
      ctx.stroke();
    }
    ctx.restore();
    glowDot(ctx, cx, cy, 5, ex.color);
  } else if (ex.kind === 'converge') {
    const cx = w / 2, cy = h / 2;
    const gap = d.offset * (Math.min(w, h) / 2 - 24) * (w / Math.min(w, h));
    cross(ctx, cx, cy, 8, 'rgba(255,255,255,0.28)'); // fixation reference
    glowDot(ctx, cx - gap, cy, 9, ex.color);
    glowDot(ctx, cx + gap, cy, 9, ex.color);
    ctx.fillStyle = BG;
    ctx.fillRect(cx - 44, h - 42, 88, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.near ? 'near — let them merge' : 'far — drift apart', cx, h - 27);
  } else if (ex.kind === 'blink') {
    const cx = w / 2, cy = h / 2;
    const openH = 1 - d.close; // 1 open, 0 shut
    const rw = Math.min(w, h) * 0.2;
    const rh = Math.min(w, h) * 0.13 * openH + 3;
    ctx.save();
    ctx.strokeStyle = ex.color;
    ctx.shadowColor = ex.color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw, rh, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    if (d.close < 0.4) glowDot(ctx, cx, cy, 8 * (1 - d.close), ex.color); // "iris" while open
    if (d.close > 0.55) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '600 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('blink', cx, cy + Math.min(w, h) * 0.24);
    }
  } else if (ex.kind === 'rest') {
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * (0.14 + 0.2 * d.breath);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, 'rgba(143, 160, 255, 0.4)');
    g.addColorStop(1, 'rgba(143, 160, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.fillStyle = BG; // solid patch: pinned label, no trail ghosting
    ctx.fillRect(cx - 80, h - 44, 160, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.inhale ? 'breathe in…' : 'breathe out…', cx, h - 28);
  }

  // countdown + per-exercise progress bar (solid patch behind the digits — the trail
  // fade would otherwise ghost the previous number under the new one)
  ctx.fillStyle = BG;
  ctx.fillRect(w - 56, 4, 52, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.max(Math.ceil(ex.dur - t), 0)), w - 12, 22);
  ctx.fillStyle = ex.color;
  ctx.fillRect(0, h - 3, u * w, 3);
  // The sample the caller can score gaze against — only the kinds with a single, unambiguous
  // target on screen (a moving or jumping dot) mean anything to "were you looking at it?".
  return (ex.kind === 'dot' || ex.kind === 'jump') ? { x: px(d.x), y: py(d.y) } : null;
}

// Where the tracker thinks you're looking: a hollow ring, deliberately unlike the drill's own dot.
function drawGaze(ctx, x, y, onTarget) {
  ctx.save();
  ctx.strokeStyle = onTarget ? 'rgba(125, 255, 138, 0.9)' : 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// Calibration frame: one target at a time, its ring closing as the sample fills.
function drawCalib(ctx, w, h, pt, progress, sampling, label) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const x = 30 + pt[0] * (w - 60);
  const y = 30 + pt[1] * (h - 60);
  ctx.save();
  ctx.strokeStyle = sampling ? '#7dff8a' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 22, -TAU / 4, -TAU / 4 + TAU * progress);
  ctx.stroke();
  ctx.restore();
  glowDot(ctx, x, y, 7, sampling ? '#7dff8a' : '#4fd8ff');
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, w / 2, h - 22);
}

// Calibration targets: centre, corners, edge midpoints. Nine points is the smallest grid that
// pins down both axes plus the head-pose terms without feeling like an eye exam.
const CALIB_POINTS = [
  [0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9],
  [0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5],
];
const GAZE_LABEL = {
  off: 'camera off', starting: 'starting the camera…', tracking: 'tracking',
  denied: 'camera permission denied', unsupported: 'no camera / face model on this device',
  error: 'camera or calibration failed',
};
const SETTLE_MS = 600;   // time to move your eyes to the new target before we start believing it
const SAMPLE_MS = 900;   // time spent collecting features for that target
// "Looking at it" = within this fraction of the stage's short side. Generous on purpose: webcam
// gaze is only accurate to a few degrees, and the smoother lags a moving target by a frame or two,
// so a tight radius would score a perfectly good pursuit as a miss.
const ON_TARGET_FRAC = 0.16;
// Webcam gaze arrives late: a frame interval (~60ms) plus the smoother's own lag. During a fast
// sweep the dot has moved a long way in that time, so scoring against its position RIGHT NOW marks
// a perfect pursuit as a miss. Score against where the dot was at any point in the last
// LAG_WINDOW_MS instead — that measures the eye, not the pipeline.
const LAG_WINDOW_MS = 260;

// Idle/done: a slow ambient glow so the stage never looks dead.
function drawAmbient(ctx, w, h, now) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const b = 0.5 - 0.5 * Math.cos(TAU * now / 6000);
  const R = Math.min(w, h) * (0.12 + 0.08 * b);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, R);
  g.addColorStop(0, 'rgba(79, 216, 255, 0.25)');
  g.addColorStop(1, 'rgba(79, 216, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Group the drills for the picker in canonical order, preserving first-seen group order.
const GROUPS = EXERCISES.reduce((acc, e) => {
  const g = acc.find((x) => x.name === e.group) || (acc.push({ name: e.group, items: [] }), acc[acc.length - 1]);
  g.items.push(e);
  return acc;
}, []);

export default function EyeWarmupDialog({ onClose }) {
  const { state, updateGlobal } = useApp();
  const ew = state.global.eyeWarmup || {};
  const [phase, setPhase] = useState('idle'); // idle | run | done
  const [exIndex, setExIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [minutes, setMinutes] = useState(ew.minutes || 3);
  // Selected drill ids, kept in canonical EXERCISES order so the routine always runs in a sensible sequence.
  const [selected, setSelected] = useState(() => {
    const want = new Set(Array.isArray(ew.exercises) && ew.exercises.length ? ew.exercises : DEFAULT_IDS);
    return EXERCISES.filter((e) => want.has(e.id)).map((e) => e.id);
  });
  const canvasRef = useRef(null);
  const tRef = useRef(0);

  // ── eye tracking ──────────────────────────────────────────────────────────
  // The camera feeds raw features; the calibration model turns those into a stage point. Both the
  // live point and the running score live in refs — the draw loop reads them every frame, and
  // re-rendering React 60×/s for a moving dot would be silly.
  const [gazeState, setGazeState] = useState('off'); // off|starting|tracking|denied|unsupported|error
  const [model, setModel] = useState(() => state.global.eyeWarmup?.gaze || null);
  const [calib, setCalib] = useState(null); // { i, phase: 'settle'|'sample' } while calibrating
  const [score, setScore] = useState(null); // { frames, hits } of the finished run
  const trackerRef = useRef(null);
  const featRef = useRef(null);      // latest feature vector from the camera (null = no face)
  const smoothRef = useRef(createSmoother(0.5)); // enough to kill the jitter, not enough to lag a sweep
  const gazeRef = useRef(null);      // latest smoothed gaze point, 0..1 stage coords
  const modelRef = useRef(model);
  const scoreRef = useRef({ frames: 0, hits: 0 });
  const targetHistRef = useRef([]); // recent target positions, for lag-tolerant scoring
  const calibRef = useRef(null);
  modelRef.current = model;

  useEffect(() => () => { trackerRef.current?.stop(); }, []); // camera off when the dialog closes

  function startGaze() {
    if (trackerRef.current) return;
    smoothRef.current.reset();
    trackerRef.current = createGazeTracker({
      // Test/dev seam: a page can install a synthetic feature source instead of the camera, so the
      // calibration walk and the follow scoring can be driven without a real face in front of it.
      source: typeof window !== 'undefined' ? window.__tachyreadGazeSource || null : null,
      onState: (s) => {
        setGazeState(s);
        if (s !== 'tracking') { featRef.current = null; gazeRef.current = null; }
      },
      onFeatures: (f) => {
        featRef.current = f;
        const g = f && modelRef.current ? applyGazeModel(modelRef.current, f) : null;
        gazeRef.current = f ? smoothRef.current.push(g) : null;
      },
    });
    trackerRef.current.start();
  }
  function stopGaze() {
    trackerRef.current?.stop();
    trackerRef.current = null;
    featRef.current = null;
    gazeRef.current = null;
    setGazeState('off');
    setCalib(null);
  }

  // Calibration walk: for each target, ignore the first SETTLE_MS (your eyes are still travelling),
  // then average the features over SAMPLE_MS. A target that never saw a face is simply dropped —
  // fitGazeModel refuses to fit if too few survive.
  useEffect(() => {
    if (!calib) return undefined;
    calibRef.current = calib;
    const started = Date.now();
    const samples = calib.samples;
    const id = setInterval(() => {
      const dt = Date.now() - started;
      const sampling = dt > SETTLE_MS;
      if (sampling && featRef.current) samples.push({ f: featRef.current, x: CALIB_POINTS[calib.i][0], y: CALIB_POINTS[calib.i][1] });
      if (dt < SETTLE_MS + SAMPLE_MS) {
        calibRef.current = { ...calib, sampling, progress: Math.min(1, dt / (SETTLE_MS + SAMPLE_MS)) };
        return;
      }
      clearInterval(id);
      if (calib.i + 1 < CALIB_POINTS.length) { setCalib({ i: calib.i + 1, samples }); return; }
      const m = fitGazeModel(averageCalibSamples(samples));
      setCalib(null);
      calibRef.current = null;
      if (m) {
        setModel(m);
        updateGlobal({ eyeWarmup: { ...ew, gaze: m } });
      } else {
        setGazeState('error');
      }
    }, 60);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calib]);

  const plan = useMemo(() => buildPlan(selected, minutes * 60), [selected, minutes]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const runRef = useRef({});
  useEffect(() => { runRef.current = { phase, exIndex, paused }; }, [phase, exIndex, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let last = performance.now();
    let lastEx = -1;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        lastEx = -1;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const run = runRef.current;
      const routine = planRef.current;
      const cal = calibRef.current;
      if (cal) { // calibration owns the stage while it runs
        lastEx = -1;
        drawCalib(ctx, rect.width, rect.height, CALIB_POINTS[cal.i], cal.progress || 0, !!cal.sampling,
          `Look straight at the dot — ${cal.i + 1} / ${CALIB_POINTS.length}`);
        return;
      }
      if (run.phase !== 'run' || !routine.length) {
        drawAmbient(ctx, rect.width, rect.height, now);
        const gi = gazeRef.current;
        if (gi) drawGaze(ctx, gi.x * rect.width, gi.y * rect.height, false);
        return;
      }
      const ex = routine[Math.min(run.exIndex, routine.length - 1)];
      if (run.exIndex !== lastEx) { // hard clear between exercises so trails don't linger
        lastEx = run.exIndex;
        targetHistRef.current.length = 0; // a new drill's dot starts somewhere else entirely
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      if (!run.paused) tRef.current += dt;
      if (tRef.current >= ex.dur) {
        tRef.current = 0;
        if (run.exIndex + 1 >= routine.length) { setScore({ ...scoreRef.current }); setPhase('done'); }
        else setExIndex(run.exIndex + 1);
        return;
      }
      const target = drawExercise(ctx, rect.width, rect.height, ex, tRef.current);
      // Score the follow: for target-bearing drills, how often is the gaze ring near where the dot
      // is — or was a moment ago (see LAG_WINDOW_MS).
      const hist = targetHistRef.current;
      if (target) {
        hist.push({ ms: now, x: target.x, y: target.y });
        while (hist.length && now - hist[0].ms > LAG_WINDOW_MS) hist.shift();
      } else if (hist.length) hist.length = 0;
      const g = gazeRef.current;
      if (g) {
        const gx = g.x * rect.width, gy = g.y * rect.height;
        let on = false;
        if (target) {
          const tol = ON_TARGET_FRAC * Math.min(rect.width, rect.height);
          on = hist.some((p) => Math.hypot(gx - p.x, gy - p.y) < tol);
          scoreRef.current.frames++;
          if (on) scoreRef.current.hits++;
        }
        drawGaze(ctx, gx, gy, on);
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function persist() { updateGlobal({ eyeWarmup: { ...ew, minutes, exercises: selected } }); }
  function begin() {
    if (!plan.length) return;
    persist();
    scoreRef.current = { frames: 0, hits: 0 };
    setScore(null);
    jumpTo(0);
  }
  function jumpTo(i) {
    tRef.current = 0;
    setExIndex(i);
    setPaused(false);
    setPhase('run');
  }

  // Live follow-percentage for the controls row. Polled rather than pushed — the draw loop updates
  // scoreRef every frame and re-rendering at that rate for one number is pointless.
  const [liveScore, setLiveScore] = useState(0);
  useEffect(() => {
    if (phase !== 'run' || !model || gazeState !== 'tracking') return undefined;
    const id = setInterval(() => {
      const s = scoreRef.current;
      setLiveScore(s.frames ? Math.round((s.hits / s.frames) * 100) : 0);
    }, 500);
    return () => clearInterval(id);
  }, [phase, model, gazeState]);
  function toggle(id) {
    setSelected((cur) => {
      const has = cur.includes(id);
      const next = new Set(has ? cur.filter((x) => x !== id) : [...cur, id]);
      return EXERCISES.filter((e) => next.has(e.id)).map((e) => e.id);
    });
  }

  const ex = plan[Math.min(exIndex, Math.max(0, plan.length - 1))];
  const planMin = Math.round(planSeconds(plan) / 60 * 10) / 10;
  return (
    <Dialog title="Eye warmup — loosen up before you read" onClose={onClose} width={760}>
      <div className="eye-warmup">
        {phase === 'run' && (
          <div className="ew-chips">
            {plan.map((e, i) => (
              <button
                key={e.id}
                className={`ew-chip${i === exIndex ? ' active' : ''}${i < exIndex ? ' done' : ''}`}
                style={i === exIndex ? { borderColor: e.color, color: e.color } : undefined}
                onClick={() => jumpTo(i)}
                title={`${e.tip} (${e.dur}s)`}
              >
                {e.name}
              </button>
            ))}
          </div>
        )}
        <div className="ew-stage">
          <canvas ref={canvasRef} />
          {/* The setup panel covers the stage, and calibration needs the stage — step aside for it. */}
          {phase === 'idle' && !calib && (
            <div className="ew-overlay ew-setup">
              <p className="settings-note">Pick your drills and length. Keep your head still; let only your eyes move.</p>
              <label className="ew-slider">
                <span>Total time: <b>{minutes} min</b> <span className="settings-note">({selected.length} drill{selected.length === 1 ? '' : 's'} · ~{planMin} min)</span></span>
                <input type="range" min={MIN_MINUTES} max={MAX_MINUTES} step={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
              </label>
              <div className="ew-picker">
                {GROUPS.map((g) => (
                  <div key={g.name} className="ew-picker-group">
                    <div className="ew-picker-head">{g.name}</div>
                    <div className="ew-picker-items">
                      {g.items.map((e) => (
                        <button
                          key={e.id}
                          className={`ew-pick${selected.includes(e.id) ? ' on' : ''}`}
                          style={selected.includes(e.id) ? { borderColor: e.color } : undefined}
                          onClick={() => toggle(e.id)}
                          title={e.tip}
                        >
                          {selected.includes(e.id) ? '◉' : '○'} {e.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="ew-gaze">
                <div className="ew-gaze-head">
                  👁 Eye tracking <span className="ew-beta">beta</span>
                  <span className={`ew-gaze-dot st-${gazeState}`} />
                  <span className="settings-note">{GAZE_LABEL[gazeState] || gazeState}</span>
                </div>
                <div className="ew-gaze-actions" title="Watches your eyes with the front camera to show where you're looking and score how well you follow each drill. Runs entirely on this device — nothing is recorded or uploaded.">
                  {gazeState === 'off' || gazeState === 'denied' || gazeState === 'error' || gazeState === 'unsupported'
                    ? <button onClick={startGaze}>Turn on camera</button>
                    : <button onClick={stopGaze}>Turn off camera</button>}
                  <button
                    disabled={gazeState !== 'tracking' || !!calib}
                    onClick={() => setCalib({ i: 0, samples: [] })}
                    title="Look at each dot in turn — about 15 seconds. Sit as you normally read; the fit is learnt for that position."
                  >
                    {model ? 'Recalibrate ⌖' : 'Calibrate ⌖'}
                  </button>
                  {model && (
                    <span className="settings-note" title="Average miss on the calibration points themselves — lower is better.">
                      calibrated · fit ±{Math.round((model.rms || 0) * 100)}%
                    </span>
                  )}
                </div>
                <p className="settings-note">Shows where you&apos;re looking and scores your follow. All on-device — nothing is recorded or uploaded.</p>
              </div>
              <div className="ew-setup-actions">
                <button className="toggle-on" disabled={!plan.length} onClick={begin}>Begin warmup ▸</button>
                <button onClick={() => setSelected(DEFAULT_IDS)}>Reset to default set</button>
              </div>
            </div>
          )}
          {phase === 'done' && (
            <div className="ew-overlay">
              <p className="settings-note">Done — eyes warm. Happy reading.</p>
              {score && score.frames > 30 && (
                <p className="ew-score">
                  👁 On target <b>{Math.round((score.hits / score.frames) * 100)}%</b> of the tracked drills
                </p>
              )}
              <div className="ew-setup-actions">
                <button className="toggle-on" onClick={() => jumpTo(0)}>Again ↻</button>
                <button onClick={() => setPhase('idle')}>Change drills ⚙</button>
              </div>
            </div>
          )}
        </div>
        {phase === 'run' && ex && (
          <div className="ew-controls">
            <span className="ew-tip">{ex.tip}</span>
            <span className="grow" />
            {model && gazeState === 'tracking' && (
              <span className="ew-live-score" title="How much of the tracked drills your gaze spent on the target">👁 {liveScore}%</span>
            )}
            <button onClick={() => setPhase('idle')}>⚙ Setup</button>
            <button onClick={() => setPaused((p) => !p)}>{paused ? 'Resume ▸' : 'Pause ⏸'}</button>
            <button onClick={() => (exIndex + 1 >= plan.length ? setPhase('done') : jumpTo(exIndex + 1))}>Skip ▸</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
