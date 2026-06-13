// Rhythmic pacing — timing math for an auditory cadence cue locked to reading speed.
//
// The "pacer" is one of the oldest speed-reading techniques: a moving guide or a steady beat that
// the reader keeps up with. An external rhythm gives sustained attention something to lock onto and
// reduces dwell-time variance, which can make a target pace feel easier to hold (rhythmic auditory
// cueing is well established for pacing movement; here it is a gentle reading-cadence aid, not a
// clinical claim). We keep it as a *cue at the current WPM* — the comprehension-gated adaptive pacer
// still owns the actual speed — so the beat and the words stay in sync and nothing fights for control.
//
// Pure timing only; the Web-Audio scheduler lives in features/metronome.js.

export const DEFAULT_METRONOME = Object.freeze({
  enabled: false,
  volume: 0.25, // 0..1
  subdivision: 1, // ticks per word-interval (1 = one beat per word, 2 = eighth-notes, ...)
  accentEvery: 0, // accent every N main beats (0 = no accent)
});

// Milliseconds between main beats for a reading speed (one main beat per word).
export function beatIntervalMs(wpm) {
  const w = Math.max(1, Number(wpm) || 1);
  return 60000 / w;
}

// Milliseconds between scheduled ticks, including subdivision.
export function tickIntervalMs(wpm, subdivision = 1) {
  const s = Math.max(1, Math.round(Number(subdivision) || 1));
  return beatIntervalMs(wpm) / s;
}

// Is tick index i a main beat (vs. an in-between subdivision tick)?
export function isMainBeat(i, subdivision = 1) {
  const s = Math.max(1, Math.round(Number(subdivision) || 1));
  return (Number(i) || 0) % s === 0;
}

// Is tick index i an accented main beat (every accentEvery-th main beat)?
export function isAccent(i, subdivision = 1, accentEvery = 0) {
  const s = Math.max(1, Math.round(Number(subdivision) || 1));
  const a = Math.max(0, Math.round(Number(accentEvery) || 0));
  const idx = Number(i) || 0;
  if (a === 0 || idx % s !== 0) return false;
  return (idx / s) % a === 0;
}
