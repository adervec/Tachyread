// Self-check for download-folder sync: track signatures, the rewrite diff, and folder bookkeeping.
// Run: node src/features/audiobookSync.test.mjs
import assert from 'node:assert/strict';
import {
  trackSig, diffSync, addFolder, removeFolder, patchFolder, assignBook, unassignBook,
  setFolderBook, foldersForBook,
} from './audiobookSync.js';

// ── signatures ──
const trk = (items) => ({ items });
const c = (line, clipId) => ({ startLine: line, clipId });
assert.equal(trackSig(trk([c(0, 'a'), c(5, 'b')])), 'c:0:a,c:5:b');
assert.equal(trackSig(trk([{ kind: 'sec', role: 'intro', clipId: 'm1' }, c(0, 'a')])), 's:intro:m1,c:0:a');
assert.equal(trackSig(trk([])), '');
assert.equal(trackSig({}), '');
// A regenerated chunk (new top clip id) changes the signature; an untouched one doesn't.
assert.notEqual(trackSig(trk([c(0, 'a')])), trackSig(trk([c(0, 'a2')])));
assert.equal(trackSig(trk([c(0, 'a')])), trackSig(trk([c(0, 'a')])));

// ── diff ──
const T = [trk([c(0, 'a')]), trk([c(10, 'b')]), trk([c(20, 'x')])];
const N = ['01 One.wav', '02 Two.wav', '03 Three.wav'];
// First sync: everything is new.
let d = diffSync(T, N, {});
assert.deepEqual(d.write, [0, 1, 2]);
assert.deepEqual(d.remove, []);
assert.equal(Object.keys(d.next).length, 3);
// Nothing changed: nothing written, nothing removed.
d = diffSync(T, N, d.next);
assert.deepEqual(d.write, []);
assert.deepEqual(d.remove, []);
// One chunk regenerated → exactly that track rewritten.
const prev = diffSync(T, N, {}).next;
const T2 = [T[0], trk([c(10, 'b9')]), T[2]];
d = diffSync(T2, N, prev);
assert.deepEqual(d.write, [1], 'only the track holding the regenerated chunk is rewritten');
assert.deepEqual(d.remove, []);
// A track disappears from the plan (chapter merged / clips deleted) → its stale file is removed.
d = diffSync(T2.slice(0, 2), N.slice(0, 2), prev);
assert.deepEqual(d.remove, ['03 Three.wav']);
// A rename shows up as write-new + remove-old — never a silent orphan.
d = diffSync(T, ['01 Renamed.wav', N[1], N[2]], prev);
assert.deepEqual(d.write, [0]);
assert.deepEqual(d.remove, ['01 One.wav']);

// ── folder bookkeeping ──
let fs = [];
fs = addFolder(fs, { id: 'f1', name: 'Phone', handle: { fake: true } });
fs = addFolder(fs, { id: 'f2', name: 'NAS', autoSync: false });
assert.equal(fs.length, 2);
assert.equal(fs[0].autoSync, true, 'auto-sync defaults ON');
assert.equal(fs[1].autoSync, false, 'an explicit flag is kept');
assert.deepEqual(fs[0].books, {});
fs = addFolder(fs, { id: 'f1', name: 'dupe' });
assert.equal(fs.length, 2, 'same id is refused');
assert.equal(addFolder(fs, {}).length, 2, 'no id, no folder');

fs = assignBook(fs, 'f1', 'aaa', 'Alpha.txt');
fs = assignBook(fs, 'f1', 'bbb', 'Beta.txt');
fs = assignBook(fs, 'f2', 'aaa', 'Alpha.txt');
assert.deepEqual(Object.keys(fs[0].books), ['aaa', 'bbb']);
const before = fs;
fs = assignBook(fs, 'f1', 'aaa', 'Alpha.txt');
assert.deepEqual(fs[0].books, before[0].books, 're-assigning is a no-op that keeps sync state');
assert.equal(assignBook(fs, 'f1', null, 'x')[0], fs[0], 'no checksum, no assignment');

// A book's folders — and only auto-sync ones when asked (that is the generation hook's filter).
assert.deepEqual(foldersForBook(fs, 'aaa').map((f) => f.id), ['f1', 'f2']);
assert.deepEqual(foldersForBook(fs, 'aaa', { auto: true }).map((f) => f.id), ['f1']);
assert.deepEqual(foldersForBook(fs, 'zzz'), []);
assert.deepEqual(foldersForBook(null, 'aaa'), []);

// Sync-state stamping keeps other folders' records for the same book intact.
fs = setFolderBook(fs, 'f1', 'aaa', { fileName: 'Alpha.txt', tracks: { '01 A.mp3': 'c:0:a' }, format: 'mp3', syncedAt: 5 });
assert.equal(fs[0].books.aaa.syncedAt, 5);
assert.equal(fs[1].books.aaa.syncedAt, 0, 'the other folder is untouched');

fs = unassignBook(fs, 'f1', 'aaa');
assert.deepEqual(Object.keys(fs[0].books), ['bbb']);
assert.ok(fs[1].books.aaa, 'unassigning from one folder leaves the other');
assert.deepEqual(unassignBook(fs, 'f1', 'zzz'), fs, 'unknown book is a no-op');

fs = patchFolder(fs, 'f2', { autoSync: true });
assert.equal(fs[1].autoSync, true);
fs = removeFolder(fs, 'f1');
assert.deepEqual(fs.map((f) => f.id), ['f2']);

console.log('audiobookSync: all cases pass');
