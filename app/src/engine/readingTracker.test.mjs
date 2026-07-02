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

// Plain recordMove still behaves: 10 forward words in 3s ≈ 200 wpm events.
const t2 = createReadingTracker({ wordCount: 100 });
t2.recordMove(0, 0, T); // seed clock
for (let i = 0; i < 10; i++) t2.recordMove(i, i + 1, T + 300 * (i + 1));
assert(t2.readCount === 10, 'recordMove marks words read');
const r2 = t2.recentWpm(T + 3001);
assert(r2 >= 180 && r2 <= 220, `step reading ≈ 200 wpm, got ${r2}`);
console.log('ok');
