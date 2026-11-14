import assert from 'node:assert/strict';
import { logRequest, opsForReply, COWORK_OPS, combinedAllow, opsInstruction, sanitizeOutput, planRows, buildApply, isReportOnly, schemaFor, queuesForDataset, opForRow, opForReport, rememberRequeues } from './coworkOps.js';

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
assert.deepEqual(ap.bookUpdates, [{ ...books.a, genre: 'Fantasy', aiSet: { genre: { at: Date.parse('2026-10-19T08:00:00Z'), by: 'cowork' } } }], 'the field change carries its provenance');
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

// Tags: add only, skipping ones the book has (case-insensitive), max 5 new.
const tagged = { ...books, a: { ...books.a, tags: 'Space, war' } };
const tg = sanitizeOutput({ addTags: [{ id: 'a', tags: ['space', 'Desert', 'ecology', 'politics', 'religion', 'family', 'extra'] }] }, ['cw-tags'], { ...ctx, booksById: tagged });
assert.deepEqual(tg.output.addTags, [{ id: 'a', tags: ['Desert', 'ecology', 'politics', 'religion', 'family'] }]);
const tap = buildApply(planRows(tg.output, { booksById: tagged }), { booksById: tagged, now: 3, source: 'cw-tags' });
assert.deepEqual(tap.bookUpdates[0].tags, ['Space', 'war', 'Desert', 'ecology', 'politics', 'religion', 'family']);
assert.equal(tap.bookUpdates[0].aiSet.tags.by, 'cw-tags');

// Vocabulary: single words not already in the deck.
const vc = sanitizeOutput({ vocabCards: [{ word: 'sesquipedalian', context: 'long words' }, { word: 'Petrichor' }, { word: 'two words' }, { word: 'petrichor' }] }, ['cw-vocab'], { ...ctx, vocabWords: ['Petrichor'] });
assert.deepEqual(vc.output.vocabCards.map((c) => c.word), ['sesquipedalian']);
// Typing plan: only known drills and sane numbers.
const tp = sanitizeOutput({ typingPlan: { name: 'Fix e', steps: [{ mode: 'homeRow', runMode: 'seconds', runLimit: 60, sets: 2 }, { mode: 'hack', runMode: 'seconds', runLimit: 60 }, { mode: 'homeRow', runMode: 'seconds', runLimit: 9999 }] } }, ['cw-typing-plan'], ctx);
assert.deepEqual(tp.output.typingPlan.steps.map((st) => st.mode), ['homeRow']);
assert.equal(buildApply(planRows(tp.output, { booksById: books }), { booksById: books }).planAdds.length, 1);
// Renames: one row per affected (unlocked) book, only for the allowed field.
const rnBooks = { x: { id: 'x', title: 'X', genre: 'Sci-Fi' }, y: { id: 'y', title: 'Y', genre: 'Sci-Fi', locked: true }, z: { id: 'z', title: 'Z', genre: 'History', author: 'Tolkien' } };
const rn = sanitizeOutput({ renames: [{ field: 'genre', from: 'Sci-Fi', to: 'Science fiction' }, { field: 'author', from: 'Tolkien', to: 'J.R.R. Tolkien' }, { field: 'genre', from: 'Nope', to: 'X' }] }, ['cw-genre-merge'], { booksById: rnBooks });
assert.deepEqual(rn.output.renames.map((r) => r.field), ['genre']);
assert.deepEqual(planRows(rn.output, { booksById: rnBooks }).map((r) => [r.bookId, r.from, r.to]), [['x', 'Sci-Fi', 'Science fiction']], 'the locked book is skipped');
// Goal advice: plausible integers, current → proposed rows.
const ga = sanitizeOutput({ goalAdvice: { books: 30, words: 5, why: 'pace' } }, ['cw-goal-advice'], ctx);
assert.deepEqual(ga.output.goalAdvice, { books: 30, why: 'pace' });
const grows = planRows(ga.output, { booksById: books, goals: { 2026: 24 }, year: 2026 });
assert.deepEqual(grows.map((r) => [r.from, r.to]), [[24, 30]]);
assert.deepEqual(buildApply(grows, { booksById: books }).goalSets, [{ key: '2026', n: 30 }]);

