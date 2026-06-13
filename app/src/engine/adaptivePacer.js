// Comprehension-gated adaptive pacing — a double-staircase controller. The target reading speed rises
// only after the reader passes consecutive comprehension checks, and falls on a miss, so playback hovers
// at the edge of comprehension rather than at a guessed setpoint. Pure (no React / no I/O).

export const DEFAULT_PACER = Object.freeze({
  floor: 200,    // never auto-pace below this WPM
  ceil: 900,     // never auto-pace above this WPM
  upPct: 0.08,   // +8% per promotion
  downPct: 0.12, // -12% on a miss (asymmetric: back off faster than you climb)
  upAfter: 2,    // consecutive passes needed to step up
});

// Given the current target wpm, the latest probe result, and the running pass-streak, return the next
// target wpm, the new streak, and the delta applied.
export function adaptWpm(wpm, correct, streak = 0, opts = {}) {
  const o = { ...DEFAULT_PACER, ...opts };
  const cur = Math.max(1, Math.round(Number(wpm) || o.floor));
  let next = cur;
  let nextStreak;
  if (correct) {
    nextStreak = streak + 1;
    if (nextStreak >= o.upAfter) {
      next = Math.min(o.ceil, Math.round(cur * (1 + o.upPct)));
      nextStreak = 0;
    }
  } else {
    nextStreak = 0;
    next = Math.max(o.floor, Math.round(cur * (1 - o.downPct)));
  }
  return { wpm: next, streak: nextStreak, delta: next - cur };
}
