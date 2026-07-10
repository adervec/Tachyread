// Self-check for journeyCleanup. Run: node src/features/journeyCleanup.demo.mjs
import assert from 'node:assert';
import { dupKey, mergeBooks, findDuplicates, finishedDateIssues } from './journeyCleanup.js';

// dupKey: title + author last-token; tolerant of initials; untitled → null
assert.equal(dupKey({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }), dupKey({ title: 'the  hobbit', author: 'Tolkien' }));
assert.equal(dupKey({ title: '', author: 'X' }), null);

// mergeBooks: keeper values win, blanks fill, finished OR-ed, earliest finish date wins
const keep = { id: 'a', title: 'Dune', author: 'Herbert', genre: '', completion: false, finishTime: '2020-05-01' };
const dup = { id: 'b', title: 'Dune', author: 'Frank Herbert', genre: 'SciFi', completion: true, finishTime: '2019-01-01' };
const m = mergeBooks(keep, dup);
assert.equal(m.id, 'a');                 // keeper id preserved
assert.equal(m.author, 'Herbert');       // keeper's non-blank wins
assert.equal(m.genre, 'SciFi');          // blank filled from dup
assert.equal(m.completion, true);        // OR-ed to finished
assert.equal(m.finishTime, '2019-01-01'); // earliest finish date

// findDuplicates: groups the ISBN'd + non-ISBN'd copies, keeps the finished one
const books = [
  { id: 'isbn:123', title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719', completion: true, finishTime: '2019-01-01' },
  { id: 'bk:herbert|dune', title: 'Dune', author: 'Herbert', genre: 'SciFi' },
  { id: 'bk:solo', title: 'Solo Book', author: 'Nobody' },
];
const dups = findDuplicates(books);
assert.equal(dups.length, 1);
assert.equal(dups[0].keepId, 'isbn:123');          // finished + ISBN → keeper
assert.deepEqual(dups[0].dropIds, ['bk:herbert|dune']);
assert.equal(dups[0].merged.genre, 'SciFi');       // folded in from the dropped copy

// finishedDateIssues: date what we can, surface the rest, fix contradictions
const lib = [
  { id: 'f1', title: 'Read In App', completion: true },          // datable (bound)
  { id: 'f2', title: 'Read Offline', completion: true },         // undatable
  { id: 'f3', title: 'Reread', completion: true, inProgress: true, finishTime: '2021-02-02' }, // contradictory
  { id: 'f4', title: 'Proper', completion: true, finishTime: '2022-03-03' },                    // fine
];
const dateFor = (b) => (b.id === 'f1' ? '2023-06-06' : null);
const iss = finishedDateIssues(lib, dateFor);
assert.equal(iss.datable.length, 1);
assert.equal(iss.datable[0].fix.finishTime, '2023-06-06');
assert.equal(iss.undatable.length, 1);
assert.equal(iss.undatable[0].id, 'f2');
assert.equal(iss.undatable[0].fix.completion, false); // opt-in un-finish
assert.equal(iss.contradictory.length, 1);
assert.equal(iss.contradictory[0].fix.inProgress, false);

console.log('journeyCleanup.demo: all assertions passed ✅');
