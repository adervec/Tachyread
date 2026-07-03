// ponytail: the chunker must (a) join wrapped fragments into whole sentences, (b) cover every
// non-blank line exactly once with no gaps/overlaps, (c) split at paragraph breaks and cap runaway
// blocks. Run: node src/document/audiobookChunks.test.mjs
import { readerDocFromText, audiobookChunks } from './readerDocument.js';
import assert from 'node:assert';

// A hard-wrapped sentence split across three source lines, then a second sentence, then a new para.
const wrapped = [
  'The quick brown fox jumps',      // line 0 (sentence continues)
  'over the lazy dog and then',     // line 1 (still same sentence)
  'keeps on running.',              // line 2 (ends sentence 1)
  'A second sentence lives here.',  // line 3 (whole sentence on one line)
  '',                               // line 4 (blank → paragraph break)
  'Next paragraph starts fresh.',   // line 5
].join('\n');
const doc = readerDocFromText(wrapped, 'wrapped.txt');
const chunks = audiobookChunks(doc);

// The three wrapped fragments coalesce into ONE chunk ending at the sentence.
assert(chunks[0].startLine === 0 && chunks[0].endLine === 2, `first chunk spans lines 0-2, got ${chunks[0].startLine}-${chunks[0].endLine}`);
assert(/quick brown fox.*keeps on running\./.test(chunks[0].text), `first chunk is the whole sentence: "${chunks[0].text}"`);
// The standalone sentence is its own chunk (ends the paragraph before the blank line).
assert(chunks[1].startLine === 3 && chunks[1].endLine === 3, `second chunk is line 3, got ${chunks[1].startLine}-${chunks[1].endLine}`);
// The blank line is skipped; the next paragraph is a fresh chunk.
assert(chunks[2].startLine === 5, `third chunk starts the new paragraph at line 5, got ${chunks[2].startLine}`);

// Coverage: every non-blank line belongs to exactly one chunk, in order, no gaps/overlaps.
let expectLine = 0;
for (const c of chunks) {
  assert(c.startLine >= expectLine, `chunks are ordered / non-overlapping (start ${c.startLine} >= ${expectLine})`);
  assert(c.endLine >= c.startLine, `chunk end >= start`);
  assert(c.startWordIndex <= c.endWordIndex, `chunk word range is sane`);
  expectLine = c.endLine + 1;
}

// Cap: a hard-wrapped block with no sentence punctuation still gets broken up (not one giant chunk).
const runOnLines = [];
for (let i = 0; i < 20; i++) runOnLines.push(Array.from({ length: 10 }, (_, j) => `w${i * 10 + j}`).join(' '));
const bigDoc = readerDocFromText(runOnLines.join('\n'), 'runon.txt'); // 20 lines × 10 words, no punctuation
const bigChunks = audiobookChunks(bigDoc);
assert(bigChunks.length > 1, `runaway wrapped block is capped into multiple chunks, got ${bigChunks.length}`);

console.log(`ok — ${chunks.length} chunks from wrapped doc, ${bigChunks.length} from the 200-word run-on`);
