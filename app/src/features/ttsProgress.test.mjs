// Self-check for TTS run progress: a character-weighted ETA that converges instead of swinging,
// and per-chunk health that scales with the chunk's own size.
import assert from 'node:assert/strict';
import { chunkChars, totalChars, etaSeconds, chunkHealth, fmtEta, previewText } from './ttsProgress.js';

assert.equal(chunkChars({ text: '  hello  ' }), 5);
assert.equal(chunkChars(null), 0);
assert.equal(totalChars([{ text: 'abc' }, { text: 'de' }]), 5);
assert.equal(totalChars(null), 0);

// 1000 chars in 10s = 100 chars/s; 4000 left → 40s.
assert.equal(etaSeconds({ elapsedMs: 10000, charsDone: 1000, charsTotal: 5000 }), 40);

// THE POINT: a run at a genuinely constant rate, with chunks of wildly uneven size. The estimate
// must equal the TRUE remaining time at every sample — a big chunk landing must not lurch it.
// (A count-based estimate cannot do this, which is the bug being fixed; asserted below.)
const SIZES = [20, 800, 15, 640, 30, 1200, 25, 900];
const TOTAL = SIZES.reduce((a, b) => a + b, 0);
const MS_PER_CHAR = 10; // a steady 100 chars/second
let done = 0, ms = 0, samples = 0;
const countEtas = [];
for (let i = 0; i < SIZES.length; i++) {
  done += SIZES[i];
  ms += SIZES[i] * MS_PER_CHAR;
  const eta = etaSeconds({ elapsedMs: ms, charsDone: done, charsTotal: TOTAL });
  if (eta != null) {
    const truth = (TOTAL - done) / 100;
    assert.ok(Math.abs(eta - truth) < 0.01, `sample ${i}: ${eta}s vs true ${truth}s`);
    samples++;
  }
  // What the old count-based estimate would have said at the same moment.
  countEtas.push((ms / (i + 1)) * (SIZES.length - i - 1) / 1000);
}
assert.ok(samples >= 4, 'the estimate is available for most of the run');
// The contrast: the count-based figure swings by whole multiples as chunk sizes alternate.
const swings = countEtas.slice(1).map((v, i) => Math.abs(v - countEtas[i]));
assert.ok(Math.max(...swings) > 5, 'count-based estimates really do lurch — that is the bug');

// Silent until there's enough signal — a number off one short chunk is noise.
assert.equal(etaSeconds({ elapsedMs: 500, charsDone: 50, charsTotal: 5000 }), null);
assert.equal(etaSeconds({ elapsedMs: 0, charsDone: 1000, charsTotal: 5000 }), null);
assert.equal(etaSeconds({ elapsedMs: 10000, charsDone: 5000, charsTotal: 5000 }), null, 'finished → no ETA');
assert.equal(etaSeconds({}), null);
// A caller that knows better can lower the threshold.
assert.ok(etaSeconds({ elapsedMs: 1000, charsDone: 100, charsTotal: 1000, minChars: 50 }) > 0);

// Chunk health scales with the chunk's OWN size: 5s is fine for a big paragraph, alarming for a
// three-word heading. A flat timeout would cry wolf on every long chunk.
const rate = 10; // ms per char
assert.equal(chunkHealth({ chunkElapsedMs: 5000, chunkChars: 800, msPerChar: rate }), 'ok', '8s expected');
assert.equal(chunkHealth({ chunkElapsedMs: 5000, chunkChars: 20, msPerChar: rate }), 'stalled', '0.2s expected');
assert.equal(chunkHealth({ chunkElapsedMs: 900, chunkChars: 100, msPerChar: rate }), 'ok');
assert.equal(chunkHealth({ chunkElapsedMs: 4000, chunkChars: 100, msPerChar: rate }), 'slow', '4x expected');
assert.equal(chunkHealth({ chunkElapsedMs: 12000, chunkChars: 100, msPerChar: rate }), 'stalled', '12x expected');

// No measured rate yet (the very first chunk) still catches a hang, on wall clock.
assert.equal(chunkHealth({ chunkElapsedMs: 5000, chunkChars: 100, msPerChar: 0 }), 'ok');
assert.equal(chunkHealth({ chunkElapsedMs: 25000, chunkChars: 100, msPerChar: 0 }), 'slow');
assert.equal(chunkHealth({ chunkElapsedMs: 90000, chunkChars: 100, msPerChar: 0 }), 'stalled');
assert.equal(chunkHealth({}), 'ok');

assert.equal(fmtEta(45), '45s');
assert.equal(fmtEta(95), '1m 35s');
assert.equal(fmtEta(3725), '1h 02m');
assert.equal(fmtEta(null), '—');
assert.equal(fmtEta(Infinity), '—');
assert.equal(fmtEta(-5), '—');

assert.equal(previewText('  a   b\n c '), 'a b c');
assert.equal(previewText('x'.repeat(200)).length, 90);
assert.ok(previewText('x'.repeat(200)).endsWith('…'));
assert.equal(previewText(null), '');

console.log('ttsProgress: all cases pass');
