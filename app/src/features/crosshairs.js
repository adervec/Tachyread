// Reading crosshairs: richly customizable overlay markers for the Lines area. A design combines
// LAYERS (shapes, images, emoji) with per-layer colour/size/rotation/opacity, a whole-design
// transparency, and DISTORTION effects applied to the text behind it (backdrop blur/invert/
// grayscale/hue/contrast plus a turbulence WARP — Chromium renders backdrop-filter: url(#svg)).
//
// The STABLE (the saved collection of designs) is device-global data (global.crosshairStable,
// preserved on settings reset like custom cursors); WHICH designs are placed — and where — is a
// PER-TAB setting (settings.linesCrosshairs: [{ id, x, y, size }], fractional coords). Placed
// crosshairs are dragged directly on the pane. Pure helpers — see crosshairs.test.mjs.

export const XH_SHAPES = ['cross', 'x', 'circle', 'ring', 'dot', 'square', 'triangle', 'brackets', 'chevron', 'hline', 'vline'];

export const XH_DEFAULT_FX = { blur: 0, invert: 0, grayscale: 0, hueRotate: 0, contrast: 1, warp: 0 };

// Animations: the whole design breathes/pulses/spins/rocks, ornament dots orbit/scan/bounce, or
// trippy fractal layers nest counter-rotating shapes. The period is either fixed seconds or
// DYNAMIC — the time the current DISPLAY line (the visual wrapped line, not the file line) would
// take at the auto-mode pace, even when auto play is off.
export const XH_ANIMS = ['none', 'breathe', 'pulse', 'spin', 'rock', 'orbit', 'scan', 'bounce', 'fractal', 'kaleido'];
export const XH_ANIM_LABELS = {
  none: 'none',
  breathe: 'breathe (swell)',
  pulse: 'pulse (glow throb)',
  spin: 'spin (rotate)',
  rock: 'rock (sway)',
  orbit: 'cycling dots (orbit)',
  scan: 'scanning dot (left ↔ right)',
  bounce: 'oscillating dot (up ↕ down)',
  fractal: 'trippy fractal (nested spin)',
  kaleido: 'kaleidoscope (moiré spokes)',
};
export const XH_DEFAULT_ANIM = { style: 'none', periodMode: 'fixed', secs: 3 };

// The concrete animation period for a design: fixed seconds, or the measured display-line read
// time when the design asks for it (falls back to the fixed seconds while no line is measurable
// — empty pane, editor preview).
export function animPeriodSecs(anim, lineSecs = null) {
  const secs = clamp(Number(anim?.secs), 0.4, 30, 3);
  if (anim?.periodMode === 'line' && Number.isFinite(lineSecs) && lineSecs > 0) return clamp(lineSecs, 0.4, 120, secs);
  return secs;
}

let seq = 0;
export function newCrosshairId(now = 0) {
  seq += 1;
  return `xh-${now.toString(36)}-${seq}`;
}

export function newShapeLayer(shape = 'cross') {
  return { kind: 'shape', shape, color: '#ff5c5c', thickness: 3, scale: 1, rotate: 0, opacity: 1 };
}
export function newImageLayer(src = '') {
  return { kind: 'image', src, scale: 1, rotate: 0, opacity: 1 };
}
export function newEmojiLayer(char = '🎯') {
  return { kind: 'emoji', char, scale: 1, rotate: 0, opacity: 1 };
}

export function newCrosshair(name, now = 0) {
  return { id: newCrosshairId(now), name: name || 'Crosshair', layers: [newShapeLayer()], opacity: 0.9, fx: { ...XH_DEFAULT_FX } };
}

// Fill defaults into a (possibly hand-edited / older) stored design so render code never guards.
export function normalizeCrosshair(c) {
  const base = { id: '', name: 'Crosshair', layers: [], opacity: 0.9 };
  const out = { ...base, ...(c || {}) };
  out.opacity = clamp(Number(out.opacity), 0.05, 1, 0.9);
  out.anim = {
    style: XH_ANIMS.includes(c?.anim?.style) ? c.anim.style : 'none',
    periodMode: c?.anim?.periodMode === 'line' ? 'line' : 'fixed',
    secs: clamp(Number(c?.anim?.secs), 0.4, 30, 3),
  };
  out.fx = { ...XH_DEFAULT_FX, ...(c?.fx || {}) };
  out.fx.blur = clamp(Number(out.fx.blur), 0, 12, 0);
  out.fx.invert = clamp(Number(out.fx.invert), 0, 1, 0);
  out.fx.grayscale = clamp(Number(out.fx.grayscale), 0, 1, 0);
  out.fx.hueRotate = clamp(Number(out.fx.hueRotate), 0, 360, 0);
  out.fx.contrast = clamp(Number(out.fx.contrast), 0.4, 2.5, 1);
  out.fx.warp = clamp(Number(out.fx.warp), 0, 60, 0);
  out.layers = (Array.isArray(out.layers) ? out.layers : []).filter((l) => l && ['shape', 'image', 'emoji'].includes(l.kind)).map((l) => ({
    ...l,
    scale: clamp(Number(l.scale), 0.1, 1.6, 1),
    rotate: clamp(Number(l.rotate), -180, 180, 0),
    opacity: clamp(Number(l.opacity), 0.05, 1, 1),
    ...(l.kind === 'shape' ? { shape: XH_SHAPES.includes(l.shape) ? l.shape : 'cross', color: l.color || '#ff5c5c', thickness: clamp(Number(l.thickness), 1, 12, 3) } : {}),
  }));
  return out;
}

