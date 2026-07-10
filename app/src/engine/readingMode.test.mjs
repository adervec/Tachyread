// ponytail: the mode classifier's truth table — majority wins, ties go newest, live states
// override, stale events age out. Run: node src/engine/readingMode.test.mjs
import { createModeDetector, MODES } from './readingMode.js';
import assert from 'node:assert';

const T = 1_000_000;
let d = createModeDetector();

assert.equal(d.current({ now: T }), 'idle', 'no events → idle');
assert.equal(d.current({ playing: true, now: T }), 'auto', 'playing overrides');
assert.equal(d.current({ playing: true, listening: true, now: T }), 'listen', 'read-aloud beats playing');
assert.equal(d.current({ peeking: true, playing: true, now: T }), 'peek', 'peek beats everything');

d.note('line', T); d.note('line', T + 100); d.note('word', T + 200);
assert.equal(d.current({ now: T + 300 }), 'line', 'majority wins over a stray word step');

d.note('word', T + 400);
assert.equal(d.current({ now: T + 500 }), 'word', '2-2 tie → newest kind');

assert.equal(d.current({ now: T + 30000 }), 'idle', 'events age out of the window');

d = createModeDetector();
d.note('auto', T); d.note('auto', T + 100);
assert.equal(d.current({ playing: false, now: T + 200 }), 'idle', "stale 'auto' ticks don't count once paused");

d = createModeDetector();
d.note('scroll', T); d.note('scroll', T + 50); d.note('nonsense', T + 60);
assert.equal(d.current({ now: T + 100 }), 'scroll', 'unknown kinds fold into jump, not crash');

for (const k of Object.keys(MODES)) assert(MODES[k].icon && MODES[k].label && MODES[k].hint, `${k}: display entry complete`);

// idleAt: newest non-auto event + window; auto ticks and drained windows → null
d = createModeDetector();
assert.equal(d.idleAt(T), null, 'no events → no countdown');
d.note('line', T);
assert.equal(d.idleAt(T + 1000), T + 10000, 'counts down from the newest event');
d.note('word', T + 4000);
assert.equal(d.idleAt(T + 5000), T + 14000, 'a new event restarts the countdown');
d.note('auto', T + 6000);
assert.equal(d.idleAt(T + 7000), T + 14000, 'auto ticks don\'t extend it');
assert.equal(d.idleAt(T + 30000), null, 'drained window → null');
console.log('ok');
