// Self-check for the guided squashed-ToC parsing — run: node app/src/document/tocWizard.demo.mjs
import assert from 'node:assert';
import { autoSplitSquashed, parseManualToc, parsePrintedToc, outOfSequence, seqWindow, autoLocateRemaining, buildFromPrintedToc } from './tocWizard.js';

// A whole contents list squashed onto ONE line (the case the wizard used to choke on).
const blob = 'Introduction 1 Chapter One The Beginning 5 Chapter Two Rising Action 20 Conclusion 99';

// parsePrintedToc on a single line finds ~nothing usable (too long → dropped, or one blob).
const oneLineDoc = { lines: [{ text: blob, isEmpty: false, startWordIndex: 0 }], words: new Array(20) };
assert.ok(parsePrintedToc(oneLineDoc, 0, 0).length <= 1, 'the automatic parse cannot split one line');

// The guided path: auto-suggest a split, then parse it line-per-entry.
const split = autoSplitSquashed(blob);
assert.ok(split.split('\n').length >= 3, `squashed blob splits into lines, got:\n${split}`);
const parsed = parseManualToc(split);
assert.ok(parsed.length >= 3, `parsed ${parsed.length} entries`);
assert.equal(parsed[0].title, 'Introduction');
assert.equal(parsed[0].page, 1);
assert.ok(parsed.some((p) => p.page === 20), 'a mid entry keeps its page number');
assert.ok(parsed.every((p) => p.title && p.title.length >= 2));

// Hand-editing the text is respected (the user can fix a bad auto-split).
const manual = parseManualToc('Prologue 2\nPart One 10\nPart Two 44');
assert.deepEqual(manual.map((p) => p.title), ['Prologue', 'Part One', 'Part Two']);
assert.deepEqual(manual.map((p) => p.page), [2, 10, 44]);

// out-of-sequence detection: a matched entry whose position isn't between its neighbours is flagged.
const seq = [
  { title: 'A', matched: true, wordIndex: 10 },
  { title: 'B', matched: true, wordIndex: 50 },
  { title: 'C', matched: true, wordIndex: 30 }, // out of order (30 < 50)
  { title: 'D', matched: true, wordIndex: 80 },
];
const bad = outOfSequence(seq);
assert.ok(bad.has(1) && bad.has(2), 'the swapped pair B(50)/C(30) are both flagged');
assert.ok(!bad.has(0) && !bad.has(3), 'the correctly-ordered ends are fine');

// seqWindow: the in-sequence bounds for a gap between two matched entries.
assert.deepEqual(seqWindow([{ matched: true, wordIndex: 10 }, { title: 'x' }, { matched: true, wordIndex: 40 }], 1), { lo: 10, hi: 40 });

// autoLocateRemaining fills an unmatched entry with an in-sequence body line.
const doc2 = {
  lines: [
    { text: 'Alpha', isEmpty: false, startWordIndex: 0 },
    { text: 'Beta', isEmpty: false, startWordIndex: 5 },
    { text: 'Gamma', isEmpty: false, startWordIndex: 10 },
  ],
  words: new Array(15),
};
const filled = autoLocateRemaining(doc2, [
  { title: 'Alpha', matched: true, wordIndex: 0 },
  { title: 'Beta', matched: false, wordIndex: null },
  { title: 'Gamma', matched: true, wordIndex: 10 },
]);
assert.equal(filled[1].matched, true, 'Beta got located');
assert.equal(filled[1].wordIndex, 5, 'Beta placed in sequence at word 5');

// ── fuzzy matching: numerals, spacing, misspellings ──
import { canonTitle, fuzzyFindLines } from './tocWizard.js';
import { readerDocFromText } from './readerDocument.js';

// canonTitle: roman + written numbers canonicalize to arabic; compounds merge
assert.equal(canonTitle('Chapter IV'), 'chapter 4');
assert.equal(canonTitle('Chapter Four'), 'chapter 4');
assert.equal(canonTitle('CHAPTER   4'), 'chapter 4');
assert.equal(canonTitle('Chapter Twenty-One'), 'chapter 21');
assert.equal(canonTitle('Part XII — The Return'), 'part 12 the return');

// A printed ToC whose numerals disagree with the body — plus a letter-spaced and a misspelled heading.
const docFz = readerDocFromText([
  'Contents',
  'Chapter One .... 1',
  'Chapter Two .... 9',
  'Chapter Three .... 15',
  '',
  'CHAPTER I',
  'body text goes on and on here',
  'C H A P T E R  2',
  'more body text follows along',
  'Chaptr Three',
  'final stretch of body text',
].join('\n'), 'fuzzy.txt');
const cands = buildFromPrintedToc(docFz, 1, 3);
assert.equal(cands.filter((c) => c.matched).length, 3, `roman/letter-spaced/misspelled headings all located (got ${cands.filter((c) => c.matched).length})`);
assert.ok(cands[0].wordIndex < cands[1].wordIndex && cands[1].wordIndex < cands[2].wordIndex, 'in order');

// fuzzyFindLines: search resistant to numeral form + misspelling
const hits = fuzzyFindLines(docFz, 'Chapter 2');
assert.ok(hits.length >= 1 && /C H A P T E R  2/.test(hits[0].text), 'letter-spaced heading found first for "Chapter 2"');
const hits2 = fuzzyFindLines(docFz, 'Chapter Three');
assert.ok(hits2.some((h) => /Chaptr Three/.test(h.text)), 'misspelled body heading still found');

console.log('tocWizard.demo: guided parsing + sequence/auto-locate passed ✅');
