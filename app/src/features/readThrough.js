// Read-through narration: the DSP + decisions behind "just read the book aloud".
//
// The wizard records one continuous mic session while the reader speaks chunk after chunk. This
// module owns everything decidable without a browser: where speech starts and ends in a take
// (trim), how to shorten mid-take thinking pauses (compress), and when a stretch of silence means
// "done with this chunk, move on" (auto-advance). All of it works on plain Float32 sample arrays
// so it's node-testable; the wizard just feeds it microphone blocks.
//
// ponytail: energy(RMS)-based voice detection, not a speech model — quiet rooms and normal voices
// are the target. The threshold adapts to the session's own noise floor; if breathy whispering in
// a loud café ever matters, swap adaptiveThreshold for a real VAD and keep every signature.

export const rmsOf = (samples) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
};

// Noise floor from the session's own block history: silence blocks dominate the low percentiles,
// so 3× the 20th percentile sits above the room tone and below speech. Clamped so a dead-silent
// digital mic doesn't produce a hair-trigger, nor a fan-heavy room an unreachable bar.
export function adaptiveThreshold(rmsList) {
  if (!rmsList?.length) return 0.015;
  const sorted = [...rmsList].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
  // A near-constant signal (steady dictation with no gaps yet, test tones) has no silence to learn
  // a floor from — 3×p20 would sit above everything ever heard and mute the whole session. When the
  // history is that compressed, slip the bar just under it so sound counts as speech.
  if (p95 > 0 && p95 < p20 * 2) return Math.min(0.06, Math.max(0.008, p20 * 0.8));
  return Math.min(0.06, Math.max(0.008, p20 * 3));
}

// Per-block RMS over a raw take. blockMs granularity is plenty for trim decisions.
export function blockRms(samples, sampleRate, blockMs = 50) {
  const bs = Math.max(1, Math.round((sampleRate * blockMs) / 1000));
  const out = [];
  for (let i = 0; i < samples.length; i += bs) out.push(rmsOf(samples.subarray(i, Math.min(samples.length, i + bs))));
  return out;
}

// Trim a take to its speech, keeping padMs of context on both sides. Returns null when the take
// holds no speech at all (an accidental advance, a breath) — callers must not save silence.
export function trimToSpeech(samples, sampleRate, { threshold = 0.015, blockMs = 50, padMs = 150 } = {}) {
  const rms = blockRms(samples, sampleRate, blockMs);
  let first = -1, last = -1;
  for (let i = 0; i < rms.length; i++) if (rms[i] >= threshold) { if (first < 0) first = i; last = i; }
  if (first < 0) return null;
  const bs = Math.round((sampleRate * blockMs) / 1000);
  const pad = Math.round((sampleRate * padMs) / 1000);
  const s0 = Math.max(0, first * bs - pad);
  const s1 = Math.min(samples.length, (last + 1) * bs + pad);
  return samples.slice(s0, s1);
}

// Shorten every internal silence longer than maxPauseMs down to maxPauseMs — the "clean up" for a
// sip of coffee or a lost line mid-chunk. Pauses at or under the cap are untouched, so normal
// sentence rhythm survives; only the dead air goes.
export function compressPauses(samples, sampleRate, { threshold = 0.015, blockMs = 50, maxPauseMs = 700 } = {}) {
  const rms = blockRms(samples, sampleRate, blockMs);
  const bs = Math.round((sampleRate * blockMs) / 1000);
  const keepBlocks = Math.max(1, Math.round(maxPauseMs / blockMs));
  const spans = []; // [from, to) sample ranges to keep
  let i = 0;
  while (i < rms.length) {
    if (rms[i] >= threshold) { spans.push([i * bs, Math.min(samples.length, (i + 1) * bs)]); i++; continue; }
    let j = i;
    while (j < rms.length && rms[j] < threshold) j++;
    const kept = Math.min(j - i, keepBlocks);
    spans.push([i * bs, Math.min(samples.length, (i + kept) * bs)]);
    i = j;
  }
  const total = spans.reduce((a, [f, t]) => a + (t - f), 0);
  if (total >= samples.length) return samples; // nothing compressed — hand back the original
  const out = new Float32Array(total);
  let o = 0;
  for (const [f, t] of spans) { out.set(samples.subarray(f, t), o); o += t - f; }
  return out;
}

// Trim, then compress: the whole cleanup for one committed take. Null = nothing worth saving.
export function cleanTake(samples, sampleRate, opts = {}) {
  const trimmed = trimToSpeech(samples, sampleRate, opts);
  return trimmed ? compressPauses(trimmed, sampleRate, opts) : null;
}

// How long a chunk should roughly take to read aloud. Narration runs slower than silent reading;
// 150 wpm is audiobook pace.
export const expectedMs = (wordCount, wpm = 150) => Math.max(1500, (Math.max(0, wordCount) / Math.max(60, wpm)) * 60000);

// The auto-advance decision, run continuously while recording:
//   - 'off'      → never; the reader advances by hand.
//   - 'relaxed'  → advance after ~1.6s of silence, 'eager' after ~0.9s.
// Silence alone is not enough: the reader must have spoken a meaningful share of the chunk's
// expected duration first, and a take that seems only half-read demands a longer silence — that's
// the difference between "finished the paragraph" and "hunting for my line".
export function shouldAdvance({ silenceMs = 0, speechMs = 0, expectedMs: exp = 4000, mode = 'relaxed' } = {}) {
  if (mode === 'off') return false;
  if (speechMs < Math.max(1200, exp * 0.35)) return false;
  let need = mode === 'eager' ? 900 : 1600;
  if (speechMs < exp * 0.6) need *= 1.5; // spoke suspiciously little — probably a hesitation, not the end
  return silenceMs >= need;
}

// Which chunk indices a session should visit: all of them, or only the ones without audio yet.
export function sessionQueue(chunks, isCovered, onlyUncovered = true) {
  const idx = [];
  for (let i = 0; i < (chunks?.length || 0); i++) {
    if (!onlyUncovered || !isCovered(chunks[i])) idx.push(i);
  }
  return idx;
}
