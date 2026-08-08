// Self-check for the read-through session DSP: trim, pause compression, and the auto-advance
// decision — synthetic PCM in, exact expectations out.
import assert from 'node:assert/strict';
import {
  rmsOf, adaptiveThreshold, blockRms, trimToSpeech, compressPauses, cleanTake,
  expectedMs, shouldAdvance, sessionQueue,
} from './readThrough.js';

const SR = 48000;
const secs = (n) => Math.round(SR * n);
// Synthetic audio: "speech" = 440Hz tone at amplitude, "silence" = zeros (+ tiny noise floor).
function tone(nSamples, amp = 0.3) {
  const out = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) out[i] = amp * Math.sin((2 * Math.PI * 440 * i) / SR);
  return out;
}
function quiet(nSamples, amp = 0.002) {
  const out = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) out[i] = amp * (((i * 2654435761) % 1000) / 1000 - 0.5); // deterministic hiss
  return out;
}
function join(...parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// rms: a tone has energy, near-silence nearly none.
assert.ok(rmsOf(tone(secs(0.1))) > 0.15);
assert.ok(rmsOf(quiet(secs(0.1))) < 0.005);
assert.equal(rmsOf(new Float32Array(0)), 0);

// adaptive threshold sits between the room tone and speech, and stays clamped at the extremes.
const mixed = [...blockRms(quiet(secs(2)), SR), ...blockRms(tone(secs(1)), SR)];
const th = adaptiveThreshold(mixed);
assert.ok(th > rmsOf(quiet(secs(0.1))) && th < 0.15, `threshold ${th} must split hiss from speech`);
assert.equal(adaptiveThreshold([]), 0.015);
assert.ok(adaptiveThreshold([0, 0, 0, 0, 0]) >= 0.008, 'a digitally-silent mic must not produce a hair trigger');
assert.ok(adaptiveThreshold([0.5, 0.5, 0.5, 0.5, 0.5]) <= 0.06, 'a loud room must stay reachable');
// A constant signal with no silence history must still count as speech, not mute the session.
const flat = adaptiveThreshold(Array(100).fill(0.011));
assert.ok(flat < 0.011, `constant 0.011 signal needs a threshold under it, got ${flat}`);

// trim: 2s silence + 1s speech + 3s silence → roughly the speech ± padding.
const take = join(quiet(secs(2)), tone(secs(1)), quiet(secs(3)));
const trimmed = trimToSpeech(take, SR, { padMs: 150 });
assert.ok(trimmed, 'speech must be found');
const len = trimmed.length / SR;
assert.ok(len > 0.9 && len < 1.5, `trimmed to ~1.3s, got ${len.toFixed(2)}s`);
// all silence → null, never a zero-length "clip".
assert.equal(trimToSpeech(quiet(secs(4)), SR), null);
assert.equal(cleanTake(quiet(secs(4)), SR), null);

// compress: speech + 10s dead air + speech → the gap collapses to ~the cap; short gaps survive.
const gappy = join(tone(secs(1)), quiet(secs(10)), tone(secs(1)));
const squeezed = compressPauses(gappy, SR, { maxPauseMs: 700 });
const sq = squeezed.length / SR;
assert.ok(sq > 2.2 && sq < 3.4, `10s pause should shrink to ~0.7s (total ~2.7s), got ${sq.toFixed(2)}s`);
const natural = join(tone(secs(1)), quiet(secs(0.4)), tone(secs(1)));
assert.equal(compressPauses(natural, SR, { maxPauseMs: 700 }).length, natural.length, 'a 0.4s breath is rhythm, not dead air');

// cleanTake = trim + compress in one go: leading/trailing silence gone AND the internal break shortened.
const messy = join(quiet(secs(3)), tone(secs(1)), quiet(secs(8)), tone(secs(1)), quiet(secs(5)));
const clean = cleanTake(messy, SR, { maxPauseMs: 700 });
const cl = clean.length / SR;
assert.ok(cl > 2.2 && cl < 3.6, `18s messy take should clean to ~3s, got ${cl.toFixed(2)}s`);

// expected duration: audiobook pace, floored so tiny chunks aren't instant.
assert.ok(Math.abs(expectedMs(150) - 60000) < 1);
assert.equal(expectedMs(0), 1500);

// auto-advance: silence only counts once enough of the chunk has plausibly been read.
const exp = expectedMs(25); // ~10s of speech expected
assert.equal(shouldAdvance({ silenceMs: 60000, speechMs: 0, expectedMs: exp }), false, 'never advance on pure silence');
assert.equal(shouldAdvance({ silenceMs: 5000, speechMs: 1000, expectedMs: exp }), false, 'a breath of speech is not a read chunk');
assert.equal(shouldAdvance({ silenceMs: 2500, speechMs: 9000, expectedMs: exp }), true, 'finished chunk + real pause → advance');
assert.equal(shouldAdvance({ silenceMs: 1000, speechMs: 9000, expectedMs: exp, mode: 'relaxed' }), false, 'relaxed needs a longer pause');
assert.equal(shouldAdvance({ silenceMs: 1000, speechMs: 9000, expectedMs: exp, mode: 'eager' }), true, 'eager fires sooner');
assert.equal(shouldAdvance({ silenceMs: 2000, speechMs: 4500, expectedMs: exp, mode: 'relaxed' }), false, 'half-read take demands a longer silence');
assert.equal(shouldAdvance({ silenceMs: 60000, speechMs: 9000, expectedMs: exp, mode: 'off' }), false, 'off means off');

// session queue: only-uncovered narrows, order preserved.
const chunks = [{ startLine: 0 }, { startLine: 4 }, { startLine: 9 }];
const covered = (c) => c.startLine === 4;
assert.deepEqual(sessionQueue(chunks, covered, true), [0, 2]);
assert.deepEqual(sessionQueue(chunks, covered, false), [0, 1, 2]);
assert.deepEqual(sessionQueue([], covered, true), []);

console.log('readThrough: all cases pass');
