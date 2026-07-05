// Self-check for findText.js — run: node app/src/document/findText.demo.mjs
import assert from 'node:assert';
import { findInDoc, contextLines, escapeRe } from './findText.js';

// Minimal reader-doc stub: lines with text + startWordIndex, and a words array for the total.
const lines = [
  { text: 'Chapter One begins', startWordIndex: 0 },
  { text: 'the quick brown fox', startWordIndex: 3 },
  { text: 'jumps over the lazy dog', startWordIndex: 7 },
  { text: 'Chapter Two arrives', startWordIndex: 12 },
  { text: 'the fox returns again', startWordIndex: 15 },
];
const doc = { lines, words: new Array(19) };
const toc = [{ wordIndex: 0, title: 'Chapter One' }, { wordIndex: 12, title: 'Chapter Two' }];

const hits = findInDoc(doc, 'fox', { tocEntries: toc, readFrontier: 10 });
assert.equal(hits.length, 2, 'two lines contain "fox"');
assert.deepEqual(hits.map((h) => h.lineIndex), [1, 4]);
assert.deepEqual(hits.map((h) => h.seq), [1, 2]);              // sequence numbering
assert.equal(hits[0].wordIndex, 3);
assert.equal(hits[0].section, 'Chapter One');                  // containing section
assert.equal(hits[1].section, 'Chapter Two');
assert.equal(hits[0].read, true, 'word 3 is before the read frontier (10)');
assert.equal(hits[1].read, false, 'word 15 is after the read frontier');
assert.ok(hits[1].pct > 70 && hits[1].pct <= 100, `% location, got ${hits[1].pct}`);

// case sensitivity
assert.equal(findInDoc(doc, 'CHAPTER').length, 2, 'case-insensitive by default');
assert.equal(findInDoc(doc, 'CHAPTER', { caseSensitive: true }).length, 0, 'case-sensitive misses');

// regex metacharacters are treated literally
assert.equal(findInDoc(doc, 'fox.').length, 0, 'dot is literal, no "fox." in the text');
assert.equal(escapeRe('a.b*c'), 'a\\.b\\*c');

// context window around a hit
const ctx = contextLines(doc, 4, 2);
assert.deepEqual(ctx.map((c) => c.lineIndex), [2, 3, 4]);       // clamped at the end
assert.equal(ctx.find((c) => c.match).lineIndex, 4);

// empty query → nothing
assert.equal(findInDoc(doc, '').length, 0);

console.log('findText.demo: all assertions passed ✅');
