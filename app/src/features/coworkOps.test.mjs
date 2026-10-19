import assert from 'node:assert/strict';
import { COWORK_OPS, combinedAllow, opsInstruction, sanitizeOutput, planRows, buildApply, isReportOnly, schemaFor, queuesForDataset } from './coworkOps.js';

const books = {
  a: { id: 'a', title: 'Alpha', author: 'X', genre: '', recScore: 5 },                    // to-read, no genre
  b: { id: 'b', title: 'Beta', author: 'Y', genre: 'SF', completion: true, recScore: 7 },  // finished
  c: { id: 'c', title: 'Gamma', author: 'Z', recScore: 4 },                                // to-read, queued
};
const ctx = { booksById: books, bindMap: { csLinked: 'b' }, queuedIds: new Set(['c']) };

// Permissions merge per operation; the schema lists only what they allow.
assert.deepEqual(Object.keys(combinedAllow(['cw-fill-genre']).fields), ['genre', 'subgenre']);
assert.ok(!schemaFor(['cw-brief']).includes('bookPatches'));
assert.ok(isReportOnly(['cw-brief', 'cw-light']) && !isReportOnly(['cw-brief', 'cw-rescore']));
const ins = opsInstruction(['cw-brief', 'cw-fill-genre', 'nope']);
assert.deepEqual([ins.mode, ins.ops], ['heavy', ['cw-brief', 'cw-fill-genre']]);

// A reply that oversteps: only the allowed, blank, unqueued-unread parts survive.
const reply = {
  analysis: 'sneaky', brief: { date: '2026-10-19', text: 'Good morning' },
  bookPatches: [
    { id: 'a', genre: 'Fantasy', recScore: 9, title: 'Renamed!' },
    { id: 'b', genre: 'Romance', recScore: 1 },
    { id: 'c', recScore: 8 },
    { id: 'zzz', genre: 'x' },
  ],
  bindings: [{ checksum: 'csLinked', bookId: 'a' }, { checksum: 'csFree', bookId: 'a' }],
  aiNotes: [{ bookId: 'a', type: 'summary', text: 'n' }],
};
const { output, dropped } = sanitizeOutput(reply, ['cw-brief', 'cw-fill-genre', 'cw-rescore'], ctx);
assert.deepEqual(output.bookPatches, [{ id: 'a', genre: 'Fantasy', recScore: 9 }]);
assert.equal(output.analysis, undefined, 'analysis not requested → dropped');
assert.equal(output.bindings, undefined, 'links not requested → dropped');
assert.equal(output.aiNotes, undefined);
assert.ok(output.brief);
const why = Object.fromEntries(dropped.map((d) => [d.what, d.why]));
assert.match(why['Alpha: title'], /not allowed/);
assert.match(why['Beta: genre'], /already has a value/);
assert.match(why['Beta: recScore'], /not an unqueued to-read/);
assert.match(why['Gamma: recScore'], /not an unqueued to-read/, 'queued books are left alone');

// Links: only files with no link.
const links = sanitizeOutput({ bindings: reply.bindings }, ['cw-links'], ctx);
assert.deepEqual(links.output.bindings, [{ checksum: 'csFree', bookId: 'a' }]);

// Rows → apply → undo snapshot holds the originals.
const rows = planRows(output, { booksById: books });
assert.deepEqual(rows.map((r) => r.key), ['brief', 'f:a:genre', 'f:a:recScore']);
const picked = rows.filter((r) => r.key !== 'f:a:recScore'); // user unticks the score
const ap = buildApply(picked, { booksById: books, ai: { briefs: {} }, now: Date.parse('2026-10-19T08:00:00Z') });
assert.deepEqual(ap.bookUpdates, [{ ...books.a, genre: 'Fantasy' }]);
assert.deepEqual(ap.undo.books, [books.a]);
assert.equal(ap.aiNext.briefs['2026-10-19'].text, 'Good morning');
assert.deepEqual(ap.undo.ai, { briefs: {} });
// Every op has the three explanation parts.
for (const [id, op] of Object.entries(COWORK_OPS)) assert.ok(op.explain.sends && op.explain.changes && op.explain.review, id);

// Ask a question: dropped without a question; the question lands in the instruction; answer only.
assert.equal(opsInstruction(['cw-ask']), null);
assert.match(opsInstruction(['cw-ask'], { question: 'Am I faster?' }).text, /Am I faster\?/);
const ans = sanitizeOutput({ answer: 'Yes', bookPatches: [{ id: 'a', genre: 'x' }] }, ['cw-ask'], ctx);
assert.deepEqual(Object.keys(ans.output), ['answer']);

