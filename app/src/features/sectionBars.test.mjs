// Self-check for the multi-level section bars: which sections contain a position, and which of
// them each display mode draws.
import assert from 'node:assert/strict';
import { sectionChain, barsForMode, SECTION_BAR_MODES, DEFAULT_SECTION_BAR_MODE } from './sectionBars.js';

// Part I [0,600) ─ Ch 1 [100,300) ─ Ch 2 [300,600) ─ §2.1 [350,400) ─ §2.2 [400,600)
// Part II [600,1000) ─ Ch 3 [650,1000)
const entries = [
  { title: 'Part I', level: 0, wordIndex: 0 },
  { title: 'Chapter 1', level: 1, wordIndex: 100 },
  { title: 'Chapter 2', level: 1, wordIndex: 300 },
  { title: 'Section 2.1', level: 2, wordIndex: 350 },
  { title: 'Section 2.2', level: 2, wordIndex: 400 },
  { title: 'Part II', level: 0, wordIndex: 600 },
  { title: 'Chapter 3', level: 1, wordIndex: 650 },
];
const TOTAL = 1000;
const chainAt = (i) => sectionChain(entries, i, TOTAL);
const titles = (i) => chainAt(i).map((m) => m.title);

// The whole point: three sections contain word 370 at once, outermost first.
assert.deepEqual(titles(370), ['Part I', 'Chapter 2', 'Section 2.1']);
assert.deepEqual(titles(150), ['Part I', 'Chapter 1'], 'no level-2 section here');
assert.deepEqual(titles(50), ['Part I'], 'before the first chapter');
assert.deepEqual(titles(700), ['Part II', 'Chapter 3']);
assert.deepEqual(titles(620), ['Part II'], 'inside a part, before its first chapter');

// Progress is measured against each section's OWN extent, so the same word sits at a different
// fraction of the part, the chapter and the subsection.
const at370 = chainAt(370);
assert.equal(Math.round(at370[0].progress * 100), 62, 'Part I: 370 of 600');
assert.equal(Math.round(at370[1].progress * 100), 23, 'Chapter 2: 70 of 300');
assert.equal(Math.round(at370[2].progress * 100), 40, 'Section 2.1: 20 of 50');
assert.equal(at370[0].remaining, 230);
assert.equal(at370[2].remaining, 30);

// Boundaries: a section's own first word is inside it; its end word belongs to the next.
assert.ok(titles(300).includes('Chapter 2'));
assert.ok(!titles(300).includes('Chapter 1'), 'the end index belongs to the next section');
assert.ok(titles(599).includes('Chapter 2'));
assert.ok(!titles(600).includes('Part I'), 'Part II starts exactly at 600');

// Degenerate input never throws.
assert.deepEqual(sectionChain([], 10, 100), []);
assert.deepEqual(sectionChain(null, 10, 100), []);
assert.deepEqual(sectionChain(entries, 99999, TOTAL), [], 'past the end of the book');

// A malformed ToC with two headings at the same level covering the same spot must not draw two
// bars for one depth — the innermost containing one wins.
const dupes = [
  { title: 'A', level: 0, wordIndex: 0 },
  { title: 'B', level: 0, wordIndex: 10 },
  { title: 'C', level: 1, wordIndex: 20 },
];
const dupChain = sectionChain(dupes, 30, 100);
assert.equal(new Set(dupChain.map((m) => m.level)).size, dupChain.length, 'one bar per depth');

// ── display modes ──
const chain = chainAt(370);
assert.equal(barsForMode(chain, 'single').length, 1);
assert.equal(barsForMode(chain, 'single')[0].title, 'Section 2.1', 'single shows the INNERMOST');
assert.deepEqual(barsForMode(chain, 'parallel').map((m) => m.title), ['Part I', 'Chapter 2', 'Section 2.1']);
assert.deepEqual(barsForMode(chain, 'nested').map((m) => m.title), ['Part I', 'Chapter 2', 'Section 2.1']);

