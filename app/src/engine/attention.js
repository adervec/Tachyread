// Behavioral attention-state estimate — a 0..1 "focus" score (higher = more engaged) derived only
// from on-device signals the app already produces: NO webcam, NO external library.
//
// This is the deliberate, license-clean, privacy-preserving alternative to webcam gaze tracking:
// the evidence that single-session sensory/neurofeedback methods transfer to reading is weak, and a
// GPL webcam library doesn't fit an MIT app — so we infer attention from behavior instead. Three
// cheap proxies, each a penalty on focus:
//   • regression bursts  — a cluster of backward jumps in a short window (re-reading to stay afloat)
//   • comprehension miss  — recent adaptive-probe answers trending wrong
//   • pace instability    — high variation in word-dwell (attention wandering on and off)
//
// Pure: callers pass the already-counted signals in (windowing / timing lives in the component).

export const DEFAULT_ATTENTION = Object.freeze({
  regWindowMs: 20000, // window the component counts regressions over (used by the caller)
  regBurst: 5, // regressions-in-window that map to a full regression penalty
  cvFull: 1.0, // pace coefficient-of-variation that maps to a full instability penalty
  wReg: 0.4, // weight: regression burst
  wMiss: 0.35, // weight: comprehension miss-rate
  wVar: 0.25, // weight: pace instability
});

export function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function missRate(recentScores) {
  if (!recentScores || recentScores.length < 2) return 0;
  const mean = recentScores.reduce((a, b) => a + (Number(b) || 0), 0) / recentScores.length;
  return clamp01(1 - mean);
}

// Individual 0..1 penalties (1 = worst), for a UI breakdown.
export function attentionBreakdown({ recentRegressions = 0, recentScores = [], paceCv = 0 } = {}, opts = {}) {
  const o = { ...DEFAULT_ATTENTION, ...opts };
  return {
    regression: clamp01((Number(recentRegressions) || 0) / o.regBurst),
    comprehension: missRate(recentScores),
    pace: clamp01((Number(paceCv) || 0) / o.cvFull),
  };
}

// 0..1 focus score (1 = fully focused).
export function attentionScore(signals = {}, opts = {}) {
  const o = { ...DEFAULT_ATTENTION, ...opts };
  const b = attentionBreakdown(signals, o);
  const penalty = o.wReg * b.regression + o.wMiss * b.comprehension + o.wVar * b.pace;
  return clamp01(1 - penalty);
}

export function attentionLabel(score) {
  const s = clamp01(score);
  if (s >= 0.66) return 'Focused';
  if (s >= 0.33) return 'Wavering';
  return 'Distracted';
}

// Non-binding suggestion when focus is low. Does not auto-apply — the comprehension-gated adaptive
// pacer still owns WPM; this only advises a temporary slow-down / pause so the two never fight.
export function attentionAdvice(score, wpm, opts = {}) {
  const o = { ...DEFAULT_ATTENTION, ...opts };
  void o;
  const s = clamp01(score);
  const cur = Math.max(1, Math.round(Number(wpm) || 1));
  if (s >= 0.5) return { ease: false, slowTo: cur, message: '' };
  // scale the easing from 0 at score 0.5 down to -15% at score 0
  const factor = 0.85 + 0.15 * (s / 0.5);
  return {
    ease: true,
    slowTo: Math.max(1, Math.round(cur * factor)),
    message: 'Attention is dipping — ease off the pace or take a short break.',
  };
}
