// Comfort & calibration engine — behavioral fatigue proxies and microbreak scheduling.
//
// Speed-reading is sustained, self-denying attention: RSVP removes the natural pauses
// (regressions, fixational rests) that self-paced reading gives you for free, so fatigue
// accrues faster and more silently. This module turns two cheap behavioral signals into a
// 0..1 fatigue estimate and schedules eye-rest microbreaks, so the speed gains elsewhere in
// the app don't quietly come at the cost of comfort or comprehension.
//
// Signals
//   - time-on-task: the vigilance decrement — sustained-attention performance declines roughly
//     monotonically with time on task (Mackworth, 1948). We ramp a component to ~1.0 over a
//     configurable horizon of *active* reading time.
//   - comprehension trend: a falling run of recent comprehension-check scores is a direct
//     readout of the reader slipping (fed from the adaptive probe when it is on).
// The two are combined with a noisy-OR so either alone can raise fatigue; together they compound.
//
// Microbreaks follow the widely-taught 20-20-20 eye-strain guideline (every ~20 min, look at
// something ~20 ft / 6 m away for ~20 s). That is a comfort heuristic, not medical advice.
//
// Pure: no React, no I/O, no clock. Callers pass elapsed milliseconds in.

export const DEFAULT_COMFORT = Object.freeze({
  enabled: true,
  breakIntervalMin: 20, // prompt an eye-rest microbreak every N minutes of *active* reading
  microbreakSec: 20,    // length of the eye-rest
  fatigueHorizonMin: 50, // active reading time at which the time-on-task component ≈ 1.0
  autoBackoff: true,     // ease the target WPM down when fatigue is high
  backoffPct: 0.15,      // strongest easing applied (at fatigue = 1.0), as a fraction of WPM
  fatigueThreshold: 0.5, // only ease once fatigue passes this
});

export function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function mean(a) {
  return a.length ? a.reduce((s, x) => s + (Number(x) || 0), 0) / a.length : 0;
}

// Decline in recent comprehension scores → 0..1. Compares the newer half of the window to the
// older half; only a *drop* counts (steady or improving comprehension yields 0). Needs ≥3 points.
export function comprehensionDrop(recentScores = []) {
  const s = (recentScores || []).map(clamp01);
  if (s.length < 3) return 0;
  const half = Math.floor(s.length / 2);
  const older = s.slice(0, s.length - half);
  const newer = s.slice(s.length - half);
  return clamp01(mean(older) - mean(newer));
}

// 0..1 fatigue estimate from active reading time + (optional) comprehension trend.
export function fatigueScore({ readingMs = 0, recentScores = [] } = {}, opts = {}) {
  const o = { ...DEFAULT_COMFORT, ...opts };
  const horizon = Math.max(1, o.fatigueHorizonMin * 60000);
  const timeComp = clamp01((Number(readingMs) || 0) / horizon);
  const perfComp = comprehensionDrop(recentScores);
  // noisy-OR: either signal alone can drive fatigue up; together they compound.
  return clamp01(1 - (1 - timeComp) * (1 - perfComp));
}

// Whether enough active reading has elapsed since the last break to prompt another.
export function shouldBreak(sinceBreakMs, opts = {}) {
  const o = { ...DEFAULT_COMFORT, ...opts };
  return (Number(sinceBreakMs) || 0) >= o.breakIntervalMin * 60000;
}

// Active reading time remaining until the next scheduled microbreak (never negative).
export function nextBreakInMs(sinceBreakMs, opts = {}) {
  const o = { ...DEFAULT_COMFORT, ...opts };
  return Math.max(0, o.breakIntervalMin * 60000 - (Number(sinceBreakMs) || 0));
}

// Eased target WPM for a given fatigue level. Returns the input (rounded) below the threshold;
// above it, scales the easing linearly from 0 at the threshold to backoffPct at fatigue = 1.0.
// Only ever lowers speed, never raises it.
export function backoffWpm(wpm, fatigue, opts = {}) {
  const o = { ...DEFAULT_COMFORT, ...opts };
  const cur = Math.max(1, Math.round(Number(wpm) || 1));
  const f = clamp01(fatigue);
  if (f < o.fatigueThreshold) return cur;
  const over = (f - o.fatigueThreshold) / Math.max(1e-6, 1 - o.fatigueThreshold);
  return Math.max(1, Math.round(cur * (1 - o.backoffPct * over)));
}