// Cycling walks the chain and wraps, for any tick — including negatives from a clock going backwards.
assert.equal(barsForMode(chain, 'cycle', 0)[0].title, 'Part I');
assert.equal(barsForMode(chain, 'cycle', 1)[0].title, 'Chapter 2');
assert.equal(barsForMode(chain, 'cycle', 2)[0].title, 'Section 2.1');
assert.equal(barsForMode(chain, 'cycle', 3)[0].title, 'Part I', 'wraps');
assert.equal(barsForMode(chain, 'cycle', -1)[0].title, 'Section 2.1', 'negative ticks wrap forward');
assert.equal(barsForMode(chain, 'cycle', 2.9)[0].title, 'Section 2.1', 'fractional ticks floor');
for (const t of [0, 1, 2, 3, 50]) assert.equal(barsForMode(chain, 'cycle', t).length, 1);

// An unknown/absent mode falls back to single rather than rendering nothing.
assert.equal(barsForMode(chain, 'nonsense').length, 1);
assert.equal(barsForMode(chain).length, 1);
assert.equal(DEFAULT_SECTION_BAR_MODE, 'single', 'default preserves the previous behaviour');

// A one-level document behaves identically in every mode — nothing to stack or cycle through.
const flat = sectionChain([{ title: 'Only', level: 0, wordIndex: 0 }], 10, 100);
for (const [mode] of SECTION_BAR_MODES) assert.equal(barsForMode(flat, mode, 3).length, 1, `${mode} on a flat doc`);

// No chain → no bars, in every mode.
for (const [mode] of SECTION_BAR_MODES) assert.deepEqual(barsForMode([], mode), []);

// Catalog hygiene.
const ids = SECTION_BAR_MODES.map(([id]) => id);
assert.equal(new Set(ids).size, ids.length);
assert.ok(ids.includes(DEFAULT_SECTION_BAR_MODE));

// A top-level heading spanning the WHOLE document says nothing the overall progress bar doesn't,
// so it's dropped from the chain — unless it's all there is, or the bar would go blank.
const wholeDoc = [{ title: 'The Book', level: 0, wordIndex: 0 }, ...entries.map((e) => ({ ...e, level: e.level + 1 }))];
assert.deepEqual(
  sectionChain(wholeDoc, 370, TOTAL).map((m) => m.title),
  ['Part I', 'Chapter 2', 'Section 2.1'],
  'the document-wide root is dropped',
);
assert.deepEqual(
  sectionChain([{ title: 'The Book', level: 0, wordIndex: 0 }], 370, TOTAL).map((m) => m.title),
  ['The Book'],
  'but never down to no bars at all',
);
// A root that merely STARTS at 0 without covering the whole text is a real section — keep it.
assert.deepEqual(sectionChain(entries, 370, TOTAL)[0].title, 'Part I', 'Part I ends at 600, so it stays');

// offset/extent place each bar inside the outermost one — this is what nested mode draws.
const geo = sectionChain(entries, 370, TOTAL);
assert.equal(geo[0].offset, 0, 'the outermost bar starts at its own left edge');
assert.equal(geo[0].extent, 1, 'and spans the full width');
// Chapter 2 is [300,600) inside Part I [0,600): half in, half wide.
assert.equal(geo[1].offset.toFixed(4), '0.5000');
assert.equal(geo[1].extent.toFixed(4), '0.5000');
// Section 2.1 is [350,400) inside the same 600-word part.
assert.equal(geo[2].offset.toFixed(4), (350 / 600).toFixed(4));
assert.equal(geo[2].extent.toFixed(4), (50 / 600).toFixed(4));
// Every bar must fit inside its parent, at every position — otherwise nested mode draws outside.
for (let i = 0; i < TOTAL; i += 7) {
  const c = sectionChain(entries, i, TOTAL);
  for (let k = 1; k < c.length; k++) {
    assert.ok(c[k].offset >= c[k - 1].offset - 1e-9, `bar ${k} starts inside its parent at ${i}`);
    assert.ok(c[k].offset + c[k].extent <= c[k - 1].offset + c[k - 1].extent + 1e-9, `bar ${k} ends inside its parent at ${i}`);
  }
}

console.log('sectionBars: all cases pass');
