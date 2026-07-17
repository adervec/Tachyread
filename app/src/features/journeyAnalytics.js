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

// Yearly reading-goal progress. `target` books for the year containing `now`; returns the finished
// count so far, where the year-fraction says you "should" be, and a projection at the current rate.
export function yearGoal(books, target, now = Date.now()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
  const yearFrac = Math.min(1, Math.max(0, (now - y0) / (y1 - y0)));
  const finished = books.filter((b) => { const t = finishMs(b); return readStatus(b) === 'finished' && t != null && t >= y0 && t < now + 1; }).length;
  const expected = target > 0 ? target * yearFrac : 0;
  const projected = yearFrac > 0.02 ? Math.round(finished / yearFrac) : null; // too early in Jan → no projection
  const daysLeft = Math.max(0, Math.round((y1 - now) / 86400000));
  const remaining = Math.max(0, (target || 0) - finished);
  return {
    year, finished, target: target || 0, yearFrac,
    onTrack: target > 0 ? finished >= Math.floor(expected) : null,
    projected, daysLeft, remaining,
    // books/month needed from here to land the goal (null when done or no goal)
    needPerMonth: target > 0 && remaining > 0 && daysLeft > 0 ? round1(remaining / (daysLeft / 30.44)) : null,
  };
}

// Per-series progress: which series you're in, how far through, and the next unread volume (by
// seriesNum, else import order). Sorted: in-progress series first (some but not all finished),
// then most-recently finished. Single-book "series" are dropped — they're just a labelled novel.
export function seriesProgress(books) {
  const by = new Map();
  for (const b of books || []) {
    const s = String(b.series || '').trim();
    if (!s) continue;
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(b);
  }
  const out = [];
  for (const [series, arr] of by) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => (Number(a.seriesNum) || 999) - (Number(b.seriesNum) || 999));
    const finished = sorted.filter((b) => readStatus(b) === 'finished');
    const reading = sorted.filter((b) => readStatus(b) === 'reading');
    const next = sorted.find((b) => ['toread', 'queue'].includes(readStatus(b))) || null;
    const lastFinish = Math.max(0, ...finished.map((b) => finishMs(b) || 0));
    out.push({
      series, author: sorted[0].author || '', books: sorted,
      total: sorted.length, finished: finished.length, reading: reading.length,
      next, lastFinish, done: finished.length === sorted.length,
      active: finished.length > 0 && finished.length < sorted.length,
    });
  }
  return out.sort((a, b) => (b.active - a.active) || (b.lastFinish - a.lastFinish) || (b.finished - a.finished));
}

// "Year in Books" wrap-up: superlatives + totals for one year's dated finishes. null when empty.
export function yearInBooks(books, year) {
  const done = books.filter((b) => readStatus(b) === 'finished' && yearOf(b) === year);
  if (!done.length) return null;
  const genres = {};
  const authors = {};
  for (const b of done) {
    if (b.genre) genres[b.genre] = (genres[b.genre] || 0) + 1;
    if (b.author) authors[b.author] = (authors[b.author] || 0) + 1;
  }
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0] || null;
  const withPages = done.filter((b) => Number(b.pages) > 0);
  const rated = done.filter((b) => bookRating(b) > 0);
  const hard = done.filter((b) => Number(b.difficultyLevel) >= 1);
  return {
    year, books: done.length,
    pages: done.reduce((s, b) => s + (Number(b.pages) || 0), 0),
    words: done.reduce((s, b) => s + (Number(b.words) || 0), 0),
    fiction: done.filter((b) => b.fnf === 'F').length,
    nonfiction: done.filter((b) => b.fnf === 'NF').length,
    topGenre: top(genres), topAuthor: top(authors),
    longest: withPages.sort((a, b) => Number(b.pages) - Number(a.pages))[0] || null,
    hardest: hard.sort((a, b) => Number(b.difficultyLevel) - Number(a.difficultyLevel))[0] || null,
    favorite: rated.sort((a, b) => bookRating(b) - bookRating(a))[0] || null,
    avgRating: rated.length ? round1(rated.reduce((s, b) => s + bookRating(b), 0) / rated.length) : null,
    avgDifficulty: hard.length ? round1(hard.reduce((s, b) => s + Number(b.difficultyLevel), 0) / hard.length) : null,
  };
}

// ── Weekly summaries ─────────────────────────────────────────────────────────────────────────────
// Algorithmic summaries of COMPLETED weeks (Mon–Sun, ending before the current week). `days` is an
// array of {date:'YYYY-MM-DD', wordsRead, activeSecs} day aggregates (any order); finishes come from
// the book list. Weeks with no reading AND no finishes are skipped. Newest week first. Each row's
// `text` is the default summary; a cowork agent can replace it with a dressed-up version (stored in
// the ai record's `weeklies`, keyed by the week's Monday date).
export function weeklySummaries(days, books, { weeks = 8, now = Date.now() } = {}) {
  const mondayOf = (t) => {
    const d = new Date(t);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.getTime();
  };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const curMonday = mondayOf(now);
  const byWeek = new Map(); // weekStartMs → { words, secs, days:Set }
  for (const d of days || []) {
    const t = Date.parse((d.date || '') + 'T00:00:00Z');
    if (!Number.isFinite(t) || t >= curMonday) continue; // only completed weeks
    const w = mondayOf(t);
    const cur = byWeek.get(w) || { words: 0, secs: 0, days: new Set() };
    cur.words += d.wordsRead || 0;
    cur.secs += d.activeSecs || 0;
    if ((d.wordsRead || 0) > 0 || (d.activeSecs || 0) > 0) cur.days.add(d.date);
    byWeek.set(w, cur);
  }
  const finishesByWeek = new Map();
  for (const b of books || []) {
    if (readStatus(b) !== 'finished') continue;
    const t = finishMs(b);
    if (t == null || t >= curMonday) continue;
    const w = mondayOf(t);
    if (!finishesByWeek.has(w)) finishesByWeek.set(w, []);
    finishesByWeek.get(w).push(b);
  }
  const out = [];
  for (let i = 1; i <= weeks; i++) {
    const w = curMonday - i * 7 * 86400000;
    const agg = byWeek.get(w);
    const fins = finishesByWeek.get(w) || [];
    if (!agg && !fins.length) continue;
    const words = agg?.words || 0;
    const secs = agg?.secs || 0;
    const daysActive = agg?.days.size || 0;
    const wpm = secs > 0 ? Math.round((words / secs) * 60) : 0;
    const hrs = Math.floor(secs / 3600), mins = Math.round((secs % 3600) / 60);
    const parts = [];
    if (words > 0) {
      parts.push(`Read ${words.toLocaleString()} words in ${hrs ? `${hrs}h ${mins}m` : `${mins}m`} across ${daysActive} day${daysActive === 1 ? '' : 's'}${wpm ? ` (≈${wpm} WPM effective)` : ''}.`);
    } else if (fins.length) {
      parts.push('No in-app reading recorded.');
    }
    if (fins.length) parts.push(`Finished ${fins.map((b) => `“${b.title}”${b.author ? ` (${b.author})` : ''}`).join(', ')}.`);
    out.push({
      week: iso(w), // the week's Monday — the key cowork uses to dress a week up
      start: iso(w),
      end: iso(w + 6 * 86400000),
      words, secs, daysActive, wpm,
      finished: fins.map((b) => ({ id: b.id, title: b.title, author: b.author || '' })),
      text: parts.join(' '),
    });
  }
  return out;
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
