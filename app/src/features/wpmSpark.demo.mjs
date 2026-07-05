// Self-check for wpmSpark.js — run: node app/src/features/wpmSpark.demo.mjs
import assert from 'node:assert';
import { recordSpark, getSpark, sparkBuckets, sparkPoints, SPARK_BUCKETS, SPARK_SPAN_MS, SPARK_BUCKET_MS, SPARK_MAX_WPM } from './wpmSpark.js';

const T0 = 1_000_000_000; // fixed clock

// Steady 100 words per 15s window = 400 WPM in every covered bucket.
let arr = [];
for (let s = 0; s <= 480; s += 5) arr = recordSpark('t1', (s / 15) * 100, T0 + s * 1000);
const now = T0 + 480 * 1000;
const b = sparkBuckets(getSpark('t1'), now);
assert.equal(b.length, SPARK_BUCKETS, '32 buckets over 8 minutes');
assert.ok(b.slice(2, -1).every((v) => Math.abs(v - 400) <= 40), `steady read ≈400 wpm per bucket, got ${b.slice(2, 8)}`);

// Clamped to the fixed 0–1400 scale.
recordSpark('t2', 0, T0);
recordSpark('t2', 2000, T0 + 15000); // 2000 words in 15s = 8000 wpm → clamps
const b2 = sparkBuckets(getSpark('t2'), T0 + 15000);
assert.equal(Math.max(...b2), SPARK_MAX_WPM, 'clamped at 1400');

// Idle windows are zero; only the active window registers.
recordSpark('t3', 0, T0);
recordSpark('t3', 0, T0 + 6 * 60000);          // idle 6 min
recordSpark('t3', 75, T0 + 6 * 60000 + 15000); // then 75 words in one window = 300 wpm
const b3 = sparkBuckets(getSpark('t3'), T0 + 6 * 60000 + 15000);
assert.equal(b3.filter((v) => v > 0).length, 1, 'exactly one active bucket');
assert.equal(Math.max(...b3), 300);

// Counter reset (new session) restarts the store instead of producing a negative spike.
recordSpark('t4', 500, T0);
recordSpark('t4', 10, T0 + 5000); // went backwards
assert.equal(getSpark('t4').length, 1, 'reset on backwards counter');
assert.ok(sparkBuckets(getSpark('t4'), T0 + 5000).every((v) => v >= 0));

// Samples older than the span are pruned.
recordSpark('t5', 0, T0);
recordSpark('t5', 100, T0 + SPARK_SPAN_MS + 2 * SPARK_BUCKET_MS);
assert.equal(getSpark('t5').length, 1, 'old samples pruned');

// Points map onto the fixed scale: 1400 → y 0, 0 → y H.
const pts = sparkPoints([0, 700, 1400], 100, 28).split(' ');
assert.equal(pts[0], '0.0,28.0');
assert.equal(pts[2], '100.0,0.0');
assert.ok(pts[1].endsWith(',14.0'), '700 wpm sits mid-scale');

console.log('wpmSpark.demo: all assertions passed ✅');
