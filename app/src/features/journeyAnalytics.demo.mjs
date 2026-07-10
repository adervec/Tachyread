// Self-check for journeyAnalytics.js — run: node app/src/features/journeyAnalytics.demo.mjs
import assert from 'node:assert';
import { cumulativeFinishes, finishHeatmap, paceByYear, genreTrend, recommenderBreakdown, estHours, queueWithEstimates, recentWordsPerDay, yearGoal, seriesProgress, yearInBooks } from './journeyAnalytics.js';

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

// recentWordsPerDay: only finishes within the window count; paper entries (words/pages) included.
const NOW = Date.parse('2024-06-01');
const paceBooks = [
  { completion: true, finishTime: '2024-05-01', words: 100000 }, // 31 days before NOW, in window
  { completion: true, finishTime: '2024-05-20', pages: 200 },     // paper entry (200*275=55000 words)
  { completion: true, finishTime: '2020-01-01', words: 999999 },  // way outside the 90-day window → ignored
  { shelf: 'queue', words: 50000 },                                // not finished → ignored
];
const wpd = recentWordsPerDay(paceBooks, 90, NOW);
// span = 31 days (earliest in-window finish), words = 100000 + 55000 = 155000 → ~5000/day
assert.equal(wpd, Math.round(155000 / 31));

// ETC: read in order at a fixed pace → cumulative, monotonically later dates.
const qEtc = queueWithEstimates(books, 250, { now: NOW, wordsPerDay: 5000 });
assert.equal(qEtc.wordsPerDay, 5000);
assert.ok(qEtc.items[0].etc && qEtc.items[1].etc);
assert.ok(qEtc.items[1].etc >= qEtc.items[0].etc); // second book finishes no earlier than the first
// book 'e' = 100000 words / 5000 per day = 20 days after NOW
assert.equal(qEtc.items[0].etc, new Date(NOW + 20 * 86400000).toISOString().slice(0, 10));

// no recent finishes → no pace → null ETCs but hours still computed. `books` has a 2024-05 finish,
// so push NOW far into the future to leave nothing in the trailing 90-day window.
const FUTURE = Date.parse('2030-01-01');
const qNone = queueWithEstimates(books, 250, { now: FUTURE });
assert.equal(qNone.wordsPerDay, null);
assert.equal(qNone.items[0].etc, null);
assert.ok(qNone.items[0].hours > 0);

// yearGoal: mid-year with 6 of 12 done → on the expected pace, projection ≈ 12
{
  const MID = Date.parse('2026-07-02T12:00:00Z'); // ~50.4% through 2026
  const lib = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, title: `G${i}`, completion: true, finishTime: `2026-0${(i % 6) + 1}-15` }));
  lib.push({ id: 'old', title: 'Old', completion: true, finishTime: '2024-01-01' }); // prior year: excluded
  const g = yearGoal(lib, 12, MID);
  assert.equal(g.year, 2026);
  assert.equal(g.finished, 6);
  assert.equal(g.onTrack, true);
  assert.ok(g.projected >= 11 && g.projected <= 13, `projected ≈ 12, got ${g.projected}`);
  assert.ok(g.needPerMonth > 0.9 && g.needPerMonth < 1.15, `need ≈ 1/mo, got ${g.needPerMonth}`);
  const behind = yearGoal(lib.slice(0, 2), 12, MID); // 2 of 12 at mid-year
  assert.equal(behind.onTrack, false);
  assert.equal(yearGoal(lib, 0, MID).onTrack, null); // no goal set
}

// seriesProgress: groups, orders by seriesNum, finds the next unread, drops 1-book series
{
  const lib = [
    { id: 's1', title: 'A Game', series: 'Ice & Fire', seriesNum: 1, author: 'GRRM', completion: true, finishTime: '2025-01-01' },
    { id: 's2', title: 'A Clash', series: 'Ice & Fire', seriesNum: 2 },
    { id: 's3', title: 'A Storm', series: 'Ice & Fire', seriesNum: 3 },
    { id: 'd1', title: 'Dune', series: 'Dune Saga', seriesNum: 1, completion: true, finishTime: '2020-01-01' },
    { id: 'd2', title: 'Messiah', series: 'Dune Saga', seriesNum: 2, completion: true, finishTime: '2020-02-01' },
    { id: 'solo', title: 'One-off', series: 'Lonely' },
  ];
  const sp = seriesProgress(lib);
  assert.equal(sp.length, 2, 'single-book series dropped');
  assert.equal(sp[0].series, 'Ice & Fire', 'active series first');
  assert.equal(sp[0].next.title, 'A Clash', 'next = lowest unread seriesNum');
  assert.equal(sp[0].finished, 1);
  assert.equal(sp[1].done, true, 'Dune Saga complete');
}

// yearInBooks: superlatives for one year's finishes
{
  const lib = [
    { id: 'y1', title: 'Big', author: 'A', genre: 'Epic', fnf: 'F', completion: true, finishTime: '2023-02-01', pages: 900, difficultyLevel: 3, rating: 4 },
    { id: 'y2', title: 'Hard', author: 'A', genre: 'Phil', fnf: 'NF', completion: true, finishTime: '2023-06-01', pages: 300, difficultyLevel: 5, rating: 5 },
    { id: 'y3', title: 'Other Year', author: 'B', completion: true, finishTime: '2022-01-01', pages: 100 },
  ];
  const w = yearInBooks(lib, 2023);
  assert.equal(w.books, 2);
  assert.equal(w.pages, 1200);
  assert.equal(w.topAuthor[0], 'A');
  assert.equal(w.longest.title, 'Big');
  assert.equal(w.hardest.title, 'Hard');
  assert.equal(w.favorite.title, 'Hard');
  assert.equal(w.fiction, 1);
  assert.equal(yearInBooks(lib, 1999), null);
}

console.log('journeyAnalytics.demo: all assertions passed ✅');
