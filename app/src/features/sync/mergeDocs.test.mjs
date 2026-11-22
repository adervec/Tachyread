// node src/features/sync/mergeDocs.test.mjs — the sync merges are joins, and two devices against one
// pretend cloud keep both devices' edits and every deletion (house standard 30).
import assert from 'node:assert/strict';
import { mergeProgressDocs as P, mergeLibraryDocs as L, stableJSON } from './mergeDocs.js';

const same = (x, y, m) => assert.equal(stableJSON(x), stableJSON(y), m);
const prog = (o) => ({ app: 'tachyread-progress', version: 2, exportedAt: Date.now(), device: 'x', ...o });
const lib = (o) => ({ protocol: 'tachyread-journey', protocolVersion: 1, kind: 'library', generatedAt: Date.now(), device: 'x', books: [], ...o });

// --- join laws on a messy pair
const a = prog({
  readstate: { c1: { maskB64: btoa('\x01'), wpmB64: 'A', lifetimeActiveMs: 5, daily: [{ date: '2026-11-01', words: 10, ms: 1 }] } },
  files: { c1: { name: 'a.txt', wordIndex: 50, posUpdatedAt: 200, persistentWordsRead: 40, dailyHistory: [{ date: '2026-11-01', wordsRead: 10 }], tocReadStats: { 0: { words: 3 } } } },
  notes: { c1: [{ id: 'n1', text: 'old', updatedAt: 1 }, { id: 'n2', text: 'mine', updatedAt: 5 }] },
  bookGroups: [{ id: 'g', name: 'A', createdAt: 1, members: ['c1'] }],
  global: { settings: { fileDefaults: { wpm: 300 } }, updatedAt: 10 },
});
const b = prog({
  readstate: { c1: { maskB64: btoa('\x02\x04'), wpmB64: 'B', lifetimeActiveMs: 9, daily: [{ date: '2026-11-01', words: 7, ms: 4 }] } },
  files: { c1: { name: 'b.txt', wordIndex: 20, posUpdatedAt: 300, persistentWordsRead: 60, dailyHistory: [{ date: '2026-11-02', wordsRead: 1 }], tocReadStats: { 0: { words: 9 } } } },
  notes: { c1: [{ id: 'n1', deleted: true, updatedAt: 2 }] },
  bookGroups: [{ id: 'g', name: 'B', createdAt: 2, members: ['c2'] }],
  global: { settings: { fileDefaults: { wpm: 250 } }, updatedAt: 20 },
});
const ab = P(a, b);
same(ab, P(b, a), 'progress merge gives the same result in either order');
same(P(ab, a), ab, 'merging again changes nothing');
same(P(P(a, b), P(b, a)), ab, 'joins of joins agree');
assert.equal(atob(ab.readstate.c1.maskB64), '\x03\x04', 'read masks OR together');
assert.equal(ab.readstate.c1.daily[0].words, 10, 'a day keeps the larger count');
assert.equal(ab.files.c1.wordIndex, 20, 'the most recent position wins, even when it is behind');
assert.equal(ab.files.c1.persistentWordsRead, 60, 'counters keep the larger');
assert.equal(ab.files.c1.dailyHistory.length, 2, 'both days kept');
assert.equal(ab.files.c1.tocReadStats[0].words, 9);
assert.deepEqual(ab.notes.c1.map((n) => n.id), ['n1', 'n2']);
assert.equal(ab.notes.c1[0].deleted, true, 'a newer deletion beats the older note');
assert.deepEqual(ab.bookGroups[0].members, ['c1', 'c2']);
assert.equal(ab.bookGroups[0].name, 'B');
assert.equal(ab.global.settings.fileDefaults.wpm, 250, 'the newer settings win');
assert.ok(!('exportedAt' in ab) && !('device' in ab), 'who wrote it and when are left out');
same(P(a, null), P(a, prog({})), 'one copy alone has the merged shape');

const la = lib({ books: [{ id: 'b1', title: 'One', updatedAt: 5 }, { id: 'b2', title: 'Two', updatedAt: 5 }], authors: ['x'], stamps: { authors: 10 }, binding: { c1: 'b1' } });
const lb = lib({ books: [{ id: 'b2', deleted: true, updatedAt: 9 }, { id: 'b3', title: 'Three', updatedAt: 1 }], authors: null, genres: ['g'], stamps: { genres: 3 } });
const lab = L(la, lb);
same(lab, L(lb, la), 'library merge gives the same result in either order');
same(L(lab, la), lab, 'merging again changes nothing');
assert.deepEqual(lab.books.map((x) => x.id), ['b1', 'b2', 'b3']);
assert.equal(lab.books[1].deleted, true, 'a deleted book stays deleted');
assert.deepEqual(lab.authors, ['x'], 'a missing list never wipes a real one');
assert.deepEqual(lab.genres, ['g']);
same(L(la, null), L(la, lib({})), 'one library alone has the merged shape');

// --- two devices, one pretend cloud, the same steps font.js's syncDoc takes (read when changed, merge, write when different)
const cloud = { text: null, version: 0 };
function device(local) {
  const d = { local, cache: null, seen: { version: -1, hash: '' } };
  d.sync = () => {
    let doc = d.cache ? P(d.cache, d.local) : d.local; // load: last merged copy joined with this device's own
    if (cloud.version !== d.seen.version && cloud.text) {
      doc = P(doc, JSON.parse(cloud.text));
      d.local = P(d.local, doc); // save: what the device stores now holds the merge
    }
    d.cache = doc;
    const mine = stableJSON(doc);
    if (mine !== cloud.text) { cloud.text = mine; cloud.version++; }
    d.seen = { version: cloud.version, hash: mine };
  };
  return d;
}
const A = device(prog({ notes: { c1: [{ id: 'n1', text: 'hello', updatedAt: 1 }] } }));
const B = device(prog({}));
A.sync(); B.sync(); // both start from the same cloud copy
A.local.notes.c1 = [{ id: 'n1', deleted: true, updatedAt: 5 }]; // A deletes the note
A.local.files = { c1: { wordIndex: 100, posUpdatedAt: 50 } };
A.sync();
B.local = P(B.local, prog({ notes: { c1: [{ id: 'n9', text: 'from B', updatedAt: 6 }] }, readstate: { c2: { maskB64: btoa('\x08'), daily: [] } } })); // B, stale, edits something else
B.sync();
A.sync();
for (const [n, d] of [['A', A], ['B', B]]) {
  const doc = JSON.parse(cloud.text);
  assert.equal(stableJSON(d.cache), cloud.text, `${n} ends on the cloud copy`);
  assert.equal(doc.notes.c1.find((x) => x.id === 'n1').deleted, true, 'the deletion on A stays deleted after B syncs');
  assert.ok(doc.notes.c1.some((x) => x.id === 'n9'), 'B’s edit survives');
  assert.equal(doc.files.c1.wordIndex, 100, 'A’s edit survives');
  assert.ok(doc.readstate.c2, 'B’s reading survives');
}
const v = cloud.version; A.sync(); B.sync(); A.sync();
assert.equal(cloud.version, v, 'once in step, nobody writes again');
console.log('mergeDocs: all cases pass');
