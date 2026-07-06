// Pure analytics behind the Timeline / Replay / Analytics / Queue views. Everything here is a plain
// transform over the book list (no storage/React/Date.now), so the UI can recompute on every slider
// tick and the logic stays testable — see journeyAnalytics.demo.mjs.

import { readStatus, finishMs, recommender, bookRating } from './journeyLibrary.js';

const yearOf = (b) => { const ms = finishMs(b); return ms == null ? null : new Date(ms).getUTCFullYear(); };
const monthOf = (b) => { const ms = finishMs(b); return ms == null ? null : new Date(ms).getUTCMonth() + 1; };

// Chronological finishes with running totals — the spine of the replay animation and the growth curve.
// Only dated finished books; ascending by finish time.
export function cumulativeFinishes(books) {
  const rows = books
    .filter((b) => readStatus(b) === 'finished' && finishMs(b) != null)
    .map((b) => ({ b, t: finishMs(b) }))
    .sort((a, b) => a.t - b.t);
  let n = 0, pages = 0, words = 0;
  return rows.map(({ b, t }) => {
    n += 1; pages += Number(b.pages) || 0; words += Number(b.words) || 0;
    return {
      t, date: new Date(t).toISOString().slice(0, 10), id: b.id, title: b.title, author: b.author,
      genre: b.genre || 'Uncategorized', difficulty: Number(b.difficultyLevel) || null, rating: bookRating(b),
      n, pages, words,
    };
  });
}

// Year × month grid of finish counts (GitHub-style calendar). Returns the full contiguous year span so
// gaps show as empty. `max` scales the heat.
export function finishHeatmap(books) {
  const dated = books.filter((b) => readStatus(b) === 'finished' && finishMs(b) != null);
  if (!dated.length) return { years: [], cells: {}, max: 0, total: 0 };
  const yrs = dated.map(yearOf);
  const lo = Math.min(...yrs), hi = Math.max(...yrs);
  const years = []; for (let y = lo; y <= hi; y++) years.push(y);
  const cells = {}; let max = 0;
  for (const y of years) cells[y] = Array(12).fill(0);
  for (const b of dated) { cells[yearOf(b)][monthOf(b) - 1]++; }
  for (const y of years) max = Math.max(max, ...cells[y]);
  return { years, cells, max, total: dated.length };
}

const round1 = (x) => Math.round(x * 10) / 10;

// Per-year reading pace + mix. Sorted ascending by year; finished+dated books only.
export function paceByYear(books) {
  const dated = books.filter((b) => readStatus(b) === 'finished' && finishMs(b) != null);
  const by = {};
  for (const b of dated) {
    const y = yearOf(b);
    const r = (by[y] ||= { year: y, books: 0, pages: 0, words: 0, diffSum: 0, diffN: 0, rateSum: 0, rateN: 0, fiction: 0, nonfiction: 0 });
    r.books++; r.pages += Number(b.pages) || 0; r.words += Number(b.words) || 0;
    const d = Number(b.difficultyLevel); if (d >= 1 && d <= 5) { r.diffSum += d; r.diffN++; }
    const rt = bookRating(b); if (rt > 0) { r.rateSum += rt; r.rateN++; }
    if (b.fnf === 'F') r.fiction++; else if (b.fnf === 'NF') r.nonfiction++;
  }
  return Object.values(by).sort((a, b) => a.year - b.year).map((r) => ({
    year: r.year, books: r.books, pages: r.pages, words: r.words,
    avgDifficulty: r.diffN ? round1(r.diffSum / r.diffN) : null,
    avgRating: r.rateN ? round1(r.rateSum / r.rateN) : null,
    fiction: r.fiction, nonfiction: r.nonfiction,
  }));
}

