// Self-check: display-only filter engine (camera feed + source page looks).
// Run: node src/features/displayFilters.test.mjs
import assert from 'node:assert/strict';
import { FILTER_PRESETS, FILTER_DEFAULTS, normalizeFilter, filterCss, matchPreset } from './displayFilters.js';

// Neutral fx → empty string (no filter rendered at all).
assert.equal(filterCss({}), '');
assert.equal(filterCss(null), '');
assert.equal(filterCss(FILTER_DEFAULTS), '');

// Values render, neutral entries skipped.
assert.equal(filterCss({ blur: 2 }), 'blur(2px)');
assert.equal(filterCss({ sepia: 0.85, contrast: 1.05, brightness: 1.03 }), 'brightness(1.03) contrast(1.05) sepia(0.85)');
assert.equal(filterCss({ hueRotate: 180, invert: 0.9 }), 'hue-rotate(180deg) invert(0.9)');

// Clamps: garbage falls back to neutral, extremes clip.
const n = normalizeFilter({ blur: 999, brightness: 0, contrast: 'x', saturate: -5, hueRotate: 720, invert: 3 });
assert.equal(n.blur, 8);
assert.equal(n.brightness, 0.4);
assert.equal(n.contrast, 1, 'garbage → neutral');
assert.equal(n.saturate, 0);
assert.equal(n.hueRotate, 360);
assert.equal(n.invert, 1);

// Presets: unique ids, 'none' is neutral, every other preset actually does something.
assert.equal(new Set(FILTER_PRESETS.map((p) => p.id)).size, FILTER_PRESETS.length);
assert.equal(filterCss(FILTER_PRESET_BY('none').fx), '');
for (const p of FILTER_PRESETS) if (p.id !== 'none') assert.ok(filterCss(p.fx) !== '', `${p.id} has an effect`);
function FILTER_PRESET_BY(id) { return FILTER_PRESETS.find((p) => p.id === id); }

// Preset matching drives the UI select.
assert.equal(matchPreset(null), 'none');
assert.equal(matchPreset({}), 'none');
assert.equal(matchPreset(FILTER_PRESET_BY('noir').fx), 'noir');
assert.equal(matchPreset({ blur: 3.3 }), 'custom');

console.log('displayFilters: all checks passed');
