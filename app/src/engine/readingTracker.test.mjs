// ponytail: scroll-to-read accounting — dwell-then-scroll credits the span at the dwell pace
// (not misread as a skim/skip), flings are coverage-only, live readout includes the open
// gesture. Run: node src/engine/readingTracker.test.mjs
import { createReadingTracker } from './readingTracker.js';
import assert from 'node:assert';

const T = 1_000_000;
const t = createReadingTracker({ wordCount: 5000 });

// First gesture has no dwell baseline → coverage only, no efficiency credit.
t.noteScrollAdvance(0, 50, T);
// Read the visible pane for 60s, then scroll 80 words past the top (a burst of tiny advances).
t.noteScrollAdvance(50, 90, T + 60000);
t.noteScrollAdvance(90, 110, T + 60016);
t.noteScrollAdvance(110, 130, T + 60032);

// Live readout mid-gesture: 80 words over ~60s ≈ 80 wpm.
const live = t.recentWpm(T + 60100);
assert(live >= 70 && live <= 90, `live scroll wpm ≈ 80, got ${live}`);

// Next gesture after another 45s dwell commits the previous one.
t.noteScrollAdvance(130, 190, T + 105000);
assert(t.isRead(100), 'scrolled-past words are marked read');
const session = t.sessionWpm(T + 105001);
assert(session >= 60 && session <= 100, `session wpm from scroll reading ≈ 80, got ${session}`);

// A fling right after (700 words in 50ms) must NOT earn pace/efficiency credit…
const beforeFling = t.sessionWpm(T + 105050);
t.noteScrollAdvance(190, 890, T + 105050);
t.noteScrollAdvance(890, 900, T + 106000); // gap > gesture window commits the fling
const afterFling = t.sessionWpm(T + 106001);
assert(afterFling <= beforeFling, `fling must not raise session wpm (${beforeFling} → ${afterFling})`);
// …but the flung span still counts as covered (scroll mode contract).
assert(t.isRead(500), 'flung-past words still count for coverage');

// Nothing pending leaks across hide: commit on hide, no time accrues while hidden.
const ms0 = t.sessionActiveMs;
t.setHidden(true, T + 106100);
t.setHidden(false, T + 900000);
t.noteScrollAdvance(900, 950, T + 901000);
t.noteScrollAdvance(950, 960, T + 903000);
assert(t.sessionActiveMs - ms0 < 10000, 'hidden time is not credited');

// Live readout accuracy in scroll mode (the "WPM not accurate when scroll-reading" fixes):
const t3 = createReadingTracker({ wordCount: 5000 });
t3.noteScrollAdvance(0, 50, T);
t3.noteScrollAdvance(50, 130, T + 40000);  // 80 words after a 40s dwell → 120 wpm gesture
t3.noteScrollAdvance(130, 210, T + 80000); // commits the first, starts the second

// 1. Mid-dwell (window empty) the readout holds the last gesture's pace instead of flapping to 0.
const held = t3.recentWpm(T + 150000); // 70s into the next dwell
assert(held >= 110 && held <= 130, `dwell holds last screenful's pace ≈ 120, got ${held}`);
assert.equal(t3.recentWpm(T + 80000 + 200000), 0, 'hold expires once scrolling has clearly stopped');

// 2. The first frames of a scroll (few words + full dwell) don't drag the readout down.
const t4 = createReadingTracker({ wordCount: 5000 });
t4.noteScrollAdvance(0, 50, T);
t4.noteScrollAdvance(50, 130, T + 40000);
t4.noteScrollAdvance(130, 210, T + 80000); // commit #1 (120 wpm), pend #2 open
t4.noteScrollAdvance(210, 213, T + 120000); // commit #2, new pend: 3 words on a 40s dwell
const early = t4.recentWpm(T + 120100);
assert(early >= 100, `tiny in-flight gesture is ignored, not averaged in (got ${early})`);

// 3. Overlapping/stale frontier reports (the pane's two scroll signals racing) don't split the
//    gesture or re-count words; a forward relocation is NOT folded into the gesture.
const t5 = createReadingTracker({ wordCount: 5000 });
t5.noteScrollAdvance(0, 50, T);
t5.noteScrollAdvance(50, 120, T + 40000); // gesture: 70 words over 40s
t5.noteScrollAdvance(100, 118, T + 40016); // stale overlap → no-op
t5.noteScrollAdvance(100, 125, T + 40032); // stale prev, frontier really at 125 → extend
t5.noteScrollAdvance(125, 200, T + 80000); // commits: 50→125 = 75 words / 40s ≈ 112 wpm
const r5 = t5.recentWpm(T + 80100);
assert(r5 >= 100 && r5 <= 125, `overlaps don't inflate the rate (got ${r5})`);
// relocation: click ahead to 1000, scroll within the gesture gap — jumped span earns nothing
t5.noteScrollAdvance(1000, 1010, T + 80200);
assert(!t5.isRead(500), 'relocated-past words are not credited by the scroll gesture');

// Plain recordMove still behaves: 10 forward words in 3s ≈ 200 wpm events.
const t2 = createReadingTracker({ wordCount: 100 });
t2.recordMove(0, 0, T); // seed clock
for (let i = 0; i < 10; i++) t2.recordMove(i, i + 1, T + 300 * (i + 1));
assert(t2.readCount === 10, 'recordMove marks words read');
const r2 = t2.recentWpm(T + 3001);
assert(r2 >= 180 && r2 <= 220, `step reading ≈ 200 wpm, got ${r2}`);

// readRuns: contiguous read ranges within a span, for edition read-state transfer.
const t6 = createReadingTracker({ wordCount: 100 });
t6.markRangeRead(10, 15);
t6.markRangeRead(20, 22);
assert.deepEqual(t6.readRuns(0, 100), [[10, 15], [20, 22]], 'readRuns finds the two runs');
assert.deepEqual(t6.readRuns(12, 21), [[12, 15], [20, 21]], 'readRuns clips to the query window');
assert.deepEqual(t6.readRuns(30, 40), [], 'no reads → no runs');
// a run touching the end is closed at the window edge
const t7 = createReadingTracker({ wordCount: 100 });
t7.markRangeRead(95, 100);
assert.deepEqual(t7.readRuns(90, 100), [[95, 100]]);

// markRangeReadAtPace: impute an unread span read at a pace — coverage + honest time credit.
const t8 = createReadingTracker({ wordCount: 1000 });
const r8 = t8.markRangeReadAtPace(0, 200, 250); // 200 words @ 250 wpm → 48s
assert.equal(r8.added, 200, 'credits the unread words');
assert.equal(t8.readCount, 200);
assert.equal(t8.lifetimeWpm(), 250, 'lifetime wpm matches the imputed pace (no spike)');
assert.equal(t8.rangeStats(0, 200).wpm, 250, 'per-word pace tagged');
// Overlapping re-apply only credits the genuinely-new words, and leaves prior pace alone.
const r8b = t8.markRangeReadAtPace(100, 400, 300);
assert.equal(r8b.added, 200, 'only new words counted');
assert.equal(t8.readCount, 400);
assert.equal(t8.rangeStats(0, 100).wpm, 250, 'earlier words keep their original pace');
console.log('ok');
