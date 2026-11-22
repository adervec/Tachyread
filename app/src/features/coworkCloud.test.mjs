// node src/features/coworkCloud.test.mjs — cloud names follow the protocol; the applied list is a join.
import assert from 'node:assert/strict';
import { cloudName, mergeApplied } from './coworkCloud.js';

assert.equal(cloudName('snapshot/books.json'), 'cowork-tachyread--snapshot--books.json');
assert.equal(cloudName('/cowork.json'), 'cowork-tachyread--cowork.json');
assert.equal(cloudName('inbox/processed/x.json'), 'cowork-tachyread--inbox--processed--x.json');
const a = { applied: ['h2', 'h1'] }, b = { applied: ['h3', 'h1', 7] };
assert.deepEqual(mergeApplied(a, b), mergeApplied(b, a), 'same list whichever device merges');
assert.deepEqual(mergeApplied(a, b).applied, ['h1', 'h2', 'h3'], 'union, junk dropped');
assert.deepEqual(mergeApplied(mergeApplied(a, b), a), mergeApplied(a, b), 'merging again changes nothing');
assert.equal(mergeApplied({ applied: Array.from({ length: 600 }, (_, i) => `h${String(i).padStart(3, '0')}`) }, null).applied.length, 500, 'capped at 500');
console.log('coworkCloud: all cases pass');
