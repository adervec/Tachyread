// Self-check for readerArchetype.js — run: node app/src/features/readerArchetype.demo.mjs
import assert from 'node:assert';
import { bookVector, readerProfile, matchArchetype, currentArchetype, archetypeTrend, MIN_BOOKS } from './readerArchetype.js';

const fin = (o) => ({ completion: true, ...o });

// bookVector indicators
const v = bookVector({ fnf: 'F', genre: 'Literary', difficultyLevel: 5, pubDate: '1866', pages: 700 });
assert.deepEqual(v, [1, 0, 1, 0, 0, 0, 1, 1]); // fiction, literary, challenge, volume; old → not contemporary

// A classic-literary reader → The Classicist / Aesthete
const classicist = [
  fin({ fnf: 'F', genre: 'Literary', difficultyLevel: 5, pubDate: '1869', pages: 1200, finishTime: '2023-01-10' }),
  fin({ fnf: 'F', genre: 'Literary Fiction', difficultyLevel: 4, pubDate: '1925', pages: 600, finishTime: '2023-04-10' }),
  fin({ fnf: 'F', genre: 'Classics', difficultyLevel: 5, pubDate: '1851', pages: 700, finishTime: '2023-08-10' }),
];
assert.ok(['classicist', 'aesthete'].includes(currentArchetype(classicist).archetype.id), 'classic reader → classicist/aesthete');

// A genre-fiction contemporary reader → Genre Devotee / Storyteller
const genre = [
  fin({ fnf: 'F', genre: 'Science Fiction', difficultyLevel: 2, pubDate: '2015', pages: 350, finishTime: '2024-01-10' }),
  fin({ fnf: 'F', genre: 'Fantasy', difficultyLevel: 2, pubDate: '2019', pages: 420, finishTime: '2024-03-10' }),
  fin({ fnf: 'F', genre: 'Thriller', difficultyLevel: 2, pubDate: '2021', pages: 300, finishTime: '2024-05-10' }),
];
assert.ok(['genre-devotee', 'storyteller', 'contemporary'].includes(currentArchetype(genre).archetype.id), 'genre reader → genre-ish');

// A non-fiction ideas reader → Autodidact / Scholar
const nf = [
  fin({ fnf: 'NF', genre: 'History', difficultyLevel: 4, pubDate: '2005', pages: 500, finishTime: '2024-02-01' }),
  fin({ fnf: 'NF', genre: 'Philosophy', difficultyLevel: 5, pubDate: '1990', pages: 400, finishTime: '2024-04-01' }),
  fin({ fnf: 'NF', genre: 'Science', difficultyLevel: 4, pubDate: '2010', pages: 450, finishTime: '2024-06-01' }),
];
assert.ok(['autodidact', 'scholar', 'deep-diver'].includes(currentArchetype(nf).archetype.id), 'nf reader → ideas-ish');

// Gating: under MIN_BOOKS → no archetype
assert.equal(matchArchetype(readerProfile(classicist.slice(0, MIN_BOOKS - 1))).archetype, null);

// Backward trend: monthly points, reacts to the window. Deterministic `now`.
const now = Date.parse('2024-07-01');
const trend = archetypeTrend([...classicist, ...genre], 365, now);
assert.ok(trend.length > 3, 'trend has monthly points');
assert.equal(trend[trend.length - 1].date, '2024-07-01', 'last point is now');
// A short window near the end sees only the recent (genre) reads; a long window blends in the classics.
const shortWin = archetypeTrend([...classicist, ...genre], 200, now);  // ~back to 2023-12 → 3 genre books
const longWin = archetypeTrend([...classicist, ...genre], 1500, now);  // ~back to 2020 → all 6 books
assert.equal(shortWin.at(-1).count, 3, 'short window holds only the 3 recent reads');
assert.notStrictEqual(shortWin.at(-1).archetypeId, null);
assert.equal(longWin.at(-1).count, 6, 'long window holds all reads');
assert.ok(shortWin.at(-1).count < longWin.at(-1).count, 'shorter window < books than longer window');

console.log('readerArchetype.demo: all assertions passed ✅');
