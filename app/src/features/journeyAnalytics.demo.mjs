// Self-check for journeyAnalytics.js — run: node app/src/features/journeyAnalytics.demo.mjs
import assert from 'node:assert';
import { cumulativeFinishes, finishHeatmap, paceByYear, genreTrend, recommenderBreakdown, estHours, queueWithEstimates } from './journeyAnalytics.js';

const books = [
  { id: 'a', title: 'A', author: 'X', genre: 'Literary', fnf: 'F', completion: true, finishTime: '2023-02-10', pages: 300, words: 90000, difficultyLevel: 4, rating: 5, recBy: 'Sam' },
  { id: 'b', title: 'B', author: 'X', genre: 'SciFi', fnf: 'F', completion: true, finishTime: '2023-11-20', pages: 400, words: 120000, difficultyLevel: 3, rating: 4 },
  { id: 'c', title: 'C', author: 'Y', genre: 'History', fnf: 'NF', completion: true, finishTime: '2024-05-01', pages: 500, words: 150000, difficultyLevel: 5, rating: 3, recBy: 'Sam' },
  { id: 'd', title: 'D', author: 'Z', genre: 'Literary', fnf: 'F', inProgress: true },
  { id: 'e', title: 'E', author: 'Z', genre: 'SciFi', fnf: 'F', shelf: 'queue', recScore: 9, words: 100000 },
  { id: 'f', title: 'F', author: 'Q', genre: 'Fantasy', fnf: 'F', shelf: 'queue', recScore: 7, pages: 200 },
  { id: 'g', title: 'G', author: 'Q', genre: 'History', fnf: 'NF', shelf: 'abandoned', recBy: 'Sam' },
];

// cumulativeFinishes: only dated finishes, ascending, running totals
const cum = cumulativeFinishes(books);
assert.equal(cum.length, 3);
assert.deepEqual(cum.map((r) => r.title), ['A', 'B', 'C']);
assert.equal(cum[2].n, 3);
assert.equal(cum[2].pages, 1200);
assert.equal(cum[2].words, 360000);

// heatmap: 2023..2024 contiguous, right cells lit
const hm = finishHeatmap(books);
assert.deepEqual(hm.years, [2023, 2024]);
assert.equal(hm.cells[2023][1], 1); // Feb 2023 (month index 1)
assert.equal(hm.cells[2023][10], 1); // Nov 2023
assert.equal(hm.cells[2024][4], 1); // May 2024
assert.equal(hm.total, 3);

// pace by year
const pace = paceByYear(books);
assert.equal(pace.length, 2);
assert.equal(pace[0].year, 2023);
assert.equal(pace[0].books, 2);
assert.equal(pace[0].fiction, 2);
assert.equal(pace[1].year, 2024);
assert.equal(pace[1].nonfiction, 1);
assert.equal(pace[1].avgDifficulty, 5);

// genre trend: top genres + per-year counts over finished books
const gt = genreTrend(books, 6);
assert.ok(gt.genres.includes('Literary') && gt.genres.includes('SciFi') && gt.genres.includes('History'));
const y2023 = gt.rows.find((r) => r.year === 2023);
assert.equal(y2023.counts.Literary, 1);
assert.equal(y2023.counts.SciFi, 1);
assert.equal(y2023.total, 2);

// recommender breakdown: Sam recommended a,c (finished) + g (abandoned); Claude the rest
const rb = recommenderBreakdown(books);
const sam = rb.find((r) => r.name === 'Sam');
assert.equal(sam.total, 3);
assert.equal(sam.finished, 2);
assert.equal(sam.abandoned, 1);
assert.equal(sam.finishRate, 67); // 2 finished of 3 resolved
const claude = rb.find((r) => r.name === 'Claude'); // b(fin), d(reading), e/f(queue)
assert.equal(claude.total, 4);
assert.equal(claude.finished, 1);
assert.equal(claude.finishRate, 100); // 1 finished of 1 resolved (queue/reading don't count)

// finishRate stays null when nothing is resolved (all unread/queued)
const nrb = recommenderBreakdown([{ recBy: 'Pat', shelf: 'queue' }, { recBy: 'Pat' }]);
assert.equal(nrb[0].finishRate, null);

// estimates
assert.equal(estHours({ words: 90000 }, 250), 6); // 90000/250/60 = 6h
assert.equal(estHours({ pages: 200 }, 250), Math.round((200 * 275) / 250 / 60 * 10) / 10);
assert.equal(estHours({}), null);

const q = queueWithEstimates(books, 250);
assert.equal(q.count, 2);
assert.equal(q.items[0].book.id, 'e'); // highest recScore first
assert.ok(q.totalHours > 0);

console.log('journeyAnalytics.demo: all assertions passed ✅');
