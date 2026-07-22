// Self-check for the forgetting-curve scan.
// Run: node app/src/features/journeyForgetting.test.mjs
import assert from 'node:assert';
import {
  retentionOf, retentionTier, memoryStabilityDays, forgettingScan, forgettingSummary,
  BASE_STABILITY_DAYS, REREAD_FACTOR, FRESH_ABOVE, FADED_BELOW,
} from './journeyForgetting.js';

const DAY = 86400000;
const NOW = Date.parse('2026-07-21T00:00:00Z');
const daysAgo = (n) => NOW - n * DAY;
// A finished book read `reps` times, last finished `days` ago.
const fin = ({ id = 'b', title = 'Book', days = 0, reps = 1, rating = 0, difficulty = 0 } = {}) => ({
  id, title, completion: true,
  finishTime: daysAgo(days),
  finishHistory: reps > 1 ? Array.from({ length: reps - 1 }, (_, i) => daysAgo(days + (i + 1) * 40)) : [],
  ...(rating ? { rating } : {}),
  ...(difficulty ? { difficultyLevel: difficulty } : {}),
});

// ── retention basics ─────────────────────────────────────────────────────────
assert.ok(Math.abs(retentionOf(fin({ days: 0 }), NOW) - 1) < 1e-9, 'just finished → full retention');
// After one stability constant, retention ≈ 1/e.
assert.ok(Math.abs(retentionOf(fin({ days: BASE_STABILITY_DAYS }), NOW) - Math.exp(-1)) < 1e-6, 'one stability period → ~37%');
assert.ok(retentionOf(fin({ days: 5 }), NOW) > retentionOf(fin({ days: 60 }), NOW), 'more time → less retained');
// Non-finished books have no retention (nothing to forget yet).
assert.equal(retentionOf({ id: 'x', inProgress: true, finishTime: daysAgo(100) }, NOW), null, 'a book being read → null');
assert.equal(retentionOf({ id: 'y', shelf: 'toread' }, NOW), null, 'a to-read book → null');
assert.equal(retentionOf({ id: 'z', completion: true }, NOW), null, 'finished but undated → null');

// ── re-reads strengthen memory ───────────────────────────────────────────────
assert.ok(memoryStabilityDays(fin({ reps: 3 })) > memoryStabilityDays(fin({ reps: 1 })), 'more reads → more durable');
assert.ok(Math.abs(memoryStabilityDays(fin({ reps: 2 })) - BASE_STABILITY_DAYS * REREAD_FACTOR) < 1e-6, 'second read multiplies stability');
// Same elapsed time, a thrice-read book is remembered far better than a once-read one.
assert.ok(retentionOf(fin({ days: 90, reps: 3 }), NOW) > retentionOf(fin({ days: 90, reps: 1 }), NOW), 're-reads survive longer');

// Rating and difficulty nudge it (small, bounded).
assert.ok(memoryStabilityDays(fin({ rating: 5 })) > memoryStabilityDays(fin({ rating: 1 })), 'loved books stick better');
assert.ok(memoryStabilityDays(fin({ difficulty: 5 })) < memoryStabilityDays(fin({ difficulty: 1 })), 'harder books fade faster');
// …but a re-read matters more than a rating swing.
assert.ok(memoryStabilityDays(fin({ reps: 2, rating: 1 })) > memoryStabilityDays(fin({ reps: 1, rating: 5 })), 'a re-read beats a rating');

// ── tiers ─────────────────────────────────────────────────────────────────────
assert.equal(retentionTier(0.9), 'fresh');
assert.equal(retentionTier(0.5), 'fading');
assert.equal(retentionTier(0.1), 'faded');
assert.equal(retentionTier(null), 'unknown');
assert.ok(FRESH_ABOVE > FADED_BELOW, 'sane thresholds');

// ── the scan ───────────────────────────────────────────────────────────────────
const lib = [
  fin({ id: 'fresh', title: 'Just Read', days: 3 }),                       // ~90% → excluded
  fin({ id: 'fading', title: 'Slipping', days: 33 }),                      // ~33% → fading
  fin({ id: 'faded', title: 'Long Gone', days: 200 }),                     // tiny → faded
  fin({ id: 'durable', title: 'Reread Thrice', days: 30, reps: 3 }),       // high stability + recent → still fresh, excluded
  { id: 'reading', title: 'On It Now', inProgress: true, finishTime: daysAgo(300) }, // excluded (actively reading)
  { id: 'todo', title: 'Not Yet', shelf: 'toread' },                       // excluded (never finished)
];
const scan = forgettingScan(lib, NOW);
const ids = scan.map((s) => s.id);
assert.ok(ids.includes('fading') && ids.includes('faded'), `at-risk books surface: ${JSON.stringify(ids)}`);
assert.ok(!ids.includes('fresh') && !ids.includes('durable'), 'fresh / durable books are not flagged');
assert.ok(!ids.includes('reading') && !ids.includes('todo'), 'unfinished / in-progress books are excluded');
// Order: fading (still worth saving) before faded (largely gone).
assert.equal(scan[0].id, 'fading', `fading leads, got ${scan[0].id}`);
assert.equal(scan[scan.length - 1].id, 'faded', 'faded trails');
// Each row carries the evidence the UI shows.
const row = scan.find((s) => s.id === 'fading');
assert.equal(row.reads, 1);
assert.ok(row.daysSince >= 32 && row.daysSince <= 34, `daysSince ~33, got ${row.daysSince}`);
assert.ok(row.retention > FADED_BELOW && row.retention < FRESH_ABOVE, 'fading retention in band');
assert.deepEqual(forgettingSummary(scan), { fading: 1, faded: 1 }, JSON.stringify(forgettingSummary(scan)));

// Stable ordering between runs.
assert.deepEqual(forgettingScan(lib, NOW).map((s) => s.id), ids, 'order is deterministic');
assert.deepEqual(forgettingScan([], NOW), [], 'empty library → empty scan');

console.log('journeyForgetting: all assertions passed ✅');
