import assert from 'node:assert/strict';
import { COWORK_OPS, combinedAllow, opsInstruction, sanitizeOutput, planRows, buildApply, isReportOnly, schemaFor } from './coworkOps.js';

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
console.log('coworkOps: all cases pass');
