// Font catalog + lazy loading. Every font offered here is legally free, from three sources:
//   • 'system'  — generic CSS stacks + web-safe families that need no download.
//   • 'bundled' — libre fonts shipped with the app (offline, private). See bundledFonts.js.
//   • 'local'   — fonts already installed on the user's device, enumerated via the Local Font
//                 Access API (Chromium only, behind a permission prompt). No download.
//   • 'google'  — the full Google Fonts library, loaded on demand from Google's CDN. OFF unless
//                 the user opts in (global.enableGoogleFonts), because it reveals their IP to Google.
import { BUNDLED } from './bundledFonts.js';
import { GOOGLE_FAMILIES } from './googleFonts.js';

// Generic fallbacks appended after the chosen family so text always renders something sensible.
export const FALLBACK = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Segoe UI", system-ui, Roboto, Arial, sans-serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
  a11y: '"Segoe UI", system-ui, Arial, sans-serif',
  display: 'system-ui, sans-serif',
  hand: 'cursive',
};

// Always-available stacks / web-safe families (no network, present on virtually every OS).
export const SYSTEM_FONTS = [
  { name: 'System UI (sans)', css: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial', cat: 'sans', source: 'system' },
  { name: 'System Serif', css: 'Cambria, Georgia, "Times New Roman"', cat: 'serif', source: 'system' },
  { name: 'System Mono', css: 'ui-monospace, Consolas, "Courier New"', cat: 'mono', source: 'system' },
  { name: 'Arial', css: 'Arial, Helvetica', cat: 'sans', source: 'system' },
  { name: 'Helvetica', css: 'Helvetica, Arial', cat: 'sans', source: 'system' },
  { name: 'Verdana', css: 'Verdana, Geneva', cat: 'sans', source: 'system' },
  { name: 'Tahoma', css: 'Tahoma, Geneva', cat: 'sans', source: 'system' },
  { name: 'Trebuchet MS', css: '"Trebuchet MS", Tahoma', cat: 'sans', source: 'system' },
  { name: 'Segoe UI', css: '"Segoe UI"', cat: 'sans', source: 'system' },
  { name: 'Calibri', css: 'Calibri, Candara', cat: 'sans', source: 'system' },
  { name: 'Georgia', css: 'Georgia', cat: 'serif', source: 'system' },
  { name: 'Times New Roman', css: '"Times New Roman", Times', cat: 'serif', source: 'system' },
  { name: 'Cambria', css: 'Cambria, Georgia', cat: 'serif', source: 'system' },
  { name: 'Palatino', css: '"Palatino Linotype", "Book Antiqua", Palatino', cat: 'serif', source: 'system' },
  { name: 'Garamond', css: 'Garamond, "EB Garamond"', cat: 'serif', source: 'system' },
  { name: 'Courier New', css: '"Courier New", Courier', cat: 'mono', source: 'system' },
  { name: 'Consolas', css: 'Consolas, "Courier New"', cat: 'mono', source: 'system' },
];

export { BUNDLED, GOOGLE_FAMILIES };

export const CATEGORY_LABELS = {
  serif: 'Serif', sans: 'Sans-serif', mono: 'Monospace',
  a11y: 'High-legibility', display: 'Display', hand: 'Handwriting',
};

// Build the full font-family CSS value (chosen family + a generic fallback) for an entry.
export function fontStack(entry) {
  if (!entry) return '';
  const fb = FALLBACK[entry.cat] || FALLBACK.sans;
  return `${entry.css}, ${fb}`;
}

// Pull the primary family name out of a CSS font-family stack (first token, unquoted).
export function primaryFamily(css) {
  if (!css) return '';
  const first = String(css).split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '');
}

const GOOGLE_BY_NAME = new Map(GOOGLE_FAMILIES.map((f) => [f.name.toLowerCase(), f]));
const BUNDLED_NAMES = new Set(BUNDLED.map((f) => f.name.toLowerCase()));
const SYSTEM_NAMES = new Set(SYSTEM_FONTS.flatMap((f) => [f.name.toLowerCase(), primaryFamily(f.css).toLowerCase()]));

// Inject a Google Fonts <link> for a family (deduped). Caller must have opted in. Loads a usable
// range of weights/italics so headings/bold render. Safe to call repeatedly.
const googleLoaded = new Set();
export function ensureGoogleFont(name) {
  if (typeof document === 'undefined') return;
  const fam = String(name || '').trim();
  if (!fam) return;
  const key = fam.toLowerCase();
  if (googleLoaded.has(key)) return;
  googleLoaded.add(key);
  const spec = encodeURIComponent(fam).replace(/%20/g, '+');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.googleFont = key;
  link.href = `https://fonts.googleapis.com/css2?family=${spec}:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap`;
  document.head.appendChild(link);
}

// Ensure whatever a configured CSS family value needs is actually loadable. Bundled families are
// already registered (their @font-face exists); system/local are installed; only Google families
// need a network <link>, and only when the user has opted in.
export function ensureFamilyLoaded(cssValue, googleEnabled) {
  const fam = primaryFamily(cssValue);
  if (!fam) return;
  const key = fam.toLowerCase();
  if (BUNDLED_NAMES.has(key) || SYSTEM_NAMES.has(key) || /\bvariable$/i.test(key)) return;
  if (!googleEnabled) return;
  // A known Google family, or any custom name the user typed — let the CDN resolve it.
  ensureGoogleFont(fam);
}

// Load the font behind a picker entry so previews/selection take effect immediately.
export function loadFontEntry(entry, googleEnabled) {
  if (!entry) return;
  if (entry.source === 'google') { if (googleEnabled) ensureGoogleFont(entry.name); return; }
  // bundled / system / local: nothing to fetch beyond the already-present @font-face / OS font.
}

// Enumerate the fonts installed on this device (Chromium's Local Font Access API). Returns null if
// unsupported or the permission was denied. Triggers a permission prompt, so call from a click.
export async function queryInstalledFonts() {
  if (typeof window === 'undefined' || !window.queryLocalFonts) return null;
  try {
    const fonts = await window.queryLocalFonts();
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    return families.map((fam) => ({
      name: fam,
      css: /[^a-zA-Z0-9 ]/.test(fam) || /\s/.test(fam) ? `'${fam.replace(/'/g, '')}'` : fam,
      cat: 'system',
      source: 'local',
    }));
  } catch {
    return null;
  }
}

export const LOCAL_FONTS_SUPPORTED = typeof window !== 'undefined' && !!window.queryLocalFonts;

// Look up a known catalog entry by family name (for resolving a stored CSS value back to an entry).
export function findEntryByFamily(name) {
  const key = String(name || '').toLowerCase();
  return (
    BUNDLED.find((f) => f.name.toLowerCase() === key || primaryFamily(f.css).toLowerCase() === key) ||
    SYSTEM_FONTS.find((f) => f.name.toLowerCase() === key || primaryFamily(f.css).toLowerCase() === key) ||
    GOOGLE_BY_NAME.get(key) ||
    null
  );
}
