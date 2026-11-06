import assert from 'node:assert/strict';
import { notesMarkdown, readwisePayload } from './notesExport.js';

const items = [
  { book: 'Dune', author: 'Herbert', quote: 'Fear is the mind-killer.', text: 'Litany!', wordIndex: 900, createdAt: Date.UTC(2026, 10, 1) },
  { book: 'Dune', quote: 'I must not fear.', wordIndex: 880 },
  { book: 'Emma', text: 'A plain note', section: { title: 'Chapter 2' }, wordIndex: null },
  { book: 'Emma' }, // empty: skipped
];
const md = notesMarkdown(items, { date: new Date(Date.UTC(2026, 10, 6)) });
assert.ok(md.startsWith('# Tachyread notes & highlights\n\n_Exported 2026-11-06_'));
assert.ok(md.includes('## Dune — Herbert'));
assert.ok(md.indexOf('I must not fear') < md.indexOf('Fear is the mind-killer'), 'sorted by position in the book');
assert.ok(md.includes('> Fear is the mind-killer.\n\nLitany!'));
assert.ok(md.includes('<sub>word 901</sub>'));
assert.ok(md.includes('A plain note\n<sub>§ Chapter 2</sub>'));
assert.ok(md.indexOf('## Dune') < md.indexOf('## Emma'));

const p = readwisePayload(items);
assert.equal(p.highlights.length, 3, 'empty item dropped');
assert.deepEqual(p.highlights[0], { text: 'Fear is the mind-killer.', title: 'Dune', author: 'Herbert', note: 'Litany!', location: 901, location_type: 'order', highlighted_at: '2026-11-01T00:00:00.000Z', source_type: 'tachyread', category: 'books' });
assert.equal(p.highlights[2].text, 'A plain note', 'plain note goes up as text');
assert.equal(p.highlights[2].note, undefined);
console.log('notesExport: all cases pass');
