// Self-check for the manual-reading pace ghost: where it is at a given moment, how the race reads,
// and when a run should be torn down.
import assert from 'node:assert/strict';
import { ghostIndexAt, raceState, ghostRunFrom, ghostResetReason } from './paceGhost.js';

const T0 = 1_800_000_000_000;
const at = (secs, over = {}) => ghostIndexAt({ startIdx: 100, startedAt: T0, now: T0 + secs * 1000, wpm: 300, totalWords: 100000, ...over });

// 300 wpm = 5 words/sec, counted from where the run began.
assert.equal(at(0), 100);
assert.equal(at(1), 105);
assert.equal(at(60), 400, 'one minute at 300 wpm covers 300 words');
assert.equal(at(0.5), 102, 'partial seconds floor to whole words');

// No run / nonsense pace → no ghost at all rather than a bogus position.
assert.equal(ghostIndexAt({ startIdx: 10, startedAt: 0, now: T0, wpm: 300 }), null);
assert.equal(ghostIndexAt({ startIdx: 10, startedAt: T0, now: T0, wpm: 0 }), null);
assert.equal(ghostIndexAt({ startIdx: 10, startedAt: T0, now: T0, wpm: -5 }), null);

// A wild WPM is clamped, so a bad setting can't fling the ghost across the book.
assert.ok(at(60, { wpm: 999999 }) - 100 <= 3000, 'absurd wpm clamps to 3000');
assert.ok(at(60, { wpm: 1 }) - 100 >= 10, 'a floor keeps the ghost from standing still');

// It never walks off the end of the document.
assert.equal(at(3600, { totalWords: 500 }), 499, 'clamped to the last word');
assert.equal(ghostIndexAt({ startIdx: 0, startedAt: T0, now: T0 + 10000, wpm: 300, totalWords: 0 }), 0);
// Clock skew (now before the run started) reads as zero elapsed, not a negative walk.
assert.equal(at(-30), 100);

// Race readout: ±2 words is level, because the marker moves continuously and a 1-word wobble
// flickering between "ahead" and "behind" would be worse than useless.
assert.equal(raceState(150, 100).status, 'ahead');
assert.equal(raceState(150, 100).delta, 50);
assert.equal(raceState(50, 100).status, 'behind');
assert.equal(raceState(50, 100).delta, -50);
assert.equal(raceState(100, 100).status, 'level');
assert.equal(raceState(102, 100).status, 'level');
assert.equal(raceState(98, 100).status, 'level');
assert.equal(raceState(103, 100).status, 'ahead');
assert.equal(raceState(97, 100).status, 'behind');
assert.equal(raceState(100, null), null);
assert.equal(raceState(null, 100), null);

// A run always restarts from the reader — never from where the ghost got to alone.
const run = ghostRunFrom(742, T0);
assert.deepEqual(run, { startIdx: 742, startedAt: T0 });
assert.equal(ghostRunFrom(-5, T0).startIdx, 0);
assert.equal(ghostIndexAt({ ...run, now: T0, wpm: 250 }), 742, 'a fresh run starts level with the reader');

// Teardown reasons, in priority order.
assert.equal(ghostResetReason({ playing: true }), 'playing', 'auto-play owns the pace');
assert.equal(ghostResetReason({ idle: true }), 'idle');
assert.equal(ghostResetReason({ playing: true, idle: true }), 'playing');
assert.equal(ghostResetReason({ readerIdx: 5000, ghostIdx: 100 }), 'jump', 'a chapter jump invalidates the race');
assert.equal(ghostResetReason({ readerIdx: 100, ghostIdx: 5000 }), 'jump', 'a big rewind counts too');
assert.equal(ghostResetReason({ readerIdx: 350, ghostIdx: 100 }), null, 'a good lead is not a jump');
assert.equal(ghostResetReason({ readerIdx: 100, ghostIdx: null }), null, 'no ghost, nothing to reset');
assert.equal(ghostResetReason({}), null);

console.log('paceGhost: all cases pass');