// Matching replies to requests: by echoed hash, else every recent request (a newer scheduled request
// must not narrow the permissions for the reply to an earlier full sync).
let al = logRequest({}, { hash: 'full', ops: ['cw-brief', 'cw-fill-genre', 'cw-classify'], at: 1000 });
al = logRequest(al, { hash: 'sched', ops: ['cw-classify'], at: 2000, auto: true });
assert.deepEqual(opsForReply({ requestHash: 'full' }, al, { now: 3000 }).ops, ['cw-brief', 'cw-fill-genre', 'cw-classify']);
const noHash = opsForReply({}, al, { now: 3000 });
assert.deepEqual([noHash.how, noHash.ops.sort()], ['recent', ['cw-brief', 'cw-classify', 'cw-fill-genre']]);
assert.equal(opsForReply({}, al, { now: 1000 + 5 * 86400000 }).how, 'last');

// Per-subtask view: a review row belongs to the first requested operation whose permission covers it.
assert.equal(opForRow({ kind: 'field', field: 'genre' }, ['cw-tags', 'cw-fill-genre']), 'cw-fill-genre');
assert.equal(opForRow({ kind: 'field', field: 'genre', rename: true }, ['cw-fill-genre', 'cw-genre-merge']), 'cw-genre-merge', 'a rename row goes to the merge op, not the blank-filler');
assert.ok(planRows(rn.output, { booksById: rnBooks }).every((r) => r.rename === true), 'rename rows are marked');
assert.equal(opForRow({ kind: 'report', value: { kind: 'typing' } }, ['cw-retro', 'cw-typing-coach']), 'cw-typing-coach');
assert.equal(opForRow({ kind: 'tags' }, ['cw-fill-genre']), null, 'nothing requested covers it');
assert.equal(opForRow({ kind: 'treeMeta' }, ['cw-graph', 'cw-tree']), 'cw-graph', 'first requested wins a shared permission');
assert.equal(opForReport('health'), 'cw-health');
assert.equal(opForReport('nope'), null);

