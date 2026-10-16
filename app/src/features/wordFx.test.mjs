import assert from 'node:assert/strict';
import { fxKeyframes } from './wordFx.js';

const alpha = (f) => Number(/rgba\(46,157,79,([\d.]+)\)/.exec(f[0].color)[1]);
// Better read → more intense.
assert.ok(alpha(fxKeyframes(1)) > alpha(fxKeyframes(0.8)));
assert.ok(alpha(fxKeyframes(0.8)) > alpha(fxKeyframes(0.6)));
// Skipped words get the faint red, not the green.
assert.match(fxKeyframes(0)[0].color, /192,57,43/);
// Pop flashes only perfect words, and never under reduced motion.
assert.ok(fxKeyframes(1, 'pop')[0].backgroundColor);
assert.equal(fxKeyframes(0.8, 'pop')[0].backgroundColor, undefined);
assert.equal(fxKeyframes(1, 'pop', true)[0].backgroundColor, undefined);
assert.equal(fxKeyframes(1, 'off'), null);
console.log('wordFx: all cases pass');
