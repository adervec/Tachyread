// The camera "eye rotoscope": richly customizable eye graphics drawn over the reader's detected
// eyes on the self-view — glow orbs, rings, stars, hearts, laser bars or a custom emoji — with an
// optional glow that tracks the live reading WPM (the same idea as the reader faces' pace glow).
// Display-only: it paints over the video element; detection never sees it. Pure — see eyeFx.test.mjs.

export const EYE_FX_STYLES = [
  ['glow', '🔆 Glow orbs'],
  ['ring', '◯ Rings'],
  ['star', '✦ Stars'],
  ['heart', '♥ Hearts'],
  ['laser', '― Laser bars'],
  ['emoji', '😀 Custom emoji'],
];
export const EYE_FX_STYLE_IDS = EYE_FX_STYLES.map(([id]) => id);

export const DEFAULT_EYE_FX = { on: false, style: 'glow', emoji: '👁', color: '#4fd8ff', size: 1, opacity: 0.9, wpmGlow: true };

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);

export function normalizeEyeFx(v) {
  const out = { ...DEFAULT_EYE_FX, ...(v || {}) };
  out.on = !!out.on;
  out.style = EYE_FX_STYLE_IDS.includes(out.style) ? out.style : 'glow';
  out.emoji = String(out.emoji || '👁').slice(0, 4);
  out.color = typeof out.color === 'string' && out.color ? out.color : DEFAULT_EYE_FX.color;
  out.size = clamp(out.size, 0.3, 2.2, 1);
  out.opacity = clamp(out.opacity, 0.1, 1, 0.9);
  out.wpmGlow = !!out.wpmGlow;
  return out;
}

// Glow intensity from the live WPM, 0.15 (idle floor — the eyes never go fully dark) to 1 at a
// blazing pace. The band roughly spans "casual" to "very fast" reading.
export function wpmGlowIntensity(wpm, { lo = 100, hi = 600 } = {}) {
  const w = Number(wpm) || 0;
  return Math.max(0.15, Math.min(1, (w - lo) / Math.max(1, hi - lo) + 0.15));
}

// The layered glow shadow for an intensity (bigger + brighter as the pace climbs).
export function eyeShadow(color, intensity) {
  const i = Math.max(0, Math.min(1, intensity));
  return `0 0 ${Math.round(6 + 18 * i)}px ${color}, 0 0 ${Math.round(12 + 34 * i)}px ${color}`;
}

// Map a normalized video-space point (0..1) onto the DISPLAYED element under object-fit: cover
// (which scales to fill and crops the overflow) with an optional horizontal mirror (selfie view).
// Returns pixel coords within the element box. Pure — this is the rotoscope's aim.
export function mapEyePoint(p, { vw, vh, W, H, mirrored = true }) {
  if (!vw || !vh || !W || !H) return null;
  const scale = Math.max(W / vw, H / vh);
  const offX = (vw * scale - W) / 2;
  const offY = (vh * scale - H) / 2;
  let x = p.x * vw * scale - offX;
  const y = p.y * vh * scale - offY;
  if (mirrored) x = W - x;
  return { x, y };
}