// Dynamic queues: only unqueued to-read books, only into queues with a description, once each.
const qs = [{ id: 'q1', name: 'Lit', dynamic: 'American literature', prep: ['reception'], ids: ['c'] }, { id: 'q2', name: 'Phil', ids: [] }, { id: 'q3', name: 'Gone', deleted: true, ids: [] }];
const qctx = { ...ctx, queues: qs };
const qadd = sanitizeOutput({ queueAdds: [{ queueId: 'q1', ids: ['a', 'c', 'b', 'a', 'zzz'], why: 'fits' }, { queueId: 'q2', ids: ['a'] }, { queueId: 'q3', ids: ['a'] }] }, ['cw-queue-fill'], qctx);
assert.deepEqual(qadd.output.queueAdds, [{ queueId: 'q1', bookId: 'a', why: 'fits' }]);
const qaw = Object.fromEntries(qadd.dropped.map((d) => [d.what, d.why]));
assert.match(qaw['additions to “Phil”'], /not dynamic/);
assert.match(qaw['add Gamma to “Lit”'], /already in a queue/);
assert.match(qaw['add Beta to “Lit”'], /not a to-read/);
const qar = planRows(qadd.output, { booksById: books, queues: qs });
assert.deepEqual([qar[0].kind, qar[0].from, qar[0].to], ['queueAdd', '(no queue)', 'Lit']);
assert.deepEqual(buildApply(qar, { booksById: books }).queueAdds, [{ queueId: 'q1', bookId: 'a' }]);
assert.equal(opForRow(qar[0], ['cw-queue-advice', 'cw-queue-fill']), 'cw-queue-fill');
// Re-queue: a queued to-read book to another live queue — and never a pair reviewed before.
const qm = sanitizeOutput({ queueMoves: [{ bookId: 'c', toQueueId: 'q2', why: 'philosophy' }, { bookId: 'c', toQueueId: 'q1' }, { bookId: 'a', toQueueId: 'q2' }, { bookId: 'c', toQueueId: 'q3' }] }, ['cw-requeue'], qctx);
assert.deepEqual(qm.output.queueMoves, [{ bookId: 'c', toQueueId: 'q2', why: 'philosophy' }]);
const qmr = planRows(qm.output, { booksById: books, queues: qs });
assert.deepEqual([qmr[0].kind, qmr[0].from, qmr[0].to], ['queueMove', 'Lit', 'Phil']);
assert.deepEqual(buildApply(qmr, { booksById: books }).queueAdds, [{ queueId: 'q2', bookId: 'c' }], 'a move is an add elsewhere (addToQueue moves)');
const remembered = rememberRequeues({}, qmr, 5);
assert.deepEqual(remembered.requeueSkip, [{ bookId: 'c', toQueueId: 'q2', at: 5 }]);
assert.equal(sanitizeOutput({ queueMoves: [{ bookId: 'c', toQueueId: 'q2' }] }, ['cw-requeue'], { ...qctx, requeueSkip: remembered.requeueSkip }).output.queueMoves.length, 0, 'reviewed once → never suggested again');
assert.equal(rememberRequeues({ x: 1 }, qar).x, 1, 'nothing to remember → record untouched');
// Prep notes: only the types a queue asks for, on its unread books, once; the unrestricted notes op wins.
const noted = { ...books, c: { ...books.c, aiNotes: [{ type: 'guide', text: 'g' }] } };
const pn = sanitizeOutput({ aiNotes: [{ bookId: 'c', type: 'reception', text: 'r' }, { bookId: 'c', type: 'guide', text: 'g2' }, { bookId: 'c', type: 'summary', text: 's' }, { bookId: 'a', type: 'reception', text: 'x' }] }, ['cw-queue-prep'], { ...qctx, booksById: noted });
assert.deepEqual(pn.output.aiNotes.map((n) => n.type), ['reception']);
assert.equal(buildApply(planRows(pn.output, { booksById: noted }), { booksById: noted }).bookUpdates[0].aiNotes.at(-1).type, 'reception', 'a known note type, not "other"');
assert.equal(combinedAllow(['cw-queue-prep']).aiNotes, 'prep');
assert.equal(combinedAllow(['cw-queue-prep', 'cw-notes']).aiNotes, true);
assert.equal(sanitizeOutput({ aiNotes: [{ bookId: 'c', type: 'summary', text: 's' }] }, ['cw-queue-prep', 'cw-notes'], { ...qctx, booksById: noted }).output.aiNotes.length, 1);
const qds = queuesForDataset(qs, Object.values(noted));
assert.deepEqual([qds[0].dynamic, qds[0].prep, qds[0].books[0].notes, qds[1].dynamic], ['American literature', ['reception'], ['guide'], null]);
console.log('coworkOps: all cases pass');

