import assert from 'node:assert/strict';
import { completionEntry } from './listenQueue.js';

const now = new Date('2026-11-08T10:00:00Z');
const tr = { coverage: () => 0.987, lifetimeActiveMs: 5_430_000, lifetimeWpm: () => 212 };
assert.deepEqual(completionEntry(tr, now), { date: '2026-11-08T10:00:00.000Z', coveragePct: 99, activeSecs: 5430, wpm: 212, rating: 0 });
// no tracker yet (a tab that never built one) → zeros, never a throw
assert.deepEqual(completionEntry(null, now), { date: '2026-11-08T10:00:00.000Z', coveragePct: 0, activeSecs: 0, wpm: 0, rating: 0 });
console.log('listenQueue: all cases pass');
