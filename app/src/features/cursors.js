// Per-tab custom reading cursor — a different mouse pointer that shows ONLY over the reader panes
// (Lines / Fast Reader / Source), plus an optional fading trail. Both are per-tab so one book can
// read with a calm dot and another with a bright arrow.
//
// Cursors are either a native CSS keyword (default/pointer/…) or a tiny inline SVG rendered at a
// chosen colour and size, encoded as a data-URI `cursor: url(...) hx hy, auto`. Keeping them as SVG
// (not bitmaps) is what makes the "rich array of premades" cheap — every shape is a few lines of
// markup and recolours/resizes for free. Pure; see cursors.test.mjs.

// hotspot: [fx, fy] as fractions of the size — where the actual click point sits (0,0 = top-left).
// svg(color, size): the inner markup drawn in a size×size viewBox.
const S = (id, label, svg, hotspot = [0.5, 0.5]) => ({ id, label, svg, hotspot });

export const PREMADE_CURSORS = [
  // Native keywords — no image, just the OS pointer.
  { id: 'default', label: 'System default', native: 'default' },
  { id: 'pointerHand', label: 'Hand (link)', native: 'pointer' },
  { id: 'crosshairNative', label: 'Crosshair (system)', native: 'crosshair' },
  { id: 'text', label: 'Text I-beam', native: 'text' },
  { id: 'none', label: 'Hidden', native: 'none' },
  // SVG shapes — recolour + resize.
  S('dot', 'Dot', (c, s) => `<circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.22}" fill="${c}"/>`),
  S('ring', 'Ring', (c, s) => `<circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.34}" fill="none" stroke="${c}" stroke-width="${Math.max(1.5, s * 0.09)}"/>`),
  S('target', 'Target', (c, s) => `<circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.4}" fill="none" stroke="${c}" stroke-width="${s * 0.06}"/><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.09}" fill="${c}"/>`),
  S('plus', 'Fine crosshair', (c, s) => `<g stroke="${c}" stroke-width="${Math.max(1.2, s * 0.07)}" stroke-linecap="round"><line x1="${s / 2}" y1="${s * 0.12}" x2="${s / 2}" y2="${s * 0.88}"/><line x1="${s * 0.12}" y1="${s / 2}" x2="${s * 0.88}" y2="${s / 2}"/></g>`),
  S('arrow', 'Arrow', (c, s) => `<path d="M2 2 L2 ${s * 0.72} L${s * 0.28} ${s * 0.55} L${s * 0.44} ${s * 0.86} L${s * 0.56} ${s * 0.8} L${s * 0.4} ${s * 0.5} L${s * 0.72} ${s * 0.5} Z" fill="${c}" stroke="#0006" stroke-width="0.6"/>`, [0.06, 0.06]),
  S('pen', 'Pen', (c, s) => `<g stroke="${c}" stroke-width="${s * 0.09}" stroke-linecap="round" fill="none"><line x1="${s * 0.14}" y1="${s * 0.86}" x2="${s * 0.78}" y2="${s * 0.22}"/></g><path d="M${s * 0.72} ${s * 0.12} L${s * 0.88} ${s * 0.28} L${s * 0.8} ${s * 0.36} L${s * 0.64} ${s * 0.2} Z" fill="${c}"/><circle cx="${s * 0.15}" cy="${s * 0.85}" r="${s * 0.05}" fill="${c}"/>`, [0.12, 0.88]),
  S('caret', 'Caret bar', (c, s) => `<rect x="${s * 0.44}" y="${s * 0.1}" width="${Math.max(2, s * 0.12)}" height="${s * 0.8}" rx="${s * 0.05}" fill="${c}"/>`),
  S('underline', 'Reading underscore', (c, s) => `<rect x="${s * 0.1}" y="${s * 0.72}" width="${s * 0.8}" height="${Math.max(2, s * 0.12)}" rx="${s * 0.06}" fill="${c}"/>`, [0.5, 0.78]),
  S('star', 'Star', (c, s) => `<path d="${starPath(s)}" fill="${c}" stroke="#0006" stroke-width="0.5"/>`),
  S('heart', 'Heart', (c, s) => `<path d="M${s / 2} ${s * 0.82} C${s * 0.1} ${s * 0.52} ${s * 0.16} ${s * 0.16} ${s / 2} ${s * 0.36} C${s * 0.84} ${s * 0.16} ${s * 0.9} ${s * 0.52} ${s / 2} ${s * 0.82} Z" fill="${c}"/>`),
  S('diamond', 'Diamond', (c, s) => `<path d="M${s / 2} ${s * 0.12} L${s * 0.86} ${s / 2} L${s / 2} ${s * 0.88} L${s * 0.14} ${s / 2} Z" fill="${c}"/>`),
  S('triangle', 'Triangle', (c, s) => `<path d="M${s / 2} ${s * 0.14} L${s * 0.86} ${s * 0.82} L${s * 0.14} ${s * 0.82} Z" fill="${c}"/>`),
  S('sparkle', 'Sparkle', (c, s) => `<path d="M${s / 2} ${s * 0.1} L${s * 0.58} ${s * 0.42} L${s * 0.9} ${s / 2} L${s * 0.58} ${s * 0.58} L${s / 2} ${s * 0.9} L${s * 0.42} ${s * 0.58} L${s * 0.1} ${s / 2} L${s * 0.42} ${s * 0.42} Z" fill="${c}"/>`),
];

