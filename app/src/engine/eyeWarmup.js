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

// Smooth pursuit: vertical sweeps (the vertical meridian, which horizontal sweeps miss).
function vsweep(t, u) {
  const phase = TAU * t * (0.3 + 0.15 * u);
  return { x: 0.5, y: 0.5 + 0.44 * Math.sin(phase) };
}

// Smooth pursuit: a spiral that winds inward for the first half, then back out. Radius eases with a
// cosine so the direction reversal at the centre is smooth.
function spiral(t, u, dur) {
  const half = dur / 2;
  const wind = t < half ? t / half : (dur - t) / half; // 0→1→0
  const r = 0.06 + 0.4 * wind;
  const theta = TAU * 0.5 * t;
  return { x: 0.5 + r * Math.cos(theta) * 0.92, y: 0.5 + r * Math.sin(theta) };
}

// Smooth pursuit: a free bounce (DVD-logo style) — unpredictable pursuit that keeps attention. Pure:
// position is the reflected path of a constant-velocity point, folded back into [margin, 1-margin].
function bounce(t) {
  const m = 0.08, span = 1 - 2 * m;
  const fold = (p) => { const q = ((p % (2 * span)) + 2 * span) % (2 * span); return m + (q <= span ? q : 2 * span - q); };
  return { x: fold(0.33 * t), y: fold(0.223 * t + 0.4) };
}

// Saccades that mimic READING: the eye jumps left→right in small hops along a line, flicks back to
// the next line down, and repeats — the exact pattern reading drills. `age` for the landing ripple.
const READ_HOP = 0.32;   // seconds per within-line hop
const READ_COLS = 5;     // fixations per line
const READ_ROWS = 4;     // lines before wrapping back to the top
function readingRows(t) {
  const i = Math.floor(t / READ_HOP);
  const col = i % READ_COLS;
  const row = Math.floor(i / READ_COLS) % READ_ROWS;
  const x = 0.1 + (col / (READ_COLS - 1)) * 0.8;
  const y = 0.16 + (row / (READ_ROWS - 1)) * 0.68;
  return { x, y, age: t - i * READ_HOP };
}

// Accommodation: a reticle that swells and shrinks on a slow breath (5 s cycle).
function focus(t) {
  return { scale: 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(TAU * t / 5)) };
}

// Vergence: two dots that converge to the centre (eyes cross, "near") then diverge to the edges
// ("far") on a slow cycle. offset is half the gap, 0 at the near point. blend eases the motion.
function converge(t) {
  const s = 0.5 - 0.5 * Math.cos(TAU * t / 6); // 0 (near) .. 1 (far)
  return { offset: 0.04 + 0.42 * s, near: s < 0.5 };
}

// Blink break: a slow pulse cueing a full, deliberate blink every ~4 s — resets the tear film after
// screen staring. `close` peaks at the blink instant.
function blink(t) {
  const period = 4;
  const p = (t % period) / period;
  return { close: Math.max(0, 1 - Math.abs(p - 0.5) * 8), idx: Math.floor(t / period) };
}

// Rest: palming/blink break — 8 s breath cycle (4 in, 4 out).
function rest(t) {
  return {
    breath: 0.5 - 0.5 * Math.cos(TAU * t / 8),
    inhale: Math.sin(TAU * t / 8) > 0,
  };
}

