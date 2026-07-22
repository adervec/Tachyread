// Self-check for the cursor-trail engine. Run: node app/src/features/cursorTrail.test.mjs
import assert from 'node:assert';
import { createTrail, clampTrailMs, TRAIL_MODES, TRAIL_MIN_MS, TRAIL_MAX_MS, DEFAULT_TRAIL_MS } from './cursorTrail.js';

assert.deepEqual(TRAIL_MODES, ['off', 'fade', 'seismograph'], 'the three modes');
assert.equal(clampTrailMs(50), TRAIL_MIN_MS, 'too short → floor');
assert.equal(clampTrailMs(99999), TRAIL_MAX_MS, 'too long → ceiling');
assert.equal(clampTrailMs('x'), DEFAULT_TRAIL_MS, 'garbage → default');

// ── fade mode ────────────────────────────────────────────────────────────────
const t = createTrail({ mode: 'fade', trailMs: 1000 });
t.move(0, 0, 0);
t.move(50, 0, 100);
t.move(100, 0, 200);
let s = t.sample(200);
assert.equal(s.length, 3, 'three positions recorded');
assert.ok(Math.abs(s[2].alpha - 1) < 1e-9, 'the newest point is fully opaque');
assert.ok(s[0].alpha < s[2].alpha, 'older points are fainter');
// After the lifetime, everything has expired.
assert.equal(t.sample(1300).length, 0, 'points older than trailMs are dropped');
// Micro-jitter while effectively still doesn't pile up points.
const j = createTrail({ mode: 'fade', trailMs: 1000 });
for (let i = 0; i < 20; i++) j.push?.(); // no-op guard
j.move(10, 10, 0);
j.move(10.4, 10.2, 10);
j.move(10.6, 10.1, 20);
assert.equal(j.size(), 1, 'sub-pixel jitter in a blink is coalesced to one point');
// A real move DOES add points.
j.move(60, 40, 60);
assert.equal(j.size(), 2, 'a genuine move is recorded');

// fade mode ignores scroll(); seismograph ignores move().
const f = createTrail({ mode: 'fade' });
f.scroll(0, 0, 100, 0, 0.1);
assert.equal(f.size(), 0, 'scroll() does nothing in fade mode');

// ── seismograph mode ───────────────────────────────────────────────────────────
const q = createTrail({ mode: 'seismograph', trailMs: 2000, seismoSpeed: 40 });
q.move(5, 5, 0);
assert.equal(q.size(), 0, 'move() does nothing in seismograph mode');
// The page scrolls under a still cursor → a trace is laid down and the pen advances horizontally.
q.scroll(100, 50, 20, 0, 0);      // first frame sets the rest line + pen at cursorX=100
q.scroll(100, 50, 20, 100, 0.1);  // 0.1s later
q.scroll(100, 50, -30, 200, 0.1);
const ss = q.sample(200);
assert.equal(ss.length, 3, 'each scrolled frame plots a point');
assert.ok(ss[1].x > ss[0].x && ss[2].x > ss[1].x, 'the pen advances horizontally with time');
// A downward vs upward scroll deflects the trace in opposite directions.
assert.ok(ss[2].y < ss[1].y, 'a negative scroll deflects the trace the other way');
// Points still fade out by their age.
assert.ok(ss[0].alpha < 1 && ss[2].alpha === 1, 'seismograph points fade with age too');
assert.equal(q.sample(3000).length, 0, 'and expire after trailMs');

// reset clears everything.
q.scroll(1, 1, 1, 3100, 0.1);
q.reset();
assert.equal(q.size(), 0, 'reset empties the ring');

console.log('cursorTrail: all assertions passed ✅');
