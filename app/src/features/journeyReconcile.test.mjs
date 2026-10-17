// Quick-added ↔ recommendation pairing and the non-lossy merge (journeyCleanup.js).
import assert from 'node:assert/strict';
import { findQuickAddPairs, mergeQuickInto, bookDiff, isQuickAdd } from './journeyCleanup.js';

const rec = { id: 'isbn:1', title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719', coverId: 5, pages: 600, recBy: 'Claude', shelf: 'queue', notes: 'Classic.' };
const quick = { id: 'bk:dune-frank-herbert', title: 'Dune - Frank Herbert (1965)', recBy: '', words: 188000, pages: 684, inProgress: true, startTime: '2026-09-01', notes: 'Loving it' };
const other = { id: 'bk:x', title: 'Dune Messiah', author: 'Frank Herbert' };
const onlyTitle = { id: 'bk:emma', title: 'Emma', author: 'Jane Austen' };
const emmaQuick = { id: 'bk:emma-file', title: 'emma', recBy: '' };
const weakQuick = { id: 'bk:it', title: 'It Happened', recBy: '' }; // matches no recommendation → no pair
const bind = { csDune: quick.id, csEmma: emmaQuick.id, csW: weakQuick.id };

assert.ok(isQuickAdd(quick, new Set(Object.values(bind))));
assert.ok(!isQuickAdd(rec, new Set(Object.values(bind))), 'has an author → not a quick add');
const pairs = findQuickAddPairs([rec, quick, other, onlyTitle, emmaQuick, weakQuick], bind);
assert.deepEqual(pairs.map((p) => [p.quick.id, p.keep.id]), [[quick.id, rec.id], [emmaQuick.id, onlyTitle.id]]);
assert.equal(pairs[0].authorHit, true);
// "Dune Messiah" is NOT matched to a "Dune" file: its title has a word the file name lacks.
assert.ok(!pairs.some((p) => p.keep.id === other.id));
// Unlinked quick-looking entries are ignored (nothing to reconcile with a file).
assert.equal(findQuickAddPairs([rec, quick], {}).length, 0);

// Merge: keeper metadata wins, reading state + real words come across, notes both kept, snapshot stored.
const m = mergeQuickInto(rec, quick, Date.parse('2026-10-17T00:00:00Z'));
assert.equal(m.id, rec.id);
assert.equal(m.title, 'Dune');
assert.equal(m.author, 'Frank Herbert');
assert.equal(m.pages, 600, 'keeper pages kept');
assert.equal(m.words, 188000, 'real word count from the file');
assert.equal(m.inProgress, true);
assert.equal(m.startTime, '2026-09-01');
assert.equal(m.shelf, undefined, 'On-deck shelf no longer masks that it is being read');
assert.equal(m.notes, 'Classic.\n\nLoving it');
assert.deepEqual(m.mergedFrom, [{ at: '2026-10-17T00:00:00.000Z', record: quick }]);
const diff = bookDiff(rec, m).map((d) => d.key).sort();
assert.deepEqual(diff, ['inProgress', 'notes', 'shelf', 'startTime', 'words']);
console.log('journeyReconcile: all cases pass');
