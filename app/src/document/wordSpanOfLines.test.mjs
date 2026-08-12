// Self-check for the screenful measurement behind the section bar's page ticks. The case that
// actually bit: a visible range whose FIRST or LAST row is a blank spacer, which carries no word
// indices — reading the edges directly reported the whole page as empty and killed segmentation.
import assert from 'node:assert/strict';
import { wordSpanOfLines } from './readerDocument.js';

const L = (s, e) => ({ startWordIndex: s, endWordIndex: e });
const BLANK = L(-1, -1);
// 0: words 0-4 · 1: blank · 2: words 5-9 · 3: blank · 4: words 10-19
const lines = [L(0, 4), BLANK, L(5, 9), BLANK, L(10, 19)];

assert.equal(wordSpanOfLines(lines, 0, 4), 20, 'whole doc: words 0..19');
assert.equal(wordSpanOfLines(lines, 0, 0), 5);
assert.equal(wordSpanOfLines(lines, 2, 2), 5);

// The regression: blanks at either edge of the range must not zero the span.
assert.equal(wordSpanOfLines(lines, 1, 4), 15, 'leading blank walks inward to line 2');
assert.equal(wordSpanOfLines(lines, 0, 3), 10, 'trailing blank walks back to line 2');
assert.equal(wordSpanOfLines(lines, 1, 3), 5, 'blanks on BOTH edges still finds line 2');

// A range of nothing but blanks genuinely has no words — callers read 0 as "don't segment".
assert.equal(wordSpanOfLines([BLANK, BLANK], 0, 1), 0);
assert.equal(wordSpanOfLines(lines, 3, 3), 0);

// Out-of-range and malformed input are clamped/skipped rather than throwing.
assert.equal(wordSpanOfLines(lines, -5, 99), 20, 'indices clamp to the array');
assert.equal(wordSpanOfLines(lines, 4, 0), 10, 'reversed range clamps to a single line');
assert.equal(wordSpanOfLines([], 0, 3), 0);
assert.equal(wordSpanOfLines(null, 0, 3), 0);
assert.equal(wordSpanOfLines([null, undefined, L(2, 3)], 0, 2), 2, 'holes in the array are skipped');

// The segment count the bar draws from it: ceil, so a trailing part-page still gets a tick.
const pages = (sectionWords, pageWords) => (pageWords > 0 ? Math.ceil(sectionWords / pageWords) : 0);
assert.equal(pages(360, 72), 5);
assert.equal(pages(361, 72), 6, 'a leftover sliver is still a page');
assert.equal(pages(50, 72), 1, 'a section inside one screenful is a single page — no ticks');
assert.equal(pages(100, 0), 0, 'unmeasurable page size disables segmentation');

console.log('wordSpanOfLines: all cases pass');
