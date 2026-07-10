// Self-check for skip-range add/remove. Run: node src/document/skipRanges.demo.mjs
import assert from 'node:assert';
import { mergeSkipRanges, removeSkipRange } from './toc.js';

// merge then remove the same span returns to empty (round-trip)
let r = mergeSkipRanges([], [{ start: 100, end: 200, label: 'Ch 3' }]);
assert.deepEqual(r, [{ start: 100, end: 200, label: 'Ch 3' }]);
assert.deepEqual(removeSkipRange(r, 100, 200), []);

// removing a middle slice splits the range in two
assert.deepEqual(
  removeSkipRange([{ start: 0, end: 300, label: 'x' }], 100, 200),
  [{ start: 0, end: 100, label: 'x' }, { start: 200, end: 300, label: 'x' }],
);

// non-overlapping remove leaves it untouched; overlapping-left trims the front
assert.deepEqual(removeSkipRange([{ start: 100, end: 200 }], 300, 400), [{ start: 100, end: 200 }]);
assert.deepEqual(removeSkipRange([{ start: 100, end: 200 }], 50, 150), [{ start: 150, end: 200 }]);

// merge is idempotent + coalesces adjacent
assert.deepEqual(
  mergeSkipRanges([{ start: 0, end: 100 }], [{ start: 100, end: 150 }]),
  [{ start: 0, end: 150, label: '' }],
);

console.log('skipRanges.demo: all assertions passed ✅');
