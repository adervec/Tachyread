import assert from 'node:assert/strict';
import { planWindow, behind, cloudDiff, estMs } from './listenWindow.js';

// Two books: A half heard (3 chunks of 150 words = 1 min each), B untouched (2 chunks).
const ch = (i) => ({ startLine: i * 2, endLine: i * 2 + 1, startWordIndex: i * 150, endWordIndex: i * 150 + 149 });
const A = { cs: 'A', fileName: 'a.txt', wordIndex: 160, chunks: [ch(0), ch(1), ch(2)], clips: { 4: { ms: 50_000, bytes: 150_000 } } };
const B = { cs: 'B', fileName: 'b.txt', wordIndex: 0, chunks: [ch(0), ch(1)], clips: {} };

assert.equal(estMs(150), 60_000, '150 words ≈ a minute of narration');
const all = planWindow([A, B], { hours: 1 });
assert.deepEqual(all.map((e) => `${e.cs}/${e.startLine}`), ['A/2', 'A/4', 'B/0', 'B/2'], 'from the current chunk on, A then B (A/0 is heard)');
assert.equal(all[0].hasClip, false); assert.equal(all[1].hasClip, true); assert.equal(all[1].ms, 50_000);
assert.deepEqual(planWindow([A, B], { hours: 1.5 / 60 }).map((e) => e.startLine), [2, 4], 'window closes once 90 s of audio are in (60 s est + 50 s clip)');
assert.deepEqual(planWindow([A, B], { hours: 1, capBytes: 200_000 }).map((e) => `${e.cs}/${e.startLine}`), ['A/2'], 'byte cap: the 150 KB clip would overflow');
assert.deepEqual(planWindow([], {}), []);

assert.deepEqual(behind(A.chunks, 160), [0]);
assert.deepEqual(behind(A.chunks, 1000), [0, 2, 4]);
assert.deepEqual(behind(A.chunks, 0), []);

const cloud = { A: { chunks: { 0: { id: 'fA0' }, 4: { id: 'fA4' } } }, Z: { chunks: { 0: { id: 'fZ0' } } } };
const d = cloudDiff(all, cloud);
assert.deepEqual(d.upload.map((e) => `${e.cs}/${e.startLine}`), [], 'A/4 is already there; the rest have no clip yet');
assert.deepEqual(d.remove.map((r) => `${r.cs}/${r.startLine}:${r.id}`), ['A/0:fA0', 'Z/0:fZ0'], 'heard A/0 and a book no longer queued go');
const withClips = all.map((e) => ({ ...e, hasClip: true }));
assert.deepEqual(cloudDiff(withClips, cloud).upload.map((e) => `${e.cs}/${e.startLine}`), ['A/2', 'B/0', 'B/2']);
console.log('listenWindow: all cases pass');
