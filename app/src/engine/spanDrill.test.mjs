// ponytail: perceptual-span drill — chunk pick, order-independent recall scoring, adaptive staircase.
// Run: node src/engine/spanDrill.test.mjs
import assert from 'node:assert';
import { DEFAULT_DRILL, pickChunk, scoreRecall, nextDrill } from './spanDrill.js';

// pickChunk: a valid contiguous run, or null when it can't fit
const doc = { words: ['a', 'b', 'c', 'd', 'e'] };
const c = pickChunk(doc, 3, () => 0);
assert.deepEqual(c, { start: 0, words: ['a', 'b', 'c'] }, 'rand=0 → first run');
assert.deepEqual(pickChunk(doc, 3, () => 0.999).words, ['c', 'd', 'e'], 'rand≈1 → last valid run (never overruns)');
assert.equal(pickChunk(doc, 6), null, 'span longer than doc → null');
assert.equal(pickChunk(doc, 0), null, 'span < 1 → null');
assert.equal(pickChunk({ words: [] }, 1), null, 'empty doc → null');
assert.equal(pickChunk(null, 2), null, 'no doc → null');
// the random start is always in-bounds across the whole range
for (let r = 0; r < 1; r += 0.05) {
  const ch = pickChunk(doc, 2, () => r);
  assert.ok(ch.start >= 0 && ch.start + 2 <= doc.words.length, `start ${ch.start} in bounds for r=${r}`);
}

// scoreRecall: order-independent, punctuation/case-insensitive, no double-counting
assert.equal(scoreRecall(['The', 'quick', 'Brown'], 'brown the quick').frac, 1, 'all recalled, any order/case');
assert.equal(scoreRecall(['the', 'quick', 'brown'], 'the the the').matched, 1, 'a repeated guess only matches once');
assert.equal(scoreRecall(['a', 'b', 'c', 'd'], 'a b').frac, 0.5, 'partial recall');
assert.equal(scoreRecall(['word!'], 'word').frac, 1, 'trailing punctuation stripped both sides');
assert.deepEqual(scoreRecall([], 'anything'), { matched: 0, total: 0, frac: 1 }, 'nothing to recall → frac 1');
assert.equal(scoreRecall(['a', 'b'], '').frac, 0, 'no typing → 0');
assert.equal(scoreRecall(['a', 'b'], null).frac, 0, 'null typing → 0, no throw');

// nextDrill staircase
const st = { span: 3, flashMs: 320 };
assert.deepEqual(nextDrill(st, true), { span: 4, flashMs: 320 }, 'pass below max → widen span, flash unchanged');
assert.deepEqual(nextDrill({ span: 9, flashMs: 320 }, true), { span: 9, flashMs: 288 }, 'pass at max span → shorten flash');
assert.equal(nextDrill({ span: 9, flashMs: DEFAULT_DRILL.minFlashMs }, true).flashMs, DEFAULT_DRILL.minFlashMs, 'flash never below min');
// fail: restore flash FIRST (if shortened), only then narrow span
const failFlash = nextDrill({ span: 9, flashMs: 200 }, false);
assert.ok(failFlash.flashMs > 200 && failFlash.span === 9, 'fail with a shortened flash → lengthen flash, keep span');
assert.deepEqual(nextDrill({ span: 5, flashMs: 320 }, false), { span: 4, flashMs: 320 }, 'fail at base flash → narrow span');
assert.equal(nextDrill({ span: DEFAULT_DRILL.minSpan, flashMs: 320 }, false).span, DEFAULT_DRILL.minSpan, 'span never below min');

console.log('spanDrill: all cases pass');
