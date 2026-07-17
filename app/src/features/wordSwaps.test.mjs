// Run: node src/features/wordSwaps.test.mjs
import assert from 'node:assert';
import { swapLookup, applySwap } from './wordSwaps.js';

const lk = swapLookup({ colour: 'color', Utilise: 'use', '': 'nope', junk: '' });
assert.equal(applySwap('colour', lk), 'color', 'plain swap');
assert.equal(applySwap('Colour', lk), 'Color', 'leading capital preserved');
assert.equal(applySwap('“colour,”', lk), '“color,”', 'punctuation preserved');
assert.equal(applySwap('utilise', lk), 'use', 'settings key is case-insensitive');
assert.equal(applySwap('colours', lk), 'colours', 'no partial-word swap');
assert.equal(applySwap('junk', lk), 'junk', 'empty replacement is ignored');
assert.equal(applySwap('word', null), 'word', 'no lookup = no-op');
assert.equal(swapLookup({}), null, 'empty map → null lookup');
console.log('ok');
