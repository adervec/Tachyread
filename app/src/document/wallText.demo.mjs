// Self-check for buildWallDoc. Run: node app/src/document/wallText.demo.mjs
import assert from 'node:assert';
import { buildWallDoc, WALL_SEP } from './wallText.js';

// A tiny doc: heading, two prose lines, a blank (para break), one more prose line, then a 2nd section.
// words: [Ch,One, a,b,c, d,e, (blank), f,g, Ch,Two, h,i]
const doc = {
  words: ['Ch', 'One', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'Ch', 'Two', 'h', 'i'],
  lines: [
    { lineNumber: 1, text: 'Ch One', startWordIndex: 0, endWordIndex: 1, isEmpty: false },   // heading
    { lineNumber: 2, text: 'a b c', startWordIndex: 2, endWordIndex: 4, isEmpty: false },
    { lineNumber: 3, text: 'd e', startWordIndex: 5, endWordIndex: 6, isEmpty: false },
    { lineNumber: 4, text: '', startWordIndex: -1, endWordIndex: -1, isEmpty: true },          // para break
    { lineNumber: 5, text: 'f g', startWordIndex: 7, endWordIndex: 8, isEmpty: false },
    { lineNumber: 6, text: 'Ch Two', startWordIndex: 9, endWordIndex: 10, isEmpty: false },   // heading
    { lineNumber: 7, text: 'h i', startWordIndex: 11, endWordIndex: 12, isEmpty: false },
  ],
};
const heads = new Map([[0, 0], [5, 0]]);

// No interval breaks → headings stand alone; prose between merges into one block per section.
const w = buildWallDoc(doc, heads, { breakEvery: 0 });
assert.equal(w.lines.length, 4, `4 blocks: h1, prose, h2, prose — got ${w.lines.length}`);
assert.equal(w.lines[0].text, 'Ch One');            // heading standalone
assert.equal(w.lines[1].text, 'a b c d e\tf g');    // lines joined by space; blank → tab
assert.equal(w.lines[1].startWordIndex, 2);
assert.equal(w.lines[1].endWordIndex, 8);           // spans the whole merged range
assert.equal(w.lines[2].text, 'Ch Two');
assert.equal(w.lines[3].text, 'h i');
// heading tiers carried on the MERGED indices
assert.equal(w.headingLevels.get(0), 0);
assert.equal(w.headingLevels.get(2), 0);
// wordToLine maps every word to its merged block (current-word highlight relies on this)
assert.equal(w.wordToLine[0], 0);   // 'Ch' → heading block 0
assert.equal(w.wordToLine[2], 1);   // 'a' → prose block 1
assert.equal(w.wordToLine[8], 1);   // 'g' → still block 1
assert.equal(w.wordToLine[11], 3);  // 'h' → block 3

// breakEvery splits long prose runs — every 2 source lines starts a new block.
const w2 = buildWallDoc(doc, heads, { breakEvery: 2 });
assert.ok(w2.lines.length > w.lines.length, 'interval breaks add blocks');
// each merged block still spans a contiguous, non-overlapping word range in order
let last = -1;
for (const ln of w2.lines) { if (ln.startWordIndex < 0) continue; assert.ok(ln.startWordIndex > last, 'ranges ascend'); assert.ok(ln.endWordIndex >= ln.startWordIndex); last = ln.endWordIndex; }

// No headings, no breaks → one solid block of everything.
const flat = buildWallDoc({ ...doc, lines: doc.lines.slice(1, 5) }, null, {});
assert.equal(flat.lines.length, 1);
assert.equal(flat.lines[0].text, 'a b c d e\tf g');

// Newline marker: shown where a source line ended, prefixed with WALL_SEP so the renderer can tell
// it from a word. Word ranges must be IDENTICAL to the unmarked build — the marker is not a word.
const w3 = buildWallDoc(doc, heads, { breakEvery: 0, joiner: '¶' });
assert.equal(w3.lines[1].text, `a b c ${WALL_SEP}¶ d e\tf g`, `got ${JSON.stringify(w3.lines[1].text)}`);
assert.deepEqual(w3.wordToLine, w.wordToLine, 'marker must not shift the word→line map');
assert.equal(w3.lines[1].startWordIndex, w.lines[1].startWordIndex);
assert.equal(w3.lines[1].endWordIndex, w.lines[1].endWordIndex);
// Counting non-marker tokens is how the renderer assigns word indices — it must still find 7 words.
const toks = w3.lines[1].text.split(/\s+/).filter((t) => t && t[0] !== WALL_SEP && t !== '\t');
assert.equal(toks.length, 7, `7 real words, got ${toks.length}: ${JSON.stringify(toks)}`);
// Whitespace inside the marker is stripped so it stays a single token.
assert.equal(buildWallDoc(doc, heads, { joiner: ' • ' }).lines[1].text, `a b c ${WALL_SEP}• d e\tf g`);

console.log('wallText.demo: all assertions passed ✅');
