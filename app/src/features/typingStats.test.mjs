// Run: node src/features/typingStats.test.mjs
import assert from 'node:assert';
import { typingWeekly, typingOverall } from './typingStats.js';

const day = 86400000;
const mon = Date.parse('2026-07-06T12:00:00Z'); // a Monday
const runs = [
  { ts: mon, netWpm: 40, accuracy: 90, words: 100, durationMs: 60000 },
  { ts: mon + 2 * day, netWpm: 50, accuracy: 92, words: 120, durationMs: 60000 },
  { ts: mon + 7 * day, netWpm: 60, accuracy: 94, words: 150, durationMs: 60000 },
  { ts: mon + 8 * day, netWpm: 70, accuracy: 96, words: 150, durationMs: 60000 },
];

const w = typingWeekly(runs);
assert.equal(w.length, 2, 'two active weeks');
assert.equal(w[0].week, '2026-07-13', 'newest first');
assert.equal(w[0].avgNet, 65);
assert.equal(w[0].deltaNet, 20, 'delta vs previous active week');
assert.equal(w[1].avgNet, 45);
assert.equal(w[1].deltaNet, null, 'oldest week has no delta');
assert.equal(w[0].words, 300);

const o = typingOverall(runs);
assert.equal(o.n, 2, 'windows are half the history when short');
assert.equal(o.firstNet, 45);
assert.equal(o.lastNet, 65);
assert.equal(o.deltaNet, 20, 'absolute progress');
assert.equal(o.pctNet, 44, 'relative progress');
assert.equal(o.deltaAcc, 4, 'accuracy delta in points');
assert.equal(typingOverall(runs.slice(0, 3)), null, 'too few runs → null');
console.log('ok');
