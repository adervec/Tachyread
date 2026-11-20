// ponytail: guards the hex color mixer behind the derived themes. Run: node src/state/themes.test.mjs
import assert from 'node:assert';
import { mix, THEMES, THEME_CATEGORIES, THEME_NAMES, tabThemeName, BASE_THEME_NAMES, baseHouseTheme, paletteFromHouse, houseColorsFrom, houseThemeId, themeKey } from './themes.js';

assert.equal(mix('#000000', '#ffffff', 0.5), '#808080', 'midpoint of black/white is grey');
assert.equal(mix('#000', '#ffffff', 0), '#000000', 't=0 returns first colour (3-digit ok)');
assert.equal(mix('#112233', '#112233', 0.7), '#112233', 'same colour is unchanged');

// Every theme listed in a category must exist, and every theme must be categorised exactly once.
const inCats = THEME_CATEGORIES.flatMap((c) => c.themes);
for (const n of inCats) assert(THEMES[n] || BASE_THEME_NAMES.includes(n), `category theme "${n}" has a palette (base themes take theirs from font.js)`);
for (const n of THEME_NAMES) assert(inCats.includes(n), `theme "${n}" is in a category`);
assert.equal(inCats.length, new Set(inCats).size, 'no theme is categorised twice');
console.log('ok', THEME_NAMES.length, 'themes');

// default theme follows the device until the reader chooses
assert.equal(tabThemeName({}, true), 'Dark', 'nothing chosen + dark device → Dark');
assert.equal(tabThemeName({ darkMode: null }, false), 'Light', 'nothing chosen + light device → Light');
assert.equal(tabThemeName({ darkMode: false }, true), 'Light', 'a saved light choice wins over a dark device');
assert.equal(tabThemeName({ darkMode: true }, false), 'Dark', 'a saved dark choice wins over a light device');
assert.equal(tabThemeName({ themeName: 'Nord', darkMode: false }, true), 'Nord', 'a named theme always wins');
assert.equal(tabThemeName(undefined, false), 'Light');

// shared base themes (house standard 24): base names first, palette from the house colours
assert.deepEqual(THEME_CATEGORIES[0].themes, BASE_THEME_NAMES, 'the base list comes first');
for (const n of BASE_THEME_NAMES) assert.ok(THEME_NAMES.includes(n), `${n} is offered`);
assert.ok(!THEME_NAMES.includes('High Contrast') && themeKey('High Contrast') === 'High contrast', 'old High Contrast maps to the base theme');
assert.equal(tabThemeName({ themeName: 'High Contrast' }), 'High contrast');
const fakeHouse = [{ id: 'ocean', label: 'Ocean', dark: true, colors: { bg: '#071a24', surface: '#0c2431', surface2: '#12303f', line: '#1f4a5e', text: '#e2f1f7', dim: '#8fb3c2', accent: '#38bdf8', 'on-accent': '#04131b', good: '#5eead4', warn: '#fcd34d', bad: '#fca5a5' } }];
const oc = baseHouseTheme('Ocean', fakeHouse);
assert.equal(oc.id, 'ocean');
assert.equal(baseHouseTheme('Nord', fakeHouse), null, 'an extra is not a base theme');
const p = paletteFromHouse(oc);
assert.equal(p.windowBg, '#071a24'); assert.equal(p.toggleActiveBg, '#38bdf8'); assert.equal(p.isDark, true);
for (const [k, v] of Object.entries(p)) if (typeof v === 'string') assert.match(v, /^#[0-9a-f]{6}$/i, `${k} is hex`);
const back = houseColorsFrom(p);
assert.equal(back.bg, '#071a24'); assert.equal(Object.keys(back).length, 11, 'eleven colours for an extra');
assert.equal(houseThemeId(''), 'system');
assert.equal(houseThemeId('Rosé Pine'), 'rose-pine', 'extras get a font.js-safe id');