export const PREMADE_BY_ID = Object.fromEntries(PREMADE_CURSORS.map((c) => [c.id, c]));
export const SVG_CURSORS = PREMADE_CURSORS.filter((c) => c.svg);

function starPath(s) {
  const cx = s / 2, cy = s / 2, R = s * 0.42, r = s * 0.18;
  let d = '';
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r : R;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? 'L' : 'M'}${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)} `;
  }
  return `${d}Z`;
}

export const CURSOR_MIN_SIZE = 12;
export const CURSOR_MAX_SIZE = 48;
export const DEFAULT_CURSOR_COLOR = '#ff5c5c';
export const DEFAULT_CURSOR_SIZE = 24;

export function clampCursorSize(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_CURSOR_SIZE;
  return Math.max(CURSOR_MIN_SIZE, Math.min(CURSOR_MAX_SIZE, n));
}

// The CSS `cursor` value for a premade def at a colour/size. Native keywords pass straight through;
// SVG shapes become a data-URI with the click hotspot in pixels. `, auto` is the mandatory fallback.
export function cursorCss(def, { color = DEFAULT_CURSOR_COLOR, size = DEFAULT_CURSOR_SIZE } = {}) {
  if (!def) return 'auto';
  if (def.native) return def.native;
  const s = clampCursorSize(size);
  const inner = def.svg(color, s);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${inner}</svg>`;
  // Encode just the characters that break inside url("…"); keep it compact and valid.
  const enc = svg.replace(/"/g, "'").replace(/[<>#%{}|\\^~[\]`\s]/g, (ch) => encodeURIComponent(ch));
  const [fx, fy] = def.hotspot || [0.5, 0.5];
  const hx = Math.round(fx * s), hy = Math.round(fy * s);
  return `url("data:image/svg+xml,${enc}") ${hx} ${hy}, auto`;
}

// Resolve a stored cursor id — a premade id, or a saved custom cursor { id, base, color, size } —
// into a ready CSS value. `customs` is global.customCursors. Falls back to 'auto' (system) so a
// deleted custom or an unknown id never leaves the reader without a cursor.
export function resolveCursorCss(id, customs = []) {
  if (!id || id === 'default') return '';       // '' = don't override the system cursor
  const premade = PREMADE_BY_ID[id];
  if (premade) return cursorCss(premade, {});
  const custom = (customs || []).find((c) => c.id === id);
  if (custom) return cursorCss(PREMADE_BY_ID[custom.base] || PREMADE_BY_ID.dot, { color: custom.color, size: custom.size });
  return '';
}

// A stable id for a new custom cursor (no Date.now/Math.random dependency — derives from content,
// with a suffix if the base+colour+size collides).
export function customCursorId(base, color, size, existing = []) {
  const root = `${base}-${String(color).replace('#', '')}-${clampCursorSize(size)}`;
  let id = root, n = 2;
  const taken = new Set((existing || []).map((c) => c.id));
  while (taken.has(id)) id = `${root}-${n++}`;
  return id;
}
