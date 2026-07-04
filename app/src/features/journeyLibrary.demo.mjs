// Self-check for journeyLibrary.js — run: node app/src/features/journeyLibrary.demo.mjs
import assert from 'node:assert';
import { deriveId, parseDifficulty, pubYear, readStatus, normalizeSeed, filterBooks, sortBooks, libraryStats, exportJourneyMarkdown } from './journeyLibrary.js';

// id: ISBN wins; else author|title; stable across re-derive.
assert.equal(deriveId({ isbn: '978-0-14-044913-6', title: 'X', author: 'Y' }), 'isbn:9780140449136');
assert.equal(deriveId({ title: 'The Trial', author: 'Franz Kafka' }), 'bk:franz-kafka|the-trial');
assert.equal(deriveId({ title: 'The Trial', author: 'Franz Kafka' }), deriveId({ title: 'The Trial', author: 'Franz Kafka' }));

assert.equal(parseDifficulty('5 — Formidable'), 5);
assert.equal(parseDifficulty(3), 3);
assert.equal(pubYear({ pubDate: '1997-03-01' }), 1997);
assert.equal(pubYear({ pubDate: 'March 1866' }), 1866);

assert.equal(readStatus({ completion: true }), 'finished');
assert.equal(readStatus({ inProgress: true }), 'reading');
assert.equal(readStatus({ completion: false }), 'toread');

const raw = {
  meta: { note: 'sample' },
  longForm: [
    { title: 'Crime and Punishment', author: 'Dostoevsky', fnf: 'F', genre: 'Literary', difficulty: '5 — Formidable', recScore: 10, completion: true, finishTime: '2024-01-05', words: 210000, pages: 671, rating: 5 },
    { title: 'The Trial', author: 'Kafka', fnf: 'F', genre: 'Literary', difficultyLevel: 4, recScore: 9, completion: true, finishTime: '2024-06-01', words: 90000, pages: 255 },
    { title: 'Dune', author: 'Herbert', fnf: 'F', genre: 'SciFi', difficultyLevel: 3, recScore: 8, inProgress: true },
  ],
  shortForm: [
    { title: 'A Hunger Artist', author: 'Kafka', fnf: 'F', genre: 'Literary', difficultyLevel: 2, recScore: 7, completion: false },
  ],
};
const env = normalizeSeed(raw);
assert.equal(env.protocol, 'tachyread-journey');
assert.equal(env.books.length, 4);
assert.ok(env.books.every((b) => b.id && b.type));
assert.equal(normalizeSeed(env), env); // envelope passes through

const books = env.books;
assert.equal(filterBooks(books, { readState: 'finished' }).length, 2);
assert.equal(filterBooks(books, { fnf: 'F', recMin: 9 }).length, 2);
assert.equal(filterBooks(books, { difficulty: [4, 5] }).length, 2);
assert.equal(filterBooks(books, { search: 'kafka' }).length, 2);
assert.equal(filterBooks(books, { genre: 'SciFi' }).length, 1);

assert.equal(sortBooks(books, 'rec')[0].title, 'Crime and Punishment');
assert.equal(sortBooks(books, 'title')[0].title, 'A Hunger Artist');
assert.equal(sortBooks(books, 'finished')[0].title, 'The Trial'); // most recent finish

const st = libraryStats(books);
assert.equal(st.total, 4);
assert.equal(st.finished, 2);
assert.equal(st.reading, 1);
assert.equal(st.words, 300000);
assert.equal(st.byDifficulty[5], 1);
assert.equal(st.recentFinishes[0].title, 'The Trial');

const md = exportJourneyMarkdown(books, { title: 'Test' });
assert.ok(md.includes('## Finished (2)'));
assert.ok(md.includes('Crime and Punishment'));
assert.ok(md.includes('finished 2024-01-05'));
assert.ok(!/tech.?tree|vector/i.test(md)); // human-readable only

console.log('journeyLibrary.demo: all assertions passed ✅');