// fade = per-frame trail persistence (lower alpha ⇒ longer glow trail). `dur` doubles as the drill's
// default WEIGHT when the routine is scaled to a target total (see buildPlan). `group` buckets drills
// in the picker. `default: false` drills are available but off unless the user opts in.
export const EXERCISES = [
  { id: 'sweeps', kind: 'dot', group: 'Pursuit', name: 'Sweeps', tip: 'Follow the dot with your eyes only — keep your head still.', dur: 25, fade: 0.2, color: '#4fd8ff', sample: sweep, default: true },
  { id: 'vsweeps', kind: 'dot', group: 'Pursuit', name: 'Vertical Sweeps', tip: 'Up and down — track the dot along the vertical, head still.', dur: 20, fade: 0.2, color: '#59c2ff', sample: (t, u) => vsweep(t, u), default: false },
  { id: 'eight', kind: 'dot', group: 'Pursuit', name: 'Figure Eight', tip: 'Trace the infinity loop smoothly — no jumps, no shortcuts.', dur: 25, fade: 0.2, color: '#8f7bff', sample: eight, default: true },
  { id: 'orbits', kind: 'dot', group: 'Pursuit', name: 'Orbits', tip: 'Smooth circles — clockwise, then counter-clockwise.', dur: 25, fade: 0.2, color: '#4fffb0', sample: (t, u, dur) => orbit(t, u, dur), default: true },
  { id: 'spiral', kind: 'dot', group: 'Pursuit', name: 'Spiral', tip: 'Wind inward to the centre, then unwind back out — stay smooth.', dur: 25, fade: 0.2, color: '#4fe0d8', sample: (t, u, dur) => spiral(t, u, dur), default: false },
  { id: 'bounce', kind: 'dot', group: 'Pursuit', name: 'Free Bounce', tip: 'Chase the wandering dot — don’t predict, just follow.', dur: 22, fade: 0.24, color: '#a0d8ff', sample: bounce, default: false },
  { id: 'jumps', kind: 'jump', group: 'Saccades', name: 'Saccades', tip: 'Snap your eyes to the dot the instant it lands.', dur: 25, fade: 0.3, color: '#ffb84f', sample: jumps, default: true },
  { id: 'corners', kind: 'jump', group: 'Saccades', name: 'Corner Darts', tip: 'Dart corner to corner — a Z pattern, then an X.', dur: 20, fade: 0.3, color: '#ff7a5c', sample: corners, default: true },
  { id: 'reading', kind: 'jump', group: 'Saccades', name: 'Reading Rows', tip: 'Hop along each line and flick back — the reading pattern itself.', dur: 24, fade: 0.32, color: '#ff9f4f', sample: readingRows, default: false },
  { id: 'peripheral', kind: 'flash', group: 'Vision', name: 'Peripheral', tip: 'Stare at the cross. Catch the flashes without looking at them.', dur: 30, fade: 0.4, color: '#7dff8a', sample: peripheral, default: true },
  { id: 'focus', kind: 'focus', group: 'Focus', name: 'Focus Pulse', tip: 'Ride the target as it swells and shrinks — breathe with it.', dur: 25, fade: 0.28, color: '#ffd24f', sample: focus, default: true },
  { id: 'converge', kind: 'converge', group: 'Focus', name: 'Near / Far', tip: 'Let the two dots meet in the middle, then drift apart — relax between.', dur: 24, fade: 0.3, color: '#ffd98f', sample: converge, default: false },
  { id: 'blink', kind: 'blink', group: 'Rest', name: 'Blink Break', tip: 'Blink fully each time it pulses — wet, restful, complete blinks.', dur: 15, fade: 1, color: '#9fd0ff', sample: blink, default: false },
  { id: 'rest', kind: 'rest', group: 'Rest', name: 'Rest', tip: 'Soften your gaze or close your eyes. Blink gently, breathe slow.', dur: 20, fade: 0.16, color: '#8fa0ff', sample: rest, default: true },
];

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));
export const DEFAULT_IDS = EXERCISES.filter((e) => e.default).map((e) => e.id);
export const TOTAL_SECONDS = EXERCISES.filter((e) => e.default).reduce((s, e) => s + e.dur, 0);
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 8;

// Build a runnable routine: take the selected drills (in canonical EXERCISES order) and scale each
// one's base `dur` (its weight) so the durations sum to `totalSeconds`, with a sane per-drill floor.
// Pure — the dialog rebuilds this whenever the slider or the picker changes. Returns [] if nothing
// is selected. ponytail: proportional split + 6 s floor; exact total drifts a second or two, fine.
export function buildPlan(selectedIds, totalSeconds) {
  const chosen = EXERCISES.filter((e) => selectedIds.includes(e.id));
  if (!chosen.length) return [];
  const weight = chosen.reduce((s, e) => s + e.dur, 0);
  return chosen.map((e) => ({ ...e, dur: Math.max(6, Math.round((e.dur / weight) * totalSeconds)) }));
}

export function planSeconds(plan) {
  return plan.reduce((s, e) => s + e.dur, 0);
}