// ── review first (house standard): on by default, off only per REPORT operation ──
{
  const { reviewFirst, parkReply, unparkReply, COWORK_MANIFEST } = await import('./coworkOps.js');
  assert.equal(reviewFirst({}, ['cw-light']), true, 'review is on by default');
  assert.equal(reviewFirst({ autoApply: { 'cw-light': true } }, ['cw-light']), false, 'switched off for this report op');
  assert.equal(reviewFirst({ autoApply: { 'cw-light': false } }, ['cw-light']), true);
  assert.equal(reviewFirst({ autoApply: { 'cw-queue-fill': true } }, ['cw-queue-fill']), true, 'book-changing ops always review');
  assert.equal(reviewFirst({ autoApply: { 'cw-light': true } }, ['cw-light', 'cw-queue-fill']), true, 'a mixed request reviews');
  const parked = parkReply({ ledger: ['old'] }, { text: '{}', ops: ['cw-light'], source: 's', hash: 'h1' }, 5);
  assert.equal(parked.pendingReplies.length, 1);
  assert.equal(parkReply(parked, { text: '{}', ops: ['cw-light'], source: 's', hash: 'h1' }).pendingReplies.length, 1, 'never parked twice');
  assert.equal(parkReply(parked, { hash: 'old' }).pendingReplies.length, 1, 'an applied reply is not parked again');
  assert.deepEqual(unparkReply(parked, 'h1').pendingReplies, []);
  assert.equal(COWORK_MANIFEST.protocol, 'cowork-manifest');
  for (const c of COWORK_MANIFEST.channels) assert.ok(c.name && c.request.length && (!!c.replyPath !== !!c.replyDir), `manifest channel ${c.name} is valid`);
}

// ── AI session review (house standard 18): one row per session, stored beside the app's score, undoable ──
{
  const { sanitizeOutput, planRows, buildApply, opForRow, schemaFor } = await import('./coworkOps.js');
  assert.match(schemaFor(['cw-session-review']), /sessionReviews/);
  const raw = { sessionReviews: [
    { sessionId: 'typing:1000', grade: 'B+', summary: 'Steady.', strengths: ['rhythm', 1, '', 'a', 'b', 'c'], fixes: ['e key'], next: 'drill e' },
    { sessionId: 'typing:9999', grade: 'A', summary: 'ghost' },
    { sessionId: 'speech:2000', grade: 'Z', summary: 'bad grade' },
    { sessionId: 'speech:2000', grade: 'C', summary: '' },
    { sessionId: 'typing:1000', grade: 'A', summary: 'twice' },
  ] };
  const ids = new Set(['typing:1000', 'speech:2000']);
  const { output, dropped } = sanitizeOutput(raw, ['cw-session-review'], { sessionIds: ids });
  assert.equal(output.sessionReviews.length, 1, 'only the valid review of an existing session');
  assert.deepEqual(output.sessionReviews[0].strengths, ['rhythm', '1', 'a', 'b'], 'lists capped at 4, empties dropped');
  assert.deepEqual(dropped.map((d) => d.why), ['no such session', 'grade must be A+ to F', 'empty summary', 'session reviewed twice in one reply']);
  assert.equal(sanitizeOutput(raw, ['cw-light'], { sessionIds: ids }).output.sessionReviews, undefined, 'not allowed unless requested');
  const rows = planRows(output, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'sessionReview');
  assert.equal(opForRow(rows[0], ['cw-session-review']), 'cw-session-review');
  const ap = buildApply(rows, { booksById: {}, ai: { sessionReviews: { 'speech:2000': { grade: 'A', at: 1 } } }, now: 5 });
  assert.deepEqual(Object.keys(ap.aiNext.sessionReviews).sort(), ['speech:2000', 'typing:1000'], 'stored beside earlier reviews');
  assert.equal(ap.aiNext.sessionReviews['typing:1000'].grade, 'B+');
  assert.deepEqual(ap.undo.ai.sessionReviews, { 'speech:2000': { grade: 'A', at: 1 } }, 'undo restores the previous reviews');
}
{
  const { markDue } = await import('./coworkActions.js');
  assert.equal(markDue({ schedules: {} }, 'cw-session-review'), null, 'not scheduled → nothing');
  assert.equal(markDue({ schedules: { 'cw-session-review': 'off' } }, 'cw-session-review'), null);
  assert.equal(markDue({ schedules: { 'cw-session-review': 'daily' }, actionRuns: { 'cw-session-review': { at: 99, note: 'x' } } }, 'cw-session-review').actionRuns['cw-session-review'].at, 0, 'scheduled → due now');
}
