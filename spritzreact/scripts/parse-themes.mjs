// One-shot generator: parse the WPF Themes.cs ThemePalette definitions into a
// React theme module (src/state/themes.js). Run with: node scripts/parse-themes.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2] ||
  'C:/Users/Adam Erik Eryavec/Documents/GitHub/default/SPRITZApp/SPRITZApp/Themes.cs';
const OUT = new URL('../src/state/themes.js', import.meta.url);

const text = readFileSync(SRC, 'utf8');

// Map ThemePalette C# field -> theme object key (camelCase).
const FIELDS = [
  'IsDark', 'WindowBg', 'PanelBg', 'PanelBorder', 'MenuBg', 'MenuFg', 'MenuHover',
  'MenuHoverFg', 'TextViewBg', 'LeftPaneBg', 'LineNumberFg', 'LineUnreadFg', 'LineReadFg',
  'SessionReadFg', 'NavSessionReadFg', 'CurrentLineBg', 'CurrentLineFg', 'CurrentParaBg',
  'StatsFg', 'EmptyFg', 'MetaFg', 'WpmFg', 'StatusBarBg', 'StatusBarBorder', 'StatusBarFg',
  'ButtonBg', 'ButtonFg', 'ButtonBorder', 'ButtonHoverBg', 'ButtonPressedBg', 'ToggleActiveBg',
  'ToggleActiveFg', 'InputBg', 'InputFg', 'InputBorder', 'TrackBg', 'ThumbBg', 'GridSplitterBg',
  'FontOverride', 'DefaultSerifFont', 'DefaultSansFont',
];
const camel = (s) => s[0].toLowerCase() + s.slice(1);

const NAMED_COLORS = {
  White: '#ffffff', Black: '#000000', Transparent: 'transparent',
  Red: '#ff0000', Gray: '#808080', DarkGray: '#a9a9a9', LightGray: '#d3d3d3',
};

function colorVal(raw) {
  raw = raw.trim();
  if (raw === 'null') return null;
  let m = raw.match(/^C\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m) {
    const [, r, g, b] = m;
    return '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  }
  m = raw.match(/^Colors\.(\w+)$/);
  if (m && NAMED_COLORS[m[1]] !== undefined) return NAMED_COLORS[m[1]];
  // string literal (font names)
  m = raw.match(/^"(.*)"$/);
  if (m) return m[1];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw; // leave as-is; we'll flag unknowns
}

// Find each: public static readonly ThemePalette NAME = new() { ... };
const blockRe = /public static readonly ThemePalette (\w+)\s*=\s*new\(\)\s*\{([\s\S]*?)\};/g;
const palettes = {};
let bm;
while ((bm = blockRe.exec(text)) !== null) {
  const name = bm[1];
  const body = bm[2];
  const obj = {};
  for (const field of FIELDS) {
    // Value is one of: C(r,g,b) | Colors.X | "string" | null | true | false
    const re = new RegExp(
      '\\b' + field + '\\s*=\\s*(C\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*\\)|Colors\\.\\w+|"[^"]*"|null|true|false)'
    );
    const fm = body.match(re);
    if (!fm) continue;
    obj[camel(field)] = colorVal(fm[1].trim());
  }
  palettes[name] = obj;
}

// Pull AllNames (display names, in order) and the name->palette switch mapping.
const allNamesBlock = text.match(/AllNames\s*=\s*\[([\s\S]*?)\];/);
const allNames = [...allNamesBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const switchBlock = text.match(/GetPalette\(string\? name\) => name switch\s*\{([\s\S]*?)\};/);
const nameToVar = {};
for (const m of switchBlock[1].matchAll(/"([^"]+)"\s*=>\s*(\w+)/g)) nameToVar[m[1]] = m[2];

// Build display-name -> palette object map (Light is the default fallback).
const byDisplay = {};
for (const dn of allNames) {
  const varName = nameToVar[dn] || 'Light';
  byDisplay[dn] = palettes[varName] || palettes.Light;
}

const header = `// AUTO-GENERATED from SPRITZApp/Themes.cs by scripts/parse-themes.mjs — do not edit by hand.
// ThemePalette colors mapped to CSS custom properties (see applyTheme in this file).
/* eslint-disable */
`;

const body = `
export const THEME_NAMES = ${JSON.stringify(allNames)};

export const THEMES = ${JSON.stringify(byDisplay, null, 2)};

// Map each palette key -> the CSS custom property name(s) consumed by App.css / index.css.
const VAR_MAP = {
  windowBg: ['--pane-bg'],
  panelBg: ['--controls-bg'],
  panelBorder: ['--divider'],
  menuBg: ['--menu-bg'],
  menuFg: ['--menu-fg'],
  menuHover: ['--menu-highlight'],
  menuHoverFg: ['--menu-hover-fg'],
  textViewBg: ['--textview-bg'],
  leftPaneBg: ['--spritz-bg'],
  lineNumberFg: ['--line-number-fg'],
  lineUnreadFg: ['--line-unread-fg', '--spritz-fg'],
  lineReadFg: ['--line-read-fg'],
  sessionReadFg: ['--session-read-fg'],
  navSessionReadFg: ['--nav-session-read-fg'],
  currentLineBg: ['--current-line-bg'],
  currentLineFg: ['--current-line-fg'],
  currentParaBg: ['--current-para-bg'],
  statsFg: ['--stats-fg'],
  emptyFg: ['--empty-fg'],
  metaFg: ['--meta-fg'],
  wpmFg: ['--wpm-fg'],
  statusBarBg: ['--status-bg'],
  statusBarBorder: ['--statusbar-border'],
  statusBarFg: ['--status-fg'],
  buttonBg: ['--btn-bg'],
  buttonFg: ['--btn-fg'],
  buttonBorder: ['--btn-border'],
  buttonHoverBg: ['--btn-hover'],
  buttonPressedBg: ['--btn-pressed'],
  toggleActiveBg: ['--toggle-active-bg'],
  toggleActiveFg: ['--toggle-active-fg'],
  inputBg: ['--input-bg'],
  inputFg: ['--input-fg'],
  inputBorder: ['--input-border'],
  trackBg: ['--track-bg'],
  thumbBg: ['--thumb-bg'],
  gridSplitterBg: ['--splitter-bg'],
};

export function getPalette(name) {
  return THEMES[name] || THEMES['Light'];
}

// Apply a theme by writing CSS custom properties onto the given element (default :root).
export function applyTheme(name, serifFamily, sansFamily, el) {
  const p = getPalette(name);
  const root = el || document.documentElement;
  for (const [key, cssVars] of Object.entries(VAR_MAP)) {
    const v = p[key];
    if (v == null) continue;
    for (const cssVar of cssVars) root.style.setProperty(cssVar, v);
  }
  const serif = p.defaultSerifFont || serifFamily || 'Cambria, Georgia, "Times New Roman", serif';
  const sans = p.defaultSansFont || sansFamily || 'Segoe UI, Arial, sans-serif';
  root.style.setProperty('--serif-family', serif);
  root.style.setProperty('--sans-family', sans);
  root.classList.toggle('theme-dark', !!p.isDark);
  root.classList.toggle('theme-light', !p.isDark);
  return p;
}
`;

writeFileSync(OUT, header + body, 'utf8');
console.log('Wrote', OUT.pathname, '—', allNames.length, 'themes:', allNames.join(', '));
