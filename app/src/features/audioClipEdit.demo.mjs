// Self-check for trimMonoMix. Run: node app/src/features/audioClipEdit.demo.mjs
import assert from 'node:assert';
import { trimMonoMix, encodeTrimmedWav } from './audioClipEdit.js';

const sr = 10; // 10 samples/sec so 1s = 10 samples — easy to reason about
// Two channels, 20 samples (2s). L = 0.1,0.2,… ; R = -L (so mono mix = 0 everywhere).
const L = Float32Array.from({ length: 20 }, (_, i) => (i + 1) / 100);
const R = Float32Array.from({ length: 20 }, (_, i) => -(i + 1) / 100);

// Full mono mix of opposite channels ≈ 0.
const full = trimMonoMix([L, R], sr, 0, 2);
assert.equal(full.length, 20, 'full length spans the whole buffer');
assert.ok(full.every((v) => Math.abs(v) < 1e-7), 'opposite channels cancel to ~0');

// Mono of a single channel over [0.5s, 1.5s) → samples 5..14 (10 samples).
const mid = trimMonoMix([L], sr, 0.5, 1.5);
assert.equal(mid.length, 10, `trim [0.5,1.5) → 10 samples, got ${mid.length}`);
assert.ok(Math.abs(mid[0] - L[5]) < 1e-7, 'trim starts at the right sample');
assert.ok(Math.abs(mid[9] - L[14]) < 1e-7, 'trim ends at the right sample');

// Out-of-range clamps, not crashes.
assert.equal(trimMonoMix([L], sr, -5, 99).length, 20, 'over-wide range clamps to the buffer');
assert.equal(trimMonoMix([L], sr, 1.5, 0.5).length, 0, 'inverted range → empty (start>end clamps to 0)');

// WAV byte length = 44-byte header + 2 bytes/sample.
const wav = encodeTrimmedWav([L], sr, 0.5, 1.5);
assert.equal(wav.length, 44 + 10 * 2, `WAV = header + 10*2 bytes, got ${wav.length}`);
assert.equal(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), 'RIFF', 'WAV starts with RIFF');

console.log('audioClipEdit.demo: all assertions passed ✅');
