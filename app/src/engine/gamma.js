// 40 Hz auditory "focus primer" — configuration + hard safety clamps.
//
// AUDIO ONLY, by deliberate design. A *visual* flicker at ~40 Hz is a photosensitive-seizure hazard
// (see the app disclaimer); an amplitude-modulated tone delivers the same gamma-band rhythm through
// hearing, which is the far-lower-risk modality and the one most 40 Hz gamma studies actually use.
//
// Honest framing carried into the UI: single-session sensory 40 Hz entrains EEG but has NOT shown an
// acute cognitive or reading benefit. This ships as a clearly-labeled, opt-in experiment gated behind
// the disclaimer acknowledgement — not a feature we claim works.
//
// Pure: just defaults, limits, and a clamp. The Web-Audio graph lives in features/gammaPrimer.js.

export const DEFAULT_GAMMA = Object.freeze({
  modHz: 40, // amplitude-modulation rate (gamma band) — fixed intent, but clamped if overridden
  carrierHz: 220, // pleasant low carrier tone the modulation rides on
  volume: 0.15, // conservative default (master gain, 0..1)
  durationSec: 60, // short primer; auto-stops
});

// Hard limits — volume is capped well below 1.0 and the rate is held in the gamma band.
export const GAMMA_LIMITS = Object.freeze({
  modHz: [30, 50],
  carrierHz: [80, 900],
  volume: [0, 0.5],
  durationSec: [10, 300],
});

function clampNum(v, [lo, hi], fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function clampGammaConfig(cfg = {}) {
  const c = { ...DEFAULT_GAMMA, ...cfg };
  return {
    modHz: clampNum(c.modHz, GAMMA_LIMITS.modHz, DEFAULT_GAMMA.modHz),
    carrierHz: clampNum(c.carrierHz, GAMMA_LIMITS.carrierHz, DEFAULT_GAMMA.carrierHz),
    volume: clampNum(c.volume, GAMMA_LIMITS.volume, DEFAULT_GAMMA.volume),
    durationSec: Math.round(clampNum(c.durationSec, GAMMA_LIMITS.durationSec, DEFAULT_GAMMA.durationSec)),
  };
}
