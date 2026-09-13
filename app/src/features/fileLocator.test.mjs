// Self-check for the missing-file search: name matching, and the budgeted breadth-first walk.
// Run: node src/features/fileLocator.test.mjs
import assert from 'node:assert/strict';
import { nameScore, stem, findFileIn } from './fileLocator.js';

// ── name matching ──
assert.equal(nameScore('Great Expectations.epub', 'Great Expectations.epub'), 2, 'same name');
assert.equal(nameScore('Great Expectations.epub', 'great expectations.EPUB'), 2, 'case does not matter');
assert.equal(nameScore('Émile.txt', 'Emile.txt'), 2, 'accents folded');
assert.equal(nameScore('Great Expectations.epub', 'Great Expectations.txt'), 1, 'same book, another format');
assert.equal(nameScore('Great Expectations.epub', 'Great Expectations (1861).epub'), 0, 'a near name is NOT a match');
assert.equal(nameScore('Great Expectations.epub', 'Expectations.epub'), 0, 'nor is a partial one');
assert.equal(nameScore('', 'x.txt'), 0);
assert.equal(nameScore('x.txt', ''), 0);
assert.equal(stem('A Book.epub'), 'a book');
assert.equal(stem('archive.tar.gz'), 'archive.tar', 'only the last extension comes off');

// ── a fake directory tree: { name: null } is a file, a nested object is a folder ──
const dirOf = (tree, name = 'root') => ({
  kind: 'directory',
  name,
  async *entries() {
    for (const [k, v] of Object.entries(tree)) yield [k, v === null ? { kind: 'file', name: k } : dirOf(v, k)];
  },
});

const tree = {
  'notes.txt': null,
  Books: { 'Great Expectations.epub': null, Old: { 'Great Expectations.txt': null } },
  Archive: { Deep: { Deeper: { Deepest: { 'Great Expectations.epub': null } } } },
};
let hit = await findFileIn(dirOf(tree), 'Great Expectations.epub');
assert.equal(hit.score, 2);
assert.equal(hit.dir.name, 'Books', 'the shallow exact copy wins over the buried one');

// A re-format is found when there is no exact copy, but only after the whole level is searched.
hit = await findFileIn(dirOf({ Books: { 'Great Expectations.txt': null, 'Great Expectations.epub': null } }), 'Great Expectations.epub');
assert.equal(hit.score, 2, 'the exact format still wins inside one folder');
hit = await findFileIn(dirOf({ Books: { 'Great Expectations.txt': null } }), 'Great Expectations.epub');
assert.equal(hit.score, 1, 'falls back to the other format');

// Depth and budget keep a badly chosen folder from hanging the app.
assert.equal(await findFileIn(dirOf(tree), 'Great Expectations.epub', { maxDepth: 0 }), null, 'depth 0 searches only the top folder');
assert.equal((await findFileIn(dirOf({ A: { B: { C: { 'x.txt': null } } } }), 'x.txt', { maxDepth: 2 })), null, 'too deep to reach');
assert.equal((await findFileIn(dirOf({ A: { B: { 'x.txt': null } } }), 'x.txt', { maxDepth: 2 })).score, 2, 'just deep enough');
const wide = {}; for (let i = 0; i < 500; i++) wide[`f${i}.txt`] = null;
const capped = await findFileIn(dirOf({ ...wide, 'x.txt': null }), 'x.txt', { budget: 10 });
assert.equal(capped, null, 'the budget stops the scan');
assert.ok((await findFileIn(dirOf(wide), 'f499.txt')).scanned <= 501, 'scanned count is reported');

// Hidden folders are skipped, and a folder that throws does not sink the search.
assert.equal(await findFileIn(dirOf({ '.git': { 'x.txt': null } }), 'x.txt'), null, 'dot-folders are left alone');
const angry = { kind: 'directory', name: 'root', async *entries() { yield ['bad', { kind: 'directory', name: 'bad', entries() { throw new Error('nope'); } }]; yield ['x.txt', { kind: 'file', name: 'x.txt' }]; } };
assert.equal((await findFileIn(angry, 'x.txt')).score, 2, 'an unreadable folder is skipped, the rest still searched');
assert.equal(await findFileIn(dirOf({}), 'x.txt'), null, 'empty folder');

console.log('fileLocator: all cases pass');
