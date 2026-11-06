import assert from 'node:assert/strict';
import { emulateKey, keyFor, courseStep, coursePassage, COURSE_ORDER } from './keyboardLayouts.js';

// Colemak: QWERTY's E key types f, S types r, ; types o
assert.equal(emulateKey('KeyE', false, 'colemak'), 'f');
assert.equal(emulateKey('KeyS', false, 'colemak'), 'r');
assert.equal(emulateKey('Semicolon', false, 'colemak'), 'o');
assert.equal(emulateKey('KeyS', true, 'colemak'), 'R', 'shift → capital');
// Dvorak: Q key types ', shifted "; S types o
assert.equal(emulateKey('KeyQ', false, 'dvorak'), "'");
assert.equal(emulateKey('KeyQ', true, 'dvorak'), '"');
assert.equal(emulateKey('KeyS', false, 'dvorak'), 'o');
assert.equal(emulateKey('KeyA', false, 'qwerty'), null, 'QWERTY passes through');
assert.equal(emulateKey('Digit1', false, 'dvorak'), null, 'number row untouched');

assert.deepEqual(keyFor('f', 'colemak'), { row: 0, col: 2, shift: false });
assert.deepEqual(keyFor('F'), { row: 1, col: 3, shift: true });
assert.deepEqual(keyFor(':'), { row: 1, col: 9, shift: true });
assert.deepEqual(keyFor(' '), { space: true });
assert.equal(keyFor('1'), null);

// course: 6 letters unlocked; all fast + accurate → unlock the 7th
const fast = Object.fromEntries([...COURSE_ORDER.slice(0, 6)].map((c) => [c, { t: 5, ms: 5 * 200 }])); // 60 wpm each
assert.deepEqual(courseStep(6, fast, 97), { unlock: true, next: 's', slow: [], accuracyOk: true });
assert.equal(courseStep(6, { ...fast, e: { t: 5, ms: 5 * 600 } }, 97).unlock, false, 'one slow key holds it back');
assert.deepEqual(courseStep(6, { ...fast, e: { t: 5, ms: 5 * 600 } }, 97).slow, ['e']);
assert.equal(courseStep(6, fast, 90).unlock, false, 'accuracy gate');
assert.deepEqual(courseStep(6, { ...fast, r: undefined }, 99).slow, ['r'], 'untyped key counts as not yet fast');

const p = coursePassage(6, 60, 1, 'the tree is near ten eerie inert rent tint quick zebra'.split(' '));
const allowed = new Set(COURSE_ORDER.slice(0, 6));
assert.equal(p.length, 60);
assert.ok(p.every((w) => [...w].every((c) => allowed.has(c))), 'only unlocked letters');
assert.ok(p.filter((w) => w.includes('l')).length > 6, 'focus letter (6th: l) in play');
assert.ok(p.some((w) => ['tree', 'ten', 'inert', 'rent', 'tint', 'eerie'].includes(w)), 'real book words used');
assert.ok(!p.some((w) => /(.)/.test(w)), 'no triple letters');
console.log('keyboardLayouts: all cases pass');
