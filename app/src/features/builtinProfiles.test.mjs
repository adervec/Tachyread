// Self-check: built-in profiles. Device presets on every settings page, plus ambient-light variants
// where light actually changes the answer. The assertions below pin the RESEARCH the numbers came
// from — if someone retunes them by taste, this is what should stop them.
// Run: node src/features/builtinProfiles.test.mjs
import assert from 'node:assert/strict';
import { builtinProfiles, appliesCleanly, BUILTIN_DEVICES, BUILTIN_LIGHT } from './builtinProfiles.js';
import { THEMES } from '../state/themes.js';

const DEVICE_ONLY = ['bio', 'audio', 'comfort', 'typing'];
const LIGHT_KINDS = ['tab', 'app'];

// Shape: device-only kinds ship 3 presets; light-aware kinds ship device × light.
for (const kind of DEVICE_ONLY) {
  const list = builtinProfiles(kind);
  assert.equal(list.length, 3, `${kind} has desktop/phone/tablet presets`);
  assert.deepEqual(list.map((p) => p.device), BUILTIN_DEVICES.map(([id]) => id));
}
for (const kind of LIGHT_KINDS) {
  const list = builtinProfiles(kind);
  assert.equal(list.length, BUILTIN_DEVICES.length * BUILTIN_LIGHT.length, `${kind} has a variant per device × light`);
  for (const [dev] of BUILTIN_DEVICES) {
    for (const [light] of BUILTIN_LIGHT) {
      assert.ok(list.some((p) => p.device === dev && p.light === light), `${kind}: ${dev}/${light} missing`);
    }
  }
}
for (const kind of [...DEVICE_ONLY, ...LIGHT_KINDS]) {
  for (const p of builtinProfiles(kind)) {
    assert.ok(p.builtin, 'flagged builtin');
    assert.ok(p.name.includes('built-in'), 'name marks it built-in');
    assert.ok(p.data && typeof p.data === 'object' && Object.keys(p.data).length > 0, `${kind}/${p.name} has data`);
  }
}
assert.equal(new Set(builtinProfiles('tab').map((p) => p.name)).size, 9, 'names are unique');
assert.deepEqual(builtinProfiles('nope'), [], 'unknown kind → empty');

const tabBy = (dev, light) => builtinProfiles('tab').find((p) => p.device === dev && p.light === light).data;

// ── typography follows viewing distance, not taste ──
// Angular size: the further the screen, the smaller the glyph can be for the same comfort.
const [desk, tab_, phone] = [tabBy('desktop', 'normal'), tabBy('tablet', 'normal'), tabBy('phone', 'normal')];
assert.ok(phone.rightPaneFontSize > tab_.rightPaneFontSize, 'phone type > tablet type (held closer)');
assert.ok(tab_.rightPaneFontSize > desk.rightPaneFontSize, 'tablet type > desktop type');

// Characters per line: 45–75 is the typographic optimum; a phone can't hold it at a readable size.
assert.equal(desk.autoFontCpl, 66, "Bringhurst's single-column ideal");
assert.ok(tab_.autoFontCpl >= 45 && tab_.autoFontCpl <= 75, 'tablet inside the 45–75 optimum');
assert.ok(phone.autoFontCpl < 45, 'phone deliberately below the optimum — it cannot hold it legibly');
assert.ok(phone.autoFontCpl >= 35, 'but not so short that return sweeps dominate');
assert.ok(desk.autoFontCpl > tab_.autoFontCpl && tab_.autoFontCpl > phone.autoFontCpl, 'CPL tracks screen width');

// WCAG 1.4.12 requires text to survive 1.5× line height — that is the floor on every device.
for (const [dev] of BUILTIN_DEVICES) {
  for (const [light] of BUILTIN_LIGHT) {
    const d = tabBy(dev, light);
    assert.ok(d.lineSpacing >= 1.5, `${dev}/${light} line spacing must clear the WCAG 1.5 floor`);
  }
}
assert.ok(phone.lineSpacing > desk.lineSpacing, 'a short measure needs more leading to guide sweeps');

// The Fast Reader pane is cramped beside Lines on a phone.
assert.equal(phone.hideRsvpPane, true);
assert.equal(desk.hideRsvpPane, false);

// ── contrast polarity follows the room ──
// Every themeName must be a REAL theme, or loading the profile silently does nothing.
for (const p of builtinProfiles('tab')) {
  assert.ok(p.data.themeName in THEMES, `${p.name}: "${p.data.themeName}" is not a theme`);
}
// Positive polarity (dark-on-light) under normal/bright light; inverted only in a dim room, where
// the panel itself becomes the glare source.
assert.equal(tabBy('desktop', 'bright').themeName, 'High Contrast', 'daylight wants maximum contrast');
assert.notEqual(tabBy('desktop', 'normal').themeName, tabBy('desktop', 'dim').themeName, 'polarity changes with the room');
for (const [dev] of BUILTIN_DEVICES) {
  assert.equal(tabBy(dev, 'dim').themeName, 'Dark', `${dev}: dim rooms invert polarity`);
  assert.equal(tabBy(dev, 'bright').themeName, 'High Contrast', `${dev}: daylight maximises contrast`);
}
// The light layer must not clobber the device layer's typography.
for (const [light] of BUILTIN_LIGHT) {
  assert.equal(tabBy('phone', light).rightPaneFontSize, phone.rightPaneFontSize, 'light variant keeps device type size');
  assert.equal(tabBy('phone', light).autoFontCpl, phone.autoFontCpl, 'light variant keeps device CPL');
}

// ── evening blue light ──
const appBy = (dev, light) => builtinProfiles('app').find((p) => p.device === dev && p.light === light).data;
assert.equal(appBy('desktop', 'dim').nightShift, true, 'the warm overlay belongs to the night variant');
assert.equal(appBy('desktop', 'normal').nightShift, false);
assert.equal(appBy('desktop', 'bright').nightShift, false);
assert.ok(appBy('phone', 'dim').chipMode, 'light variant keeps the device layer (phone chips)');

// ── 20-20-20 ──
const comfort = Object.fromEntries(builtinProfiles('comfort').map((p) => [p.device, p.data.comfort]));
assert.equal(comfort.desktop.breakIntervalMin, 20, '20-20-20 convention');
assert.equal(comfort.desktop.microbreakSec, 20);
assert.ok(comfort.phone.breakIntervalMin < comfort.desktop.breakIntervalMin, 'held closer → break sooner');

// Secrets never ride in a preset (API keys are device-local secrets).
for (const kind of [...DEVICE_ONLY, ...LIGHT_KINDS]) {
  for (const p of builtinProfiles(kind)) {
    for (const secret of ['elevenLabsKey', 'anthropicKey', 'translateKey']) {
      assert.ok(!(secret in p.data), `${kind}/${p.name} must not carry ${secret}`);
    }
  }
}

// appliesCleanly: a loaded preset reads as already-applied; any difference reads as loadable.
assert.ok(appliesCleanly({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2, d: 3 }, e: 4 }), 'partial nested patch matches');
assert.ok(!appliesCleanly({ a: 1 }, { a: 2 }));
assert.ok(!appliesCleanly({ b: { c: 2 } }, { b: { c: 9 } }));
assert.ok(appliesCleanly(phone, { ...phone, unrelated: true }), 'a real preset detects itself');

console.log('builtinProfiles: all cases pass');
