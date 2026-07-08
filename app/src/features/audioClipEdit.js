// Trim + mixdown for the record-clip wizard. Pure array math (no Web Audio), so it's testable in
// node; the wizard hands it the decoded channel data. See audioClipEdit.demo.mjs.
import { encodeWav } from './audiobookExport.js';

// Mix the given channel Float32Arrays down to mono over [fromSec, toSec) and return the mono samples.
// Clamps the range to the buffer, averages channels, and never reads out of bounds.
export function trimMonoMix(channels, sampleRate, fromSec, toSec) {
  const ch = channels.length || 1;
  const total = channels[0]?.length || 0;
  const s0 = Math.max(0, Math.min(total, Math.floor(fromSec * sampleRate)));
  const s1 = Math.max(s0, Math.min(total, Math.ceil(toSec * sampleRate)));
  const n = s1 - s0;
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = channels[c];
    for (let i = 0; i < n; i++) out[i] += (d[s0 + i] || 0) / ch;
  }
  return out;
}

// Trim + mixdown → a 16-bit mono WAV byte array (via encodeWav).
export function encodeTrimmedWav(channels, sampleRate, fromSec, toSec) {
  return encodeWav(trimMonoMix(channels, sampleRate, fromSec, toSec), sampleRate);
}