// Difficulty: blanks only, whole numbers 1–5.
const diff = sanitizeOutput({ bookPatches: [{ id: 'a', difficultyLevel: 3 }, { id: 'c', difficultyLevel: 9 }] }, ['cw-fill-diff'], ctx);
assert.deepEqual(diff.output.bookPatches, [{ id: 'a', difficultyLevel: 3 }]);
assert.match(diff.dropped[0].why, /whole number 1–5/);

// Queue advice: only an exact permutation of the queue's own books; reorders apply via buildApply.
const queues = [{ id: 'q1', name: 'Now', ids: ['a', 'b', 'c'] }];
const qa = sanitizeOutput({ queueOrder: [
  { queueId: 'q1', ids: ['c', 'a', 'b'], why: 'momentum' },
  { queueId: 'q1', ids: ['c', 'a'], why: 'dropped one' },
  { queueId: 'q1', ids: ['a', 'b', 'c', 'zzz'] },
  { queueId: 'nope', ids: [] },
] }, ['cw-queue-advice'], { ...ctx, queues });
assert.deepEqual(qa.output.queueOrder.map((q) => q.ids), [['c', 'a', 'b']]);
assert.equal(qa.dropped.length, 3);
const qrows = planRows(qa.output, { booksById: books });
assert.equal(qrows[0].kind, 'queueOrder');
assert.deepEqual(buildApply(qrows, { booksById: books }).queueOrders, [{ queueId: 'q1', ids: ['c', 'a', 'b'] }]);
assert.deepEqual(queuesForDataset(queues, Object.values(books))[0].books.map((b) => b.id), ['a', 'b', 'c']);

// Duplicates: stored as suggestions only (no book touched).
const du = sanitizeOutput({ duplicates: [{ keepId: 'a', foldId: 'c', why: 'same' }, { keepId: 'a', foldId: 'a' }] }, ['cw-dupes'], ctx);
assert.equal(du.output.duplicates.length, 1);
const dap = buildApply(planRows(du.output, { booksById: books }), { booksById: books, ai: {}, now: 5 });
assert.deepEqual([dap.bookUpdates.length, dap.aiNext.dupeSuggestions], [0, [{ keepId: 'a', foldId: 'c', why: 'same', at: 5 }]]);

// Locked books: no operation may touch them.
const lockedBooks = { ...books, a: { ...books.a, locked: true } };
const lk = sanitizeOutput({ bookPatches: [{ id: 'a', genre: 'X' }], aiNotes: [{ bookId: 'a', text: 'n' }], duplicates: [{ keepId: 'a', foldId: 'c' }] }, ['cw-fill-genre', 'cw-notes', 'cw-dupes'], { ...ctx, booksById: lockedBooks });
assert.equal(lk.output.bookPatches, undefined);
assert.deepEqual(lk.output.aiNotes, []);
assert.deepEqual(lk.output.duplicates, []);
assert.ok(lk.dropped.every((d) => /locked/.test(d.why)));

// Reports: only the kinds the requested ops produce; stored newest first.
const rp = sanitizeOutput({ reports: [{ kind: 'typing', title: 'T', text: 'x' }, { kind: 'retro', title: 'R', text: 'y' }] }, ['cw-typing-coach'], ctx);
assert.deepEqual(rp.output.reports.map((r) => r.kind), ['typing']);
const rap = buildApply(planRows(rp.output, { booksById: books }), { booksById: books, ai: { reports: [{ at: 1, kind: 'old' }] }, now: 9 });
assert.deepEqual(rap.aiNext.reports.map((r) => r.kind), ['typing', 'old']);

// New books: only books not already in the library, with an author; created as to-read, undo lists them.
const nbs = sanitizeOutput({ newBooks: [{ title: 'Alpha', author: 'X' }, { title: 'Delta', author: 'Q', why: 'fits' }, { title: 'No Author' }, { title: 'delta', author: 'Q' }] }, ['cw-add-recs'], ctx);
assert.deepEqual(nbs.output.newBooks.map((b) => b.title), ['Delta']);
const nap = buildApply(planRows(nbs.output, { booksById: books }), { booksById: books, ai: {}, now: 9 });
assert.equal(nap.bookUpdates.length, 1);
assert.deepEqual([nap.bookUpdates[0].title, nap.bookUpdates[0].recBy, nap.bookUpdates[0].completion, nap.undo.created.length], ['Delta', 'Cowork agent', false, 1]);
console.log('coworkOps: all cases pass');
