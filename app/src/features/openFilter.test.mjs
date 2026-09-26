// Self-check for the open filters: which documents "Open untracked only" / "Open unfinished only"
// let through. Run: node src/features/openFilter.test.mjs
import assert from 'node:assert/strict';
import { skipOpen, OPEN_ONLY_LABEL } from './openFilter.js';

const fresh = { bound: false, book: null, rec: null, shelf: undefined };
const midway = { totalWords: 1000, wordIndex: 400, completions: [], dailyHistory: [{ date: '2026-09-01', wordsRead: 400 }] };
const atEnd = { totalWords: 1000, wordIndex: 999, completions: [], dailyHistory: [{ date: '2026-09-01', wordsRead: 1000 }] };

// ── no filter: everything opens ──
assert.equal(skipOpen(null, { bound: true, book: { completion: true } }), null);
assert.equal(skipOpen(undefined, fresh), null);
assert.equal(skipOpen('all', { bound: true }), null, 'an unknown mode never blocks an open');

// ── untracked only ──
assert.equal(skipOpen('untracked', fresh), null, 'an unlinked document opens');
assert.equal(skipOpen('untracked', { ...fresh, bound: true }), OPEN_ONLY_LABEL.untracked, 'a linked one is skipped');
assert.equal(skipOpen('untracked', { bound: true, book: { completion: true }, rec: atEnd }), OPEN_ONLY_LABEL.untracked);
assert.equal(skipOpen('untracked', { ...fresh, rec: atEnd }), null, 'being finished is irrelevant to this filter');
assert.equal(skipOpen('untracked', {}), null, 'nothing known about it → open it');

// ── unfinished only: the tracker's verdict ──
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: { id: 'b', completion: true } }), OPEN_ONLY_LABEL.unfinished);
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: { id: 'b', inProgress: true } }), null, 'a book being read opens');
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: { id: 'b', shelf: 'queue' } }), null, 'on deck opens');
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: { id: 'b', shelf: 'abandoned' } }), null, 'abandoned is not finished');
// Both flags at once only comes from imported data, and readStatus calls it finished — so this
// filter does too. Agreeing with the status shown everywhere else beats a second opinion here.
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: { id: 'b', completion: true, inProgress: true } }), OPEN_ONLY_LABEL.unfinished);
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: { id: 'b', inProgress: true, completion: false } }), null, 'a re-read started in the app clears completion, so it opens');
assert.equal(skipOpen('unfinished', { ...fresh, bound: true, book: null }), null, 'a link to a book that is gone opens');

// ── unfinished only: the file's own reading record, for documents never linked ──
assert.equal(skipOpen('unfinished', { ...fresh, rec: midway }), null, 'part-read opens');
assert.equal(skipOpen('unfinished', { ...fresh, rec: atEnd }), OPEN_ONLY_LABEL.unfinished, 'parked on the last word is finished');
assert.equal(skipOpen('unfinished', { ...fresh, rec: { totalWords: 1000, wordIndex: 0 } }), null, 'never opened before → opens');
assert.equal(skipOpen('unfinished', { ...fresh, rec: atEnd, shelf: 'reading' }), null, 'an explicit Reading shelf beats the heuristic');
assert.equal(skipOpen('unfinished', { ...fresh, rec: midway, shelf: 'finished' }), OPEN_ONLY_LABEL.unfinished, 'an explicit Finished shelf wins');
assert.equal(skipOpen('unfinished', {
  ...fresh,
  rec: { totalWords: 1000, wordIndex: 990, completions: [{ date: '2026-08-01' }], dailyHistory: [{ date: '2026-09-01', wordsRead: 300 }] },
}), null, '🔍 read again after finishing it → a re-read, so it opens');
assert.equal(skipOpen('unfinished', {}), null, 'nothing known → open it');

console.log('openFilter: all cases pass');
