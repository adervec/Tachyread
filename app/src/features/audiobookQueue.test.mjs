// Self-check for the audiobook command centre: queue bookkeeping, whole-queue ETA, throughput and
// the library roll-up. Pure (no clock, no IndexedDB) so it is fully deterministic.
// Run: node src/features/audiobookQueue.test.mjs
import assert from 'node:assert/strict';
import {
  JOB_KINDS, makeJob, addJob, removeJob, updateJob, moveJob, clearFinished, isFinished,
  nextQueued, runningJob, queueTotals, queueEtaSeconds, addRun, runThroughput, throughputByVoice,
  bookRows, libraryTotals,
} from './audiobookQueue.js';

// Catalog sanity.
const kinds = JOB_KINDS.map(([k]) => k);
assert.deepEqual(kinds, ['fill', 'all', 'othervoice']);
assert.ok(JOB_KINDS.every(([, label, help]) => label.length > 2 && help.length > 10));

const job = (cs, kind = 'fill', extra = {}) =>
  makeJob({ checksum: cs, fileName: cs + '.txt', kind, voiceId: 'v1', total: 10, charsTotal: 1000, ...extra });

// ── queueing ──
let q = [];
q = addJob(q, job('aaa'));
q = addJob(q, job('bbb'));
assert.equal(q.length, 2);
assert.deepEqual(q.map((j) => j.checksum), ['aaa', 'bbb'], 'FIFO order');

// The same book + same pass cannot be queued twice — it would generate every chunk twice.
q = addJob(q, job('aaa'));
assert.equal(q.length, 2, 'duplicate book+kind is refused');
// A DIFFERENT pass on the same book is legitimate.
q = addJob(q, job('aaa', 'othervoice'));
assert.equal(q.length, 3, 'a different pass on the same book is allowed');
// Ids are distinct, and stable (no clock/randomness).
assert.equal(new Set(q.map((j) => j.id)).size, 3);
assert.equal(job('aaa').id, job('aaa').id, 'the same job description yields the same id');

// "Just this chunk" jobs carry an explicit line list and do NOT dedupe — they are different work.
const one = (cs, line) => makeJob({ checksum: cs, kind: 'one', lines: [line], seq: line, total: 1, charsTotal: 50 });
let qo = addJob(addJob([], one('aaa', 4)), one('aaa', 9));
assert.equal(qo.length, 2, 'two single-chunk jobs on one book both stand');
assert.deepEqual(qo.map((j) => j.lines), [[4], [9]]);
qo = addJob(qo, one('aaa', 4));
assert.equal(qo.length, 3, 'even the same chunk again — it is an explicit re-render request');
assert.equal(makeJob({ checksum: 'a', kind: 'fill' }).lines, null, 'a whole-book pass has no line list');
assert.equal(makeJob({ checksum: 'a', kind: 'fill', lines: [] }).lines, null, 'an empty list is no list');

// A job with no checksum is not a job.
assert.equal(addJob(q, makeJob({ kind: 'fill' })).length, 3);

// ── running / finishing ──
assert.equal(nextQueued(q).checksum, 'aaa');
assert.equal(runningJob(q), null);
q = updateJob(q, q[0].id, { status: 'running', startedAt: 1000 });
assert.equal(runningJob(q).checksum, 'aaa');
assert.equal(nextQueued(q).checksum, 'bbb', 'the next queued job skips the running one');

// A running job is pinned — reordering it would make the display lie about what is synthesising.
const beforeMove = q.map((j) => j.id);
assert.deepEqual(moveJob(q, q[0].id, 1).map((j) => j.id), beforeMove, 'running job cannot be moved');
assert.deepEqual(moveJob(q, q[1].id, -1).map((j) => j.id), beforeMove, '...nor can a queued job jump over it');
// Two queued jobs BELOW the running one may still be reordered freely.
assert.deepEqual(moveJob(q, q[2].id, -1).map((j) => j.id), [q[0].id, q[2].id, q[1].id], 'queued jobs reorder among themselves');
// A queued job can be reordered among the other queued ones.
assert.deepEqual(moveJob(q, q[2].id, 0).map((j) => j.id), beforeMove, 'delta 0 is a no-op');
let q2 = [job('x'), job('y'), job('z')];
assert.deepEqual(moveJob(q2, q2[2].id, -1).map((j) => j.checksum), ['x', 'z', 'y']);
assert.deepEqual(moveJob(q2, q2[0].id, 1).map((j) => j.checksum), ['y', 'x', 'z']);
assert.deepEqual(moveJob(q2, q2[0].id, -1).map((j) => j.checksum), ['x', 'y', 'z'], 'first cannot move up');
assert.deepEqual(moveJob(q2, q2[2].id, 1).map((j) => j.checksum), ['x', 'y', 'z'], 'last cannot move down');
assert.deepEqual(moveJob(q2, 'nope', 1).map((j) => j.checksum), ['x', 'y', 'z'], 'unknown id is harmless');

