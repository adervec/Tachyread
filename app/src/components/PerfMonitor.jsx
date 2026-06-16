import { useEffect, useRef, useState } from 'react';

// Lightweight "is the app struggling?" readout. A single requestAnimationFrame loop times each
// frame; we report a smoothed FPS and the share of recent frames that ran long (jank). The cost
// is one timestamp per frame — negligible — and it surfaces the thing that actually hurts on a
// phone: dropped frames during scrolling / fast playback / face animation.
//
// Levels: ok (smooth) · warn (some dropped frames) · bad (sustained jank). Shown compactly in the
// status bar; tap/hover for the numbers. Hidden via the showPerfMeter setting.
const SAMPLE = 60;          // frames per rollup
const LONG_FRAME_MS = 1000 / 50; // > ~20ms (under 50fps) counts as a long frame

export default function PerfMonitor() {
  const [stat, setStat] = useState({ fps: 60, jank: 0, level: 'ok' });
  const ref = useRef({ last: 0, frames: 0, long: 0, acc: 0 });

  useEffect(() => {
    let raf = 0;
    let alive = true;
    function tick(t) {
      if (!alive) return;
      const s = ref.current;
      if (s.last) {
        const dt = t - s.last;
        s.acc += dt;
        s.frames += 1;
        if (dt > LONG_FRAME_MS) s.long += 1;
        if (s.frames >= SAMPLE) {
          const fps = Math.round(1000 / (s.acc / s.frames));
          const jank = s.long / s.frames;
          // Classify by the dropped-frame share, with FPS as a floor guard.
          let level = 'ok';
          if (jank > 0.5 || fps < 32) level = 'bad';
          else if (jank > 0.18 || fps < 50) level = 'warn';
          setStat({ fps: Math.min(fps, 120), jank, level });
          s.frames = 0; s.long = 0; s.acc = 0;
        }
      }
      s.last = t;
      raf = requestAnimationFrame(tick);
    }
    // Pause measuring while the tab is hidden (rAF already throttles, but reset so we don't log a
    // giant gap as jank on resume).
    function onVis() {
      if (document.visibilityState === 'hidden') ref.current.last = 0;
    }
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const pct = Math.round(stat.jank * 100);
  const title =
    stat.level === 'ok'
      ? `Running smoothly — ~${stat.fps} fps`
      : `Working hard — ~${stat.fps} fps, ${pct}% of recent frames dropped`;
  return (
    <span className={`perf-meter perf-${stat.level}`} title={title} aria-label={title}>
      <span className="perf-dot" />
      <span className="perf-fps">{stat.fps}<span className="perf-unit">fps</span></span>
      {stat.level !== 'ok' && <span className="perf-load">· {pct}% jank</span>}
    </span>
  );
}
