import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { EXERCISES, TOTAL_SECONDS, TAU } from '../engine/eyeWarmup.js';

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
}

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

export default function EyeWarmupDialog({ onClose }) {
  const [phase, setPhase] = useState('idle'); // idle | run | done
  const [exIndex, setExIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const runRef = useRef({});
  useEffect(() => {
    runRef.current = { phase, exIndex, paused };
  }, [phase, exIndex, paused]);

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
      if (run.phase !== 'run') {
        drawAmbient(ctx, rect.width, rect.height, now);
        return;
      }
      const ex = EXERCISES[run.exIndex];
      if (run.exIndex !== lastEx) { // hard clear between exercises so trails don't linger
        lastEx = run.exIndex;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      if (!run.paused) tRef.current += dt;
      if (tRef.current >= ex.dur) {
        tRef.current = 0;
        if (run.exIndex + 1 >= EXERCISES.length) setPhase('done');
        else setExIndex(run.exIndex + 1);
        return;
      }
      drawExercise(ctx, rect.width, rect.height, ex, tRef.current);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function jumpTo(i) {
    tRef.current = 0;
    setExIndex(i);
    setPaused(false);
    setPhase('run');
  }

  const ex = EXERCISES[exIndex];
  return (
    <Dialog title="Eye warmup — loosen up before you read" onClose={onClose} width={720}>
      <div className="eye-warmup">
        <div className="ew-chips">
          {EXERCISES.map((e, i) => (
            <button
              key={e.id}
              className={`ew-chip${phase === 'run' && i === exIndex ? ' active' : ''}${phase !== 'idle' && i < exIndex ? ' done' : ''}`}
              style={phase === 'run' && i === exIndex ? { borderColor: e.color, color: e.color } : undefined}
              onClick={() => jumpTo(i)}
              title={`${e.tip} (${e.dur}s)`}
            >
              {e.name}
            </button>
          ))}
        </div>
        <div className="ew-stage">
          <canvas ref={canvasRef} />
          {phase === 'idle' && (
            <div className="ew-overlay">
              <p className="settings-note">Eight short drills — pursuit, saccades, peripheral vision, focus, rest. About {Math.round(TOTAL_SECONDS / 60)} minutes. Keep your head still; let only your eyes move.</p>
              <button className="toggle-on" onClick={() => jumpTo(0)}>Begin warmup ▸</button>
            </div>
          )}
          {phase === 'done' && (
            <div className="ew-overlay">
              <p className="settings-note">Done — eyes warm. Happy reading.</p>
              <button className="toggle-on" onClick={() => jumpTo(0)}>Again ↻</button>
            </div>
          )}
        </div>
        {phase === 'run' && (
          <div className="ew-controls">
            <span className="ew-tip">{ex.tip}</span>
            <span className="grow" />
            <button onClick={() => setPaused((p) => !p)}>{paused ? 'Resume ▸' : 'Pause ⏸'}</button>
            <button onClick={() => (exIndex + 1 >= EXERCISES.length ? setPhase('done') : jumpTo(exIndex + 1))}>Skip ▸</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