// ── totals + ETA ──
let t = [
  { ...job('a'), status: 'done', total: 10, done: 10, ok: 9, failed: 1, charsTotal: 1000, charsDone: 1000 },
  { ...job('b'), status: 'running', total: 20, done: 5, charsTotal: 2000, charsDone: 500 },
  { ...job('c'), status: 'queued', total: 30, charsTotal: 3000 },
];
const tot = queueTotals(t);
assert.equal(tot.jobs, 3);
assert.equal(tot.done, 1); assert.equal(tot.running, 1); assert.equal(tot.queued, 1);
assert.equal(tot.chunks, 60); assert.equal(tot.chunksDone, 15); assert.equal(tot.failed, 1);
assert.equal(tot.charsTotal, 6000); assert.equal(tot.charsDone, 1500);
// The key one: work LEFT counts only unfinished jobs, and only their remaining characters.
assert.equal(tot.charsLeft, (2000 - 500) + 3000, 'finished work is not still "left to do"');

// ETA is the remaining characters at the measured rate — 4500 chars at 2 ms/char = 9 s.
assert.equal(queueEtaSeconds(t, 2), 9);
assert.equal(queueEtaSeconds(t, 0), null, 'no measured rate → no invented estimate');
assert.equal(queueEtaSeconds([], 2), null, 'nothing left → no estimate');
// It must fall monotonically as a run progresses (this is what the old chunk-count bar got wrong).
let prev = Infinity;
for (const doneChars of [0, 500, 1000, 1500, 2000]) {
  const eta = queueEtaSeconds([{ ...job('b'), status: 'running', charsTotal: 2000, charsDone: doneChars }], 2);
  const v = eta == null ? 0 : eta;
  assert.ok(v <= prev, `ETA must never rise (${v} after ${doneChars})`);
  prev = v;
}

// ── clearing ──
assert.ok(isFinished({ status: 'done' }) && isFinished({ status: 'error' }) && isFinished({ status: 'stopped' }));
assert.ok(!isFinished({ status: 'queued' }) && !isFinished({ status: 'running' }));
assert.deepEqual(clearFinished(t).map((j) => j.checksum), ['b', 'c']);
assert.deepEqual(removeJob(t, t[1].id).map((j) => j.checksum), ['a', 'c']);

// ── throughput ──
let runs = [];
runs = addRun(runs, { voiceLabel: 'Piper A', charsDone: 1000, ms: 10000, ok: 8, failed: 0 });
runs = addRun(runs, { voiceLabel: 'Piper A', charsDone: 3000, ms: 20000, ok: 20, failed: 1 });
runs = addRun(runs, { voiceLabel: 'Cloud B', charsDone: 2000, ms: 4000, ok: 12, failed: 0 });
const thr = runThroughput(runs);
assert.equal(thr.runs, 3);
assert.equal(thr.chars, 6000); assert.equal(thr.ms, 34000);
assert.equal(Math.round(thr.charsPerSec), 176);          // 6000 chars / 34 s
assert.ok(Math.abs(thr.msPerChar - 34000 / 6000) < 1e-9);
// Junk records are ignored rather than poisoning the rate.
assert.deepEqual(runThroughput([{ charsDone: 0, ms: 5 }, { charsDone: 5 }]), { charsPerSec: 0, ms: 0, chars: 0, runs: 0, msPerChar: 0 });
assert.deepEqual(runThroughput(null).runs, 0);

