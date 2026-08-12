// Self-check for the splash-screen activity line: accurate sums, neutral trajectory wording,
// silence when there's nothing to report.
import assert from 'node:assert/strict';
import { dailyWords, activitySummary } from './activitySummary.js';
import { fmtDate } from './dateFmt.js';

const now = new Date(2026, 7, 12, 15, 0, 0).getTime(); // local mid-afternoon — no midnight edges
const day = (i) => fmtDate(now - i * 86400000);
const file = (entries) => ({ dailyHistory: entries.map(([i, w]) => ({ date: day(i), wordsRead: w, activeTimeSecs: 60 })) });

// Aggregation: across files, zero-filled, today first, outside-window entries ignored.
const daily = dailyWords([file([[0, 100], [2, 300]]), file([[0, 50], [20, 9999]])], 14, now);
assert.equal(daily.length, 14);
assert.equal(daily[0], 150, 'same day across files sums');
assert.equal(daily[1], 0, 'missing days are zero');
assert.equal(daily[2], 300);
assert.equal(daily.reduce((a, b) => a + b, 0), 450, 'a 20-day-old entry is outside the window');

// Fresh install: nothing to say, not "0 words".
assert.equal(activitySummary([], now), null);
assert.equal(activitySummary([file([[20, 5000]])], now), null, 'activity older than a fortnight stays silent');

// Steady week: within ±15% reads as level.
const steady = activitySummary([file([[1, 5000], [3, 5000], [8, 4800], [10, 4700]])], now);
assert.match(steady, /^Past 7 days: 10k words over 2 days · about level with the week before\.$/);

// Up and down are percentages, not verdicts — no praise or guilt words.
const up = activitySummary([file([[1, 8000], [9, 4000]])], now);
assert.match(up, /up 100% on the week before\.$/);
const down = activitySummary([file([[1, 3000], [9, 6000]])], now);
assert.match(down, /down 50% on the week before\.$/);
for (const line of [steady, up, down]) {
  assert.ok(!/great|keep|only|just|try|goal|streak|slack|behind|👍|🔥/i.test(line), `judgy wording in: ${line}`);
}

// This week quiet, last week active — factual, still no verdict.
const quiet = activitySummary([file([[9, 6000]])], now);
assert.match(quiet, /^No reading in the past 7 days · down 100% on the week before\.$/);

// Active this week, nothing before — comparison degrades gracefully.
const first = activitySummary([file([[1, 2500]])], now);
assert.match(first, /^Past 7 days: 2\.5k words over 1 day · none the week before\.$/);

// Number compaction: small exact, thousands 1-decimal, ten-thousands rounded.
assert.match(activitySummary([file([[1, 950], [9, 950]])], now), /950 words/);
assert.match(activitySummary([file([[1, 12480], [9, 12480]])], now), /12k words/);

console.log('activitySummary: all cases pass');
