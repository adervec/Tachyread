// Self-check for session clustering (day-scoped, split on multi-hour gaps) and the aggregates.
import assert from 'node:assert/strict';
import { currentSession, sessionStats, bookForecast, SESSION_GAP_MS } from './typingSession.js';

const H = 3600000, M = 60000;
const noon = new Date(2026, 7, 10, 12, 0, 0).getTime(); // local noon
const run = (ts, { words = 100, durationMs = 5 * M, netWpm = 60, accuracy = 96 } = {}) =>
  ({ ts, words, durationMs, netWpm, accuracy });

// One sitting: runs 30 and 10 minutes ago cluster with `now`.
const recent = [run(noon - 30 * M), run(noon - 10 * M)];
assert.equal(currentSession(recent, noon).length, 2);

// A morning sitting 5 hours back is NOT part of the noon sitting…
const split = [run(noon - 5 * H), run(noon - 5 * H + 10 * M), run(noon - 20 * M), run(noon - 5 * M)];
const sess = currentSession(split, noon);
assert.equal(sess.length, 2, 'multi-hour break splits the day into two sittings');
assert.ok(sess.every((r) => r.ts >= noon - 20 * M));
// …and if the newest run is itself hours old, the current sitting starts empty.
assert.equal(currentSession([run(noon - 3 * H)], noon).length, 0);

// Chained gaps under the threshold keep one sitting together across many runs.
const chain = [run(noon - 100 * M), run(noon - 60 * M), run(noon - 20 * M)];
assert.equal(currentSession(chain, noon).length, 3, '40-minute gaps chain into one sitting');

// A long run can't split its own sitting: the gap is measured to the run's START.
const longRun = [run(noon - 150 * M), run(noon - 20 * M, { durationMs: 125 * M })];
assert.equal(currentSession(longRun, noon).length, 2, 'gap measured to run start, not end');

// Day boundary: yesterday's runs never count, however recent the clock gap.
const lateNight = new Date(2026, 7, 10, 0, 30, 0).getTime();
assert.equal(currentSession([run(lateNight - 60 * M)], lateNight).length, 0, 'yesterday is another day');

// Future runs (clock skew) are ignored rather than crashing the walk.
assert.equal(currentSession([run(noon + 10 * M)], noon).length, 0);
assert.deepEqual(currentSession([], noon), []);
assert.deepEqual(currentSession(null, noon), []);

// Aggregates: time-weighted, live run folded in.
const s = sessionStats([run(noon, { netWpm: 50, durationMs: 10 * M, words: 500, accuracy: 90 }),
  run(noon, { netWpm: 100, durationMs: 5 * M, words: 500, accuracy: 99 })]);
assert.equal(s.runs, 2);
assert.equal(s.words, 1000);
assert.equal(s.ms, 15 * M);
assert.ok(s.avgNet > 50 && s.avgNet < 100 && s.avgNet < 75, `time-weighted toward the longer run, got ${s.avgNet}`);
assert.equal(s.best, 100);
const withLive = sessionStats([run(noon)], { netWpm: 80, words: 40, durationMs: 60000, accuracy: 98 });
assert.equal(withLive.runs, 2);
assert.equal(withLive.words, 140);
assert.equal(sessionStats([], { netWpm: 0, words: 0, durationMs: 0 }), null, 'an idle screen has no session yet');
assert.equal(sessionStats([]), null);

// Book forecast.
const f = bookForecast({ totalWords: 40000, throughWord: 10000, avgNet: 50 });
assert.equal(f.pct, 25);
assert.equal(f.left, 30000);
assert.equal(f.etaMin, 600);
assert.equal(bookForecast({ totalWords: 100, throughWord: 100, avgNet: 50 }).etaMin, null, 'finished book has no ETA');
assert.equal(bookForecast({ totalWords: 0 }), null);
assert.equal(bookForecast({ totalWords: 100, throughWord: 250, avgNet: 50 }).pct, 100, 'through is clamped');

assert.ok(SESSION_GAP_MS >= 2 * H, 'gap threshold is multi-hour');
console.log('typingSession: all cases pass');
