// Display-only filter effects, shared by the camera self-view and the Source page view. A filter
// is a plain fx object (blur/brightness/contrast/saturate/hueRotate/sepia/invert/grayscale) turned
// into a CSS `filter` string — pure flavour, never fed back into detection or OCR (the camera
// pipeline analyses its own unfiltered element, and the source filter paints over the render).
// Pure — see displayFilters.test.mjs.

export const FILTER_DEFAULTS = { blur: 0, brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, sepia: 0, invert: 0, grayscale: 0 };

export const FILTER_PRESETS = [
  { id: 'none', label: 'None', fx: {} },
  { id: 'sepia', label: 'Old paper (sepia)', fx: { sepia: 0.85, contrast: 1.05, brightness: 1.03 } },
  { id: 'noir', label: 'Noir', fx: { grayscale: 1, contrast: 1.3, brightness: 1.05 } },
  { id: 'faded', label: 'Faded print', fx: { contrast: 0.85, brightness: 1.12, sepia: 0.25 } },
  { id: 'night', label: 'Night (inverted)', fx: { invert: 0.92, hueRotate: 180 } },
  { id: 'blueprint', label: 'Blueprint', fx: { grayscale: 1, sepia: 1, hueRotate: 180, saturate: 3, brightness: 0.9 } },
  { id: 'thermal', label: 'Thermal', fx: { invert: 1, hueRotate: 175, saturate: 1.8, contrast: 1.1 } },
  { id: 'neon', label: 'Neon', fx: { saturate: 2.3, contrast: 1.35, hueRotate: 20 } },
  { id: 'dream', label: 'Dreamy', fx: { blur: 1.1, brightness: 1.12, saturate: 1.35 } },
];
export const FILTER_PRESET_BY_ID = Object.fromEntries(FILTER_PRESETS.map((p) => [p.id, p]));

const CLAMPS = {
  blur: [0, 8], brightness: [0.4, 1.8], contrast: [0.4, 2.5], saturate: [0, 4],
  hueRotate: [0, 360], sepia: [0, 1], invert: [0, 1], grayscale: [0, 1],
};

export function normalizeFilter(fx) {
  const out = { ...FILTER_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(CLAMPS)) {
    const v = Number(fx?.[k]);
    out[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : FILTER_DEFAULTS[k];
  }
  return out;
}

// The CSS filter string; '' when everything is at its neutral value (render no filter at all).
export function filterCss(fx) {
  const f = normalizeFilter(fx);
  const parts = [];
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
  if (f.hueRotate > 0) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia})`);
  if (f.invert > 0) parts.push(`invert(${f.invert})`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale})`);
  return parts.join(' ');
}

// Which preset a stored fx matches ('custom' when none, 'none' for a neutral/empty filter).
export function matchPreset(fx) {
  const css = filterCss(fx || {});
  if (!css) return 'none';
  const hit = FILTER_PRESETS.find((p) => filterCss(p.fx) === css);
  return hit ? hit.id : 'custom';
}
