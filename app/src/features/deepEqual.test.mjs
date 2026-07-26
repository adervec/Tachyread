// ponytail: structural equality that gates the profile buttons — key-order-independent, undefined ~ missing.
// Run: node src/features/deepEqual.test.mjs
import assert from 'node:assert';
import { deepEqual } from './deepEqual.js';

// primitives
assert.ok(deepEqual(1, 1) && deepEqual('a', 'a') && deepEqual(true, true));
assert.ok(!deepEqual(1, 2) && !deepEqual('a', 'b') && !deepEqual(1, '1'));
assert.ok(deepEqual(null, null) && deepEqual(undefined, undefined));
assert.ok(!deepEqual(null, 0) && !deepEqual(undefined, null) && !deepEqual(null, {}));

// order-independence — the whole point (settings objects rebuild in varying key order)
assert.ok(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), 'key order ignored');
assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 }), 'a differing value is caught');
assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }), 'an extra key differs');

// undefined ~ missing (JSON round-trips drop undefined)
assert.ok(deepEqual({ a: 1, b: undefined }, { a: 1 }), 'undefined value == missing key');
assert.ok(deepEqual({ a: 1 }, { a: 1, b: undefined }), 'symmetric');
assert.ok(!deepEqual({ a: 1, b: null }, { a: 1 }), 'null is NOT the same as missing');

// arrays are order-SENSITIVE (they carry meaning), length-sensitive
assert.ok(deepEqual([1, 2, 3], [1, 2, 3]));
assert.ok(!deepEqual([1, 2, 3], [3, 2, 1]), 'array order matters');
assert.ok(!deepEqual([1, 2], [1, 2, 3]));
assert.ok(!deepEqual({ 0: 'a', 1: 'b', length: 2 }, ['a', 'b']), 'array-like object != array');

// nested realistic settings shape
const A = { wpm: 300, orpStyles: ['glow', 'pulse'], night: { on: true, strength: 0.4 }, extra: undefined };
const B = { night: { strength: 0.4, on: true }, orpStyles: ['glow', 'pulse'], wpm: 300 };
assert.ok(deepEqual(A, B), 'deep nested + reordered + trailing-undefined match');
assert.ok(!deepEqual(A, { ...B, night: { on: true, strength: 0.5 } }), 'a deep change is caught');
assert.ok(!deepEqual(A, { ...B, orpStyles: ['glow'] }), 'a nested array change is caught');

console.log('deepEqual: all cases pass');
