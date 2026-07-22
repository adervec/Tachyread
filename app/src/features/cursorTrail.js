// Fading cursor trail for the reader area — the drawing math, kept pure so it's testable without a
// canvas. Two modes:
//   • 'fade'        — a wake behind the MOVING cursor: each mouse position is a point that fades out
//                     over trailMs, so quick moves leave a comet tail.
//   • 'seismograph' — the cursor holds still (or moves) while the TEXT scrolls under it; the trace is
//                     laid down as the content moves, so scrolling draws a wander line like a needle
//                     on a drum. We feed it the scroll delta each frame and it advances a horizontal
//                     pen, plotting the cursor's vertical offset — a readout of how the page moved
//                     beneath your pointer.
//
// The engine holds a ring of {x, y, t} points and exposes the still-visible ones for a renderer.
// createTrail().push(...) each frame; sample(now) returns points with an `alpha` 1→0. Pure logic;
// the canvas glue lives in the ReaderTrail component. See cursorTrail.test.mjs.

export const TRAIL_MODES = ['off', 'fade', 'seismograph'];
export const TRAIL_MIN_MS = 200;
export const TRAIL_MAX_MS = 4000;
export const DEFAULT_TRAIL_MS = 900;
export const SEISMO_SPEED = 40; // px/sec the seismograph pen advances horizontally

export function clampTrailMs(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_TRAIL_MS;
  return Math.max(TRAIL_MIN_MS, Math.min(TRAIL_MAX_MS, n));
}

export function createTrail({ mode = 'fade', trailMs = DEFAULT_TRAIL_MS, maxPoints = 240, seismoSpeed = SEISMO_SPEED } = {}) {
  const life = clampTrailMs(trailMs);
  let pts = [];
  let penX = null;      // seismograph horizontal pen position
  let baseY = null;     // seismograph vertical rest line (first cursor y seen)

  function drop(oldest) { while (pts.length && oldest - pts[0].t > life) pts.shift(); if (pts.length > maxPoints) pts.splice(0, pts.length - maxPoints); }

  return {
    // fade mode: record where the cursor is now.
    move(x, y, now) {
      if (mode !== 'fade') return;
      const last = pts[pts.length - 1];
      // Skip micro-jitter so a still cursor doesn't pile up hundreds of identical points.
      if (last && Math.hypot(x - last.x, y - last.y) < 1.5 && now - last.t < 40) return;
      pts.push({ x, y, t: now });
      drop(now);
    },
    // seismograph mode: the page scrolled by `scrollDelta` px since the last frame; the cursor sits
    // at (cursorX, cursorY). The pen advances horizontally with time and plots the cursor's vertical
    // deflection from its rest line, nudged by the scroll so a scroll-while-still still draws.
    scroll(cursorX, cursorY, scrollDelta, now, dtSec) {
      if (mode !== 'seismograph') return;
      if (baseY == null) { baseY = cursorY; penX = cursorX; }
      penX += (seismoSpeed * (dtSec || 0));
      // Deflection = how far the cursor is from its rest line, plus the accumulated scroll motion.
      const y = cursorY + (scrollDelta || 0) * 0.15;
      pts.push({ x: penX, y, t: now });
      drop(now);
    },
    // Points still alive, each with alpha 1 (newest) → 0 (about to expire).
    sample(now) {
      drop(now);
      return pts.map((p) => ({ x: p.x, y: p.y, alpha: Math.max(0, 1 - (now - p.t) / life) }));
    },
    reset() { pts = []; penX = null; baseY = null; },
    size: () => pts.length,
  };
}
