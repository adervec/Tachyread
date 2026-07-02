// Eye-warmup suite: pure position/timing samplers, one per exercise. Everything returns
// unit-space coordinates (x, y in [0,1]) or normalized scalars; the dialog maps to pixels
// and draws. Keeping the math pure makes each pattern testable without a canvas.

export const TAU = Math.PI * 2;

// Deterministic per-step pseudo-random (classic shader hash) so jump/flash sequences are a
// pure function of time — replayable, and no random state to manage in the render loop.
export function hash(i, salt = 0) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Smooth pursuit: horizontal sweeps that gently speed up over the exercise.
function sweep(t, u) {
  const phase = TAU * t * (0.3 + 0.15 * u);
  return { x: 0.5 + 0.46 * Math.sin(phase), y: 0.5 };
}

// Smooth pursuit: lying figure-eight (Lissajous 1:2).
function eight(t) {
  const p = TAU * 0.22 * t;
  return { x: 0.5 + 0.46 * Math.sin(p), y: 0.5 + 0.32 * Math.sin(2 * p) };
}

// Smooth pursuit: orbit clockwise for the first half, then reverse. θ retraces through the
// halfway angle so the direction flip is continuous (no teleport).
function orbit(t, u, dur) {
  const w = TAU * 0.28;
  const half = dur / 2;
  const theta = t < half ? w * t : w * (2 * half - t);
  return { x: 0.5 + 0.44 * Math.cos(theta), y: 0.5 + 0.4 * Math.sin(theta) };
}

// Saccades: the dot teleports between opposite quadrants (guaranteed long jumps) with
// hash jitter inside each quadrant. `age` = seconds since landing, for the landing ripple.
const JUMP_INTERVAL = 0.85;
const QUADS = [[0, 0], [1, 1], [1, 0], [0, 1]]; // TL, BR, TR, BL — diagonal every jump
function jumps(t) {
  const i = Math.floor(t / JUMP_INTERVAL);
  const [qx, qy] = QUADS[i % 4];
  return {
    x: 0.08 + qx * 0.5 + hash(i) * 0.34,
    y: 0.08 + qy * 0.5 + hash(i, 7) * 0.34,
    age: t - i * JUMP_INTERVAL,
  };
}

// Saccades: fixed corner tour — Z pattern, then X pattern.
const CORNER_INTERVAL = 0.8;
const CORNER_SEQ = [
  [0.07, 0.09], [0.93, 0.09], [0.07, 0.91], [0.93, 0.91], // Z
  [0.07, 0.09], [0.93, 0.91], [0.93, 0.09], [0.07, 0.91], // X
];
function corners(t) {
  const i = Math.floor(t / CORNER_INTERVAL);
  const [x, y] = CORNER_SEQ[i % CORNER_SEQ.length];
  return { x, y, age: t - i * CORNER_INTERVAL };
}

// Peripheral awareness: fixate the center cross; brief flashes appear at growing
// eccentricity. ecc is a fraction of the stage's max radius, angle in radians.
const FLASH_CYCLE = 1.6;
const FLASH_ON = 0.22;
function peripheral(t, u) {
  const i = Math.floor(t / FLASH_CYCLE);
  return {
    on: t - i * FLASH_CYCLE < FLASH_ON,
    angle: hash(i, 3) * TAU,
    ecc: 0.2 + 0.72 * u,
  };
}

// Accommodation: a reticle that swells and shrinks on a slow breath (5 s cycle).
function focus(t) {
  return { scale: 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(TAU * t / 5)) };
}

// Rest: palming/blink break — 8 s breath cycle (4 in, 4 out).
function rest(t) {
  return {
    breath: 0.5 - 0.5 * Math.cos(TAU * t / 8),
    inhale: Math.sin(TAU * t / 8) > 0,
  };
}

// fade = per-frame trail persistence (lower alpha ⇒ longer glow trail).
export const EXERCISES = [
  { id: 'sweeps', kind: 'dot', name: 'Sweeps', tip: 'Follow the dot with your eyes only — keep your head still.', dur: 25, fade: 0.2, color: '#4fd8ff', sample: sweep },
  { id: 'eight', kind: 'dot', name: 'Figure Eight', tip: 'Trace the infinity loop smoothly — no jumps, no shortcuts.', dur: 25, fade: 0.2, color: '#8f7bff', sample: eight },
  { id: 'orbits', kind: 'dot', name: 'Orbits', tip: 'Smooth circles — clockwise, then counter-clockwise.', dur: 25, fade: 0.2, color: '#4fffb0', sample: (t, u, dur) => orbit(t, u, dur) },
  { id: 'jumps', kind: 'jump', name: 'Saccades', tip: 'Snap your eyes to the dot the instant it lands.', dur: 25, fade: 0.3, color: '#ffb84f', sample: jumps },
  { id: 'corners', kind: 'jump', name: 'Corner Darts', tip: 'Dart corner to corner — a Z pattern, then an X.', dur: 20, fade: 0.3, color: '#ff7a5c', sample: corners },
  { id: 'peripheral', kind: 'flash', name: 'Peripheral', tip: 'Stare at the cross. Catch the flashes without looking at them.', dur: 30, fade: 0.4, color: '#7dff8a', sample: peripheral },
  { id: 'focus', kind: 'focus', name: 'Focus Pulse', tip: 'Ride the target as it swells and shrinks — breathe with it.', dur: 25, fade: 0.28, color: '#ffd24f', sample: focus },
  { id: 'rest', kind: 'rest', name: 'Rest', tip: 'Soften your gaze or close your eyes. Blink gently, breathe slow.', dur: 20, fade: 0.16, color: '#8fa0ff', sample: rest },
];

export const TOTAL_SECONDS = EXERCISES.reduce((s, e) => s + e.dur, 0);
