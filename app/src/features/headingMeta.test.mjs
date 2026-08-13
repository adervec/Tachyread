// Self-check for rich section headers: section extents, the structure around a heading, and the
// chips rendered from them.
import assert from 'node:assert/strict';
import { buildHeadingMeta, headingDetailChips, HEADING_DETAIL_ITEMS } from './headingMeta.js';

// Part I ─ Ch 1 ─ Ch 2 (§2.1, §2.2) ─ Part II ─ Ch 3
const entries = [
  { title: 'Part I', level: 0, wordIndex: 0 },
  { title: 'Chapter 1', level: 1, wordIndex: 100 },
  { title: 'Chapter 2', level: 1, wordIndex: 300 },
  { title: 'Section 2.1', level: 2, wordIndex: 350 },
  { title: 'Section 2.2', level: 2, wordIndex: 400 },
  { title: 'Part II', level: 0, wordIndex: 600 },
  { title: 'Chapter 3', level: 1, wordIndex: 650 },
];
const meta = buildHeadingMeta(entries, 1000);
const by = (t) => meta.find((m) => m.title === t);

// A section ends at the next SAME-OR-SHALLOWER heading — a deeper one is inside it. Getting this
// wrong makes every parent look one subsection long.
assert.equal(by('Part I').end, 600, 'Part I runs to Part II, not to Chapter 1');
assert.equal(by('Part I').words, 600);
assert.equal(by('Chapter 1').end, 300, 'Chapter 1 ends where Chapter 2 begins');
assert.equal(by('Chapter 2').end, 600, 'Chapter 2 contains its subsections and ends at Part II');
assert.equal(by('Section 2.1').end, 400);
assert.equal(by('Chapter 3').end, 1000, 'the last section runs to the end of the book');

// Share of book.
assert.equal(Math.round(by('Part I').pctOfBook), 60);

// Structure: parent is the nearest SHALLOWER heading; children are DIRECT children only.
assert.equal(by('Chapter 2').parentTitle, 'Part I');
assert.equal(by('Section 2.1').parentTitle, 'Chapter 2');
assert.equal(by('Part I').parentTitle, null, 'a top-level section has no parent');
assert.equal(by('Chapter 2').childCount, 2);
assert.equal(by('Part I').childCount, 2, 'Ch 1 + Ch 2 — the level-2 sections are grandchildren');
assert.equal(by('Chapter 1').childCount, 0);

// Siblings share a parent AND a level.
assert.equal(by('Chapter 1').siblingIndex, 1);
assert.equal(by('Chapter 1').siblingCount, 2, 'Ch 1 and Ch 2 are siblings; Ch 3 belongs to Part II');
assert.equal(by('Chapter 2').siblingIndex, 2);
assert.equal(by('Chapter 3').siblingCount, 1);
assert.equal(by('Part II').siblingIndex, 2);
assert.equal(by('Part I').depth, 1);
assert.equal(by('Section 2.1').depth, 3);

// Degenerate input must not throw.
assert.deepEqual(buildHeadingMeta([], 100), []);
assert.deepEqual(buildHeadingMeta(null, 100), []);
assert.equal(buildHeadingMeta([{ title: 'Solo', wordIndex: 0 }], 0)[0].words, 0, 'zero-word doc');
assert.equal(buildHeadingMeta([{ title: 'x', level: NaN, wordIndex: 0 }], 10)[0].level, 0, 'bad level → 0');

// ── chips ──
const ids = HEADING_DETAIL_ITEMS.map(([id]) => id);
const chips = headingDetailChips(by('Chapter 2'), ids, { wpm: 200, readerIdx: 0 });
const text = chips.map((c) => c.text).join(' | ');
assert.match(text, /🔢 300 words/);
assert.match(text, /⏱ 2m/, '300 words at 200 wpm');
assert.match(text, /💯 30\.0% of book/);
assert.match(text, /⬆️ Part I/);
assert.match(text, /🌿 2 sub-sections/);
assert.match(text, /📍 2 of 2/);
assert.match(text, /🪜 level 2/);
// Chips follow the catalog order, not the caller's id order.
assert.deepEqual(chips.map((c) => c.id), ids.filter((id) => id !== 'progress'));
assert.deepEqual(
  headingDetailChips(by('Chapter 2'), ['depth', 'words'], {}).map((c) => c.id),
  ['words', 'depth'],
);

// Progress only speaks once you've reached the section — "0%" on everything ahead is noise.
assert.ok(!headingDetailChips(by('Chapter 2'), ['progress'], { readerIdx: 0 }).length, 'silent before the section');
assert.match(headingDetailChips(by('Chapter 2'), ['progress'], { readerIdx: 450 })[0].text, /✅ 50% read/);
assert.equal(headingDetailChips(by('Chapter 2'), ['progress'], { readerIdx: 5000 })[0].text, '✅ read');
assert.match(headingDetailChips(by('Chapter 2'), ['progress'], { readerIdx: 300 })[0].text, /0% read/, 'at the very start');

// Chips that would say nothing are dropped rather than rendered empty.
assert.ok(!headingDetailChips(by('Chapter 3'), ['position'], {}).length, 'an only child has no position');
assert.ok(!headingDetailChips(by('Part I'), ['parent'], {}).length, 'no parent, no chip');
assert.ok(!headingDetailChips(by('Chapter 1'), ['children'], {}).length, 'no children, no chip');

// Nothing selected / no meta → nothing rendered.
assert.deepEqual(headingDetailChips(by('Part I'), [], {}), []);
assert.deepEqual(headingDetailChips(null, ids, {}), []);
assert.deepEqual(headingDetailChips(by('Part I'), null, {}), []);

// Catalog hygiene.
assert.equal(new Set(ids).size, ids.length, 'ids unique');
assert.ok(HEADING_DETAIL_ITEMS.every(([, label]) => /\p{Extended_Pictographic}/u.test(label)), 'labels carry their icon');

console.log('headingMeta: all cases pass');
