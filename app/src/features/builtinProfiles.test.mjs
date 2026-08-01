// Self-check: built-in device profiles (desktop/phone/tablet presets on every settings page).
// Run: node src/features/builtinProfiles.test.mjs
import assert from 'node:assert/strict';
import { builtinProfiles, appliesCleanly, BUILTIN_DEVICES } from './builtinProfiles.js';

// Every settings-page kind ships all three device presets.
for (const kind of ['tab', 'app', 'bio', 'audio', 'comfort', 'typing']) {
  const list = builtinProfiles(kind);
  assert.equal(list.length, 3, `${kind} has desktop/phone/tablet presets`);
  assert.deepEqual(list.map((p) => p.device), BUILTIN_DEVICES.map(([id]) => id));
  for (const p of list) {
    assert.ok(p.builtin, 'flagged builtin');
    assert.ok(p.name.includes('built-in'), 'name marks it built-in');
    assert.ok(p.data && typeof p.data === 'object' && Object.keys(p.data).length > 0, `${kind}/${p.device} has data`);
  }
}
assert.deepEqual(builtinProfiles('nope'), [], 'unknown kind → empty');

// Phone tab preset raises the font and hides the Fast Reader; desktop keeps the factory look.
const tab = Object.fromEntries(builtinProfiles('tab').map((p) => [p.device, p.data]));
assert.ok(tab.phone.rightPaneFontSize > tab.desktop.rightPaneFontSize, 'phone font > desktop font');
assert.equal(tab.phone.hideRsvpPane, true);
assert.equal(tab.desktop.hideRsvpPane, false);

// Secrets never ride in a preset (API keys are device-local secrets).
for (const kind of ['tab', 'app', 'bio', 'audio', 'comfort', 'typing']) {
  for (const p of builtinProfiles(kind)) {
    for (const secret of ['elevenLabsKey', 'anthropicKey', 'translateKey']) {
      assert.ok(!(secret in p.data), `${kind}/${p.device} must not carry ${secret}`);
    }
  }
}

// appliesCleanly: exact subset → true; any differing key → false; nested partials compare per key.
assert.equal(appliesCleanly({ a: 1 }, { a: 1, b: 2 }), true);
assert.equal(appliesCleanly({ a: 1 }, { a: 2, b: 2 }), false);
assert.equal(appliesCleanly({ a: 1, c: 3 }, { a: 1, b: 2 }), false, 'missing key ≠ match');
assert.equal(appliesCleanly({ typing: { lowercase: true } }, { typing: { lowercase: true, noSpecial: false, sounds: {} } }), true, 'nested partial matches fuller object');
assert.equal(appliesCleanly({ typing: { lowercase: true } }, { typing: { lowercase: false } }), false);
assert.equal(appliesCleanly({ list: [1, 2] }, { list: [1, 2] }), true, 'arrays deep-compare whole');
assert.equal(appliesCleanly({ list: [1, 2] }, { list: [1, 2, 3] }), false, 'arrays are not subset-matched');
assert.equal(appliesCleanly({ a: null }, { a: null }), true);
assert.equal(appliesCleanly({ a: 1 }, undefined), false, 'no current → not applied');

console.log('builtinProfiles: all checks passed');