// Finishes per year split across the top-N genres (everything else folded into "Other") — a stacked
// area/bar of how taste shifts over time.
export function genreTrend(books, topN = 6) {
  const dated = books.filter((b) => readStatus(b) === 'finished' && finishMs(b) != null);
  const totals = {};
  for (const b of dated) { const g = b.genre || 'Uncategorized'; totals[g] = (totals[g] || 0) + 1; }
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([g]) => g);
  const topSet = new Set(top);
  const hasOther = Object.keys(totals).some((g) => !topSet.has(g));
  const genres = hasOther ? [...top, 'Other'] : top;
  const byYear = {};
  for (const b of dated) {
    const y = yearOf(b);
    const row = (byYear[y] ||= { year: y, counts: Object.fromEntries(genres.map((g) => [g, 0])), total: 0 });
    const g = b.genre || 'Uncategorized';
    row.counts[topSet.has(g) ? g : 'Other']++; row.total++;
  }
  return { genres, rows: Object.values(byYear).sort((a, b) => a.year - b.year) };
}

// Per-recommender funnel: how many of each person's picks you've actually read / are reading / dropped.
// finishRate is over resolved books (finished + abandoned) so an all-unread pile doesn't read as 0%.
export function recommenderBreakdown(books) {
  const by = {};
  for (const b of books) {
    const name = recommender(b);
    const r = (by[name] ||= { name, total: 0, finished: 0, reading: 0, queue: 0, toread: 0, abandoned: 0 });
    r.total++; r[readStatus(b)]++;
  }
  return Object.values(by).map((r) => {
    const resolved = r.finished + r.abandoned;
    return { ...r, finishRate: resolved ? Math.round((r.finished / resolved) * 100) : null };
  }).sort((a, b) => b.total - a.total);
}

// Rough time-to-read. Prefer word count; fall back to pages (~275 words/page). null when unknown.
export function estHours(book, wpm = 250) {
  const words = Number(book.words) || (Number(book.pages) ? Number(book.pages) * 275 : 0);
  if (!words) return null;
  return round1(words / wpm / 60);
}

const bookWords = (b) => Number(b.words) || (Number(b.pages) ? Number(b.pages) * 275 : 0);

// Words/day the reader has actually been getting through lately — drives the queue's completion
// dates. Counts FINISHED books (incl. manually entered paper reads) by finishTime in the trailing
// window, so paper and in-app reading both count. Divides by the elapsed span (floored at 14 days so
// a single recent finish doesn't imply a wild daily rate). null when there's too little data.
export function recentWordsPerDay(books, windowDays = 90, now = Date.now()) {
  const cutoff = now - windowDays * 86400000;
  let words = 0, earliest = now;
  for (const b of books || []) {
    if (readStatus(b) !== 'finished') continue;
    const t = Date.parse(b.finishTime || '');
    if (!t || t < cutoff || t > now) continue;
    const w = bookWords(b);
    if (!w) continue;
    words += w;
    earliest = Math.min(earliest, t);
  }
  if (!words) return null;
  const spanDays = Math.max(14, (now - earliest) / 86400000); // ponytail: 14-day floor tames small samples
  return Math.round(words / spanDays);
}

// The on-deck queue as an ordered list (highest rec first) with per-book hours AND a projected
// completion date per book, assuming the queue is read IN ORDER at the reader's recent words/day.
export function queueWithEstimates(books, wpm = 250, opts = {}) {
  const now = opts.now || Date.now();
  const wordsPerDay = opts.wordsPerDay != null ? opts.wordsPerDay : recentWordsPerDay(books, 90, now);
  let cumWords = 0;
  const items = books.filter((b) => readStatus(b) === 'queue')
    .sort((a, b) => (Number(b.recScore) || 0) - (Number(a.recScore) || 0))
    .map((b) => {
      cumWords += bookWords(b);
      const etc = wordsPerDay && cumWords ? new Date(now + (cumWords / wordsPerDay) * 86400000).toISOString().slice(0, 10) : null;
      return { book: b, hours: estHours(b, wpm), etc };
    });
  const totalHours = round1(items.reduce((s, i) => s + (i.hours || 0), 0));
  return { items, totalHours, count: items.length, wordsPerDay };
}