function clamp(v, lo, hi, dflt) {
  if (!Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, v));
}

// The CSS backdrop-filter string for a design's distortion of the text behind it. `warpFilterId`
// is the per-instance SVG turbulence filter (its displacement scale carries the warp strength);
// '' = no distortion at all (the fx disc isn't rendered).
export function backdropFilterOf(fx, warpFilterId = '') {
  const f = { ...XH_DEFAULT_FX, ...(fx || {}) };
  const parts = [];
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.invert > 0) parts.push(`invert(${f.invert})`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale})`);
  if (f.hueRotate > 0) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.warp > 0 && warpFilterId) parts.push(`url(#${warpFilterId})`);
  return parts.join(' ');
}

// Per-tab placement helpers. Placements: [{ id, x, y, size }] — x/y are fractions of the pane
// (0..1), size in px. A design can be placed several times.
export function placeCrosshair(placements, id) {
  const n = (placements || []).length;
  return [...(placements || []), { id, x: 0.5, y: Math.min(0.85, 0.3 + n * 0.12), size: 90 }];
}
export function moveCrosshair(placements, index, x, y) {
  return (placements || []).map((p, i) => (i === index ? { ...p, x: clamp(x, 0.02, 0.98, 0.5), y: clamp(y, 0.02, 0.98, 0.5) } : p));
}
export function resizeCrosshair(placements, index, size) {
  return (placements || []).map((p, i) => (i === index ? { ...p, size: clamp(size, 24, 400, 90) } : p));
}
export function removeCrosshair(placements, index) {
  return (placements || []).filter((_, i) => i !== index);
}

// Starter designs, offered when the stable is empty (never auto-injected).
export function starterStable(now = 0) {
  const mk = (name, layers, opacity, fx, anim) => ({
    id: newCrosshairId(now), name, layers, opacity, fx: { ...XH_DEFAULT_FX, ...fx },
    ...(anim ? { anim: { ...XH_DEFAULT_ANIM, ...anim } } : {}),
  });
  return [
    mk('Classic cross', [newShapeLayer('cross')], 0.85, {}),
    mk('Sniper', [
      { ...newShapeLayer('ring'), color: '#4fd8ff', thickness: 3 },
      { ...newShapeLayer('dot'), color: '#ff5c5c', scale: 0.16 },
      { ...newShapeLayer('cross'), color: '#4fd8ff', thickness: 2, scale: 0.7, opacity: 0.7 },
    ], 0.9, {}),
    mk('Focus lens', [{ ...newShapeLayer('ring'), color: '#ffd54f', thickness: 2 }], 0.75, { blur: 2.5 }),
    mk('Ghost X', [{ ...newShapeLayer('x'), color: '#b58cff', thickness: 4 }], 0.35, {}),
    mk('Heat haze', [{ ...newShapeLayer('circle'), color: '#ff7ab0', thickness: 1, opacity: 0.5 }], 0.8, { warp: 22 }),
    mk('Radar', [
      { ...newShapeLayer('ring'), color: '#7dffa1', thickness: 2 },
      { ...newShapeLayer('dot'), color: '#7dffa1', scale: 0.12 },
    ], 0.85, {}, { style: 'orbit', periodMode: 'fixed', secs: 2.5 }),
    mk('Line breather', [{ ...newShapeLayer('brackets'), color: '#ffd54f', thickness: 3 }], 0.8, {},
      { style: 'breathe', periodMode: 'line', secs: 3 }),
    mk('Trippy portal', [{ ...newShapeLayer('ring'), color: '#b58cff', thickness: 1, opacity: 0.6 }], 0.85,
      { hueRotate: 40 }, { style: 'fractal', periodMode: 'fixed', secs: 6 }),
  ];
}
