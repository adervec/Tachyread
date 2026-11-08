import assert from 'node:assert/strict';
import { completionEntry, queueFrom } from './listenQueue.js';

const order = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (xs) => xs.map((b) => b.id);
assert.deepEqual(ids(queueFrom(order, 'c')), ['d', 'a', 'b'], 'next: after the current, wrapping round');
assert.deepEqual(ids(queueFrom(order, 'c', -1)), ['b', 'a', 'd'], 'previous: nearest earlier first, then wraps to the end');
assert.deepEqual(ids(queueFrom(order, 'zzz')), ['a', 'b', 'c', 'd'], 'unknown current: the whole queue in order');
assert.deepEqual(ids(queueFrom(order, 'd')), ['a', 'b', 'c']);
assert.deepEqual(ids(order), ['a', 'b', 'c', 'd'], 'input untouched');

const now = new Date('2026-11-08T10:00:00Z');
const tr = { coverage: () => 0.987, lifetimeActiveMs: 5_430_000, lifetimeWpm: () => 212 };
assert.deepEqual(completionEntry(tr, now), { date: '2026-11-08T10:00:00.000Z', coveragePct: 99, activeSecs: 5430, wpm: 212, rating: 0 });
// no tracker yet (a tab that never built one) → zeros, never a throw
assert.deepEqual(completionEntry(null, now), { date: '2026-11-08T10:00:00.000Z', coveragePct: 0, activeSecs: 0, wpm: 0, rating: 0 });
console.log('listenQueue: all cases pass');