// Per-voice, because a cloud voice and an offline voice differ by an order of magnitude and a
// blended rate would mis-estimate every mixed queue.
const byV = throughputByVoice(runs);
assert.equal(byV.length, 2);
assert.equal(byV[0].voice, 'Piper A', 'ordered by characters synthesised');
assert.equal(byV[0].chars, 4000); assert.equal(byV[0].runs, 2); assert.equal(byV[0].failed, 1);
assert.equal(Math.round(byV[0].charsPerSec), 133);       // 4000 / 30 s
assert.equal(Math.round(byV[1].charsPerSec), 500);       // 2000 / 4 s
assert.ok(byV[1].charsPerSec > byV[0].charsPerSec, 'the cloud voice is measurably faster');

// The history is capped, keeping the MOST RECENT runs (a stale rate is worse than a short history).
let many = [];
for (let i = 0; i < 100; i++) many = addRun(many, { charsDone: i + 1, ms: 100 }, 10);
assert.equal(many.length, 10);
assert.equal(many[0].charsDone, 91, 'oldest dropped');
assert.equal(many[9].charsDone, 100, 'newest kept');

// ── library ──
const manifests = [
  { checksum: 'aaa', fileName: 'Alpha.txt', chunks: 4, lines: {
    0: { clips: [{ id: 'c1', source: 'tts', voiceId: 'v1', createdAt: 500, durationMs: 2000, sizeBytes: 1000 }] },
    5: { clips: [
      { id: 'c2', source: 'mic', voiceId: null, createdAt: 900, durationMs: 3000, sizeBytes: 2000 },
      { id: 'c3', source: 'tts', voiceId: 'v2', createdAt: 300, durationMs: 2500, sizeBytes: 1500 },
    ] },
  }, sections: { 0: { title: { id: 's1', durationMs: 800, sizeBytes: 400 } } } },
  // Legacy scalar-meta entry, and a book whose chunk count was never stamped.
  { checksum: 'bbb', fileName: 'Beta.txt', lines: { 3: { source: 'tts', voiceId: 'v1', createdAt: 100, durationMs: 1000, sizeBytes: 500 } } },
];
const rows = bookRows(manifests, { aaa: 'Alpha (renamed).txt' });
assert.equal(rows.length, 2);
assert.equal(rows[0].checksum, 'aaa', 'most recently touched book first');
assert.equal(rows[0].fileName, 'Alpha (renamed).txt', 'a live name overrides the stamped one');
assert.equal(rows[0].chunksWithAudio, 2);
assert.equal(rows[0].coverage, 0.5, '2 of 4 chunks');
assert.equal(rows[0].clips, 4, '3 chunk clips + 1 section title');
assert.equal(rows[0].bytes, 1000 + 2000 + 1500 + 400);
assert.equal(rows[0].durationMs, 2000 + 3000 + 2500 + 800);
assert.equal(rows[0].lastAt, 900);
assert.equal(rows[0].mic, 1); assert.equal(rows[0].tts, 2);
assert.deepEqual(rows[0].voices.map((v) => v.voice).sort(), ['v1', 'v2', 'your voice']);
// The honest part: without a stamped chunk count there is no coverage to report.
assert.equal(rows[1].coverage, null, 'unknown total → no invented percentage');
assert.equal(rows[1].chunks, 0);
assert.equal(rows[1].clips, 1, 'legacy scalar meta reads as one clip');
assert.equal(rows[1].fileName, 'Beta.txt');

const lt = libraryTotals(rows);
assert.equal(lt.books, 2);
assert.equal(lt.booksStarted, 2);
assert.equal(lt.booksComplete, 0);
assert.equal(lt.clips, 5);
assert.equal(lt.chunksWithAudio, 3);
assert.equal(libraryTotals(bookRows([{ checksum: 'z', chunks: 2, lines: { 0: { clips: [{ id: 'a', sizeBytes: 1 }] }, 1: { clips: [{ id: 'b', sizeBytes: 1 }] } } }])).booksComplete, 1, 'fully covered counts as complete');
assert.deepEqual(bookRows(null), []);
assert.equal(libraryTotals([]).books, 0);

console.log('audiobookQueue: all cases pass');
