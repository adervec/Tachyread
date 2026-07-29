// ponytail: the folder-scan classifier — format detection + new-vs-already-added + filter selection.
// Run: node src/features/bulkAdd.test.mjs
import assert from 'node:assert';
import { fileExt, planBulkAdd, extCounts, selectableRows, SUPPORTED_EXTS } from './bulkAdd.js';

assert.equal(fileExt('Lore.Volume.II.epub'), 'epub', 'extension is the last dotted segment, lowercased');
assert.equal(fileExt('NOEXT'), '', 'no extension → empty');

const folder = [
  { name: 'lore-a.epub', size: 10 },
  { name: 'lore-b.epub', size: 20 },
  { name: 'lore-c.pdf', size: 30 },
  { name: 'already.epub', size: 40 },   // already added
  { name: 'notes.rtf', size: 50 },      // unsupported format
  { name: 'cover.png', size: 60 },      // unsupported
];
const known = new Set(['Already.EPUB']); // case-insensitive match
const items = planBulkAdd(folder, { knownNames: known });

assert.equal(items.find((i) => i.name === 'notes.rtf').supported, false, 'rtf is unsupported');
assert.equal(items.find((i) => i.name === 'lore-a.epub').supported, true, 'epub is supported');
assert.equal(items.find((i) => i.name === 'already.epub').isNew, false, 'a known name (any case) is not new');
assert.equal(items.find((i) => i.name === 'lore-a.epub').isNew, true, 'an unseen name is new');

assert.deepEqual(extCounts(items), { epub: 3, pdf: 1 }, 'counts only supported files, by extension');

// Default: only NEW files, all supported formats → the two new epubs + the pdf (not the known epub).
let sel = selectableRows(items, { onlyNew: true });
assert.deepEqual(sel.map((r) => r.name).sort(), ['lore-a.epub', 'lore-b.epub', 'lore-c.pdf'], 'new + supported');

// Filter to just epub.
const epubOnly = planBulkAdd(folder, { knownNames: known, formats: ['epub'] });
sel = selectableRows(epubOnly, { onlyNew: true });
assert.deepEqual(sel.map((r) => r.name).sort(), ['lore-a.epub', 'lore-b.epub'], 'format filter narrows to epub, new only');

// Include already-added too (onlyNew off) → all three epubs.
sel = selectableRows(epubOnly, { onlyNew: false });
assert.equal(sel.length, 3, 'onlyNew off re-includes the already-added epub');

assert.ok(SUPPORTED_EXTS.includes('docx') && SUPPORTED_EXTS.includes('md'), 'supported set covers the reader formats');
// defensive: null/garbage entries must not throw (descs come from a FileList, but harden anyway)
assert.doesNotThrow(() => planBulkAdd([null, undefined, { name: null }, { name: 'ok.txt' }]), 'null descs tolerated');
assert.equal(planBulkAdd([null, { name: 'ok.txt' }]).length, 2, 'null desc → a row with empty ext, no crash');
assert.doesNotThrow(() => planBulkAdd([{ name: 'a.txt' }], { formats: [null, 5, 'TXT'] }), 'non-string formats tolerated');
assert.deepEqual(extCounts([null, { supported: true, ext: 'txt' }]), { txt: 1 }, 'extCounts skips null entries');
assert.deepEqual(selectableRows([null, undefined]), [], 'selectableRows skips null entries');

console.log('bulkAdd: all cases pass');
