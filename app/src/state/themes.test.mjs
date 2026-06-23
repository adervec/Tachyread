// ponytail: guards the hex color mixer behind the derived themes. Run: node src/state/themes.test.mjs
import assert from 'node:assert';
import { mix, THEMES, THEME_CATEGORIES, THEME_NAMES } from './themes.js';

assert.equal(mix('#000000', '#ffffff', 0.5), '#808080', 'midpoint of black/white is grey');
assert.equal(mix('#000', '#ffffff', 0), '#000000', 't=0 returns first colour (3-digit ok)');
assert.equal(mix('#112233', '#112233', 0.7), '#112233', 'same colour is unchanged');

// Every theme listed in a category must exist, and every theme must be categorised exactly once.
const inCats = THEME_CATEGORIES.flatMap((c) => c.themes);
for (const n of inCats) assert(THEMES[n], `category theme "${n}" has a palette`);
for (const n of THEME_NAMES) assert(inCats.includes(n), `theme "${n}" is in a category`);
assert.equal(inCats.length, new Set(inCats).size, 'no theme is categorised twice');
console.log('ok', THEME_NAMES.length, 'themes');
