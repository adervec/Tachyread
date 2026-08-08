// Narration quality: what a take sounds like, in numbers a narrator can act on.
//
// Computed from the same Float32 samples the read-through session already holds (and from any
// decoded clip), so it works live per take AND retroactively. No ASR — level, pace, steadiness
// and clipping are what make narration listenable, and all four fall out of the PCM.
//
// The log this module builds (`buildNarrationLog`) is the cross-app contract: Tachyread writes
// `tachyread-narration-*.json` files into a user-chosen folder, and SpeechImprover watches that
// folder and counts each log as a speech-training session. Version the payload — the watcher
// checks `protocol`/`version` before trusting a file.
import { blockRms } from './readThrough.js';

export const NARRATION_PROTOCOL = 'tachyread-narration';
export const NARRATION_VERSION = 1;

const dB = (v) => (v > 0 ? Math.round(20 * Math.log10(v) * 10) / 10 : -120);

// One take → metrics + a 0–100 score + human tips. `words` is the chunk's word count (known from
// the document), which turns speech time into real narration WPM.
export function takeQuality(samples, sampleRate, { threshold = 0.015, blockMs = 50, words = 0 } = {}) {
  const rms = blockRms(samples, sampleRate, blockMs);
  const speech = rms.filter((v) => v >= threshold);
  const speechMs = speech.length * blockMs;
  if (!speech.length) return null; // silence has no quality
  const mean = speech.reduce((a, v) => a + v, 0) / speech.length;
  const sd = Math.sqrt(speech.reduce((a, v) => a + (v - mean) ** 2, 0) / speech.length);
  const volumeCv = Math.round((sd / mean) * 100) / 100;

  let peak = 0, clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= 0.985) clipped++;
  }
  const clippingPct = Math.round((clipped / samples.length) * 10000) / 100;

  // Internal pauses (silence runs ≥ 300ms between speech) — rhythm, not the trimmed-away edges.
  let pauseCount = 0, longestPauseMs = 0, run = 0, seen = false;
  for (const v of rms) {
    if (v >= threshold) {
      if (seen && run * blockMs >= 300) { pauseCount++; longestPauseMs = Math.max(longestPauseMs, run * blockMs); }
      run = 0; seen = true;
    } else run++;
  }

  const wpm = words > 0 && speechMs > 0 ? Math.round(words / (speechMs / 60000)) : null;
  const rmsDb = dB(mean);

  // Score: start perfect, subtract for each audible problem. Ranges are audiobook conventions:
  // levels around -23..-14 dB RMS, pace 120–190 wpm, volume CV under ~0.5, no clipping.
  let score = 100;
  const tips = [];
  if (clippingPct > 0.05) { score -= Math.min(35, clippingPct * 10 + 10); tips.push('Clipping — back off the mic or lower the input gain.'); }
  if (rmsDb < -34) { score -= 25; tips.push('Very quiet — move closer to the mic or speak up.'); }
  else if (rmsDb < -28) { score -= 10; tips.push('A little quiet.'); }
  else if (rmsDb > -10 && clippingPct <= 0.05) { score -= 10; tips.push('Running hot — a touch more distance.'); }
  if (volumeCv > 0.75) { score -= 20; tips.push('Volume swings a lot — keep a steady distance and delivery.'); }
  else if (volumeCv > 0.55) { score -= 8; tips.push('Slightly uneven volume.'); }
  if (wpm != null) {
    if (wpm > 210) { score -= 15; tips.push(`Rushed (${wpm} wpm) — audiobooks sit near 150.`); }
    else if (wpm > 190) { score -= 6; tips.push(`Brisk (${wpm} wpm).`); }
    else if (wpm < 100) { score -= 10; tips.push(`Slow (${wpm} wpm) — pick up the pace a little.`); }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    durationMs: Math.round((samples.length / sampleRate) * 1000),
    speechMs: Math.round(speechMs),
    wpm, rmsDb, peakDb: dB(peak), clippingPct, volumeCv,
    pauseCount, longestPauseMs: Math.round(longestPauseMs),
    score, tips,
  };
}

// Session-level consistency: how alike the takes are. Pace and level that wander take-to-take are
// what make a stitched audiobook sound recorded across different days.
export function sessionConsistency(takes) {
  const qs = (takes || []).filter((t) => t && t.wpm != null);
  if (qs.length < 2) return null;
  const cv = (vals) => {
    const m = vals.reduce((a, v) => a + v, 0) / vals.length;
    if (!m) return 0;
    return Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length) / Math.abs(m);
  };
  const wpmCv = Math.round(cv(qs.map((t) => t.wpm)) * 100) / 100;
  // Level spread in dB directly — dB is already log-domain, so a plain stddev reads naturally.
  const dbs = qs.map((t) => t.rmsDb);
  const dbMean = dbs.reduce((a, v) => a + v, 0) / dbs.length;
  const levelSpreadDb = Math.round(Math.sqrt(dbs.reduce((a, v) => a + (v - dbMean) ** 2, 0) / dbs.length) * 10) / 10;
  let score = 100;
  if (wpmCv > 0.25) score -= 30; else if (wpmCv > 0.15) score -= 12;
  if (levelSpreadDb > 6) score -= 30; else if (levelSpreadDb > 3.5) score -= 12;
  score = Math.max(0, score);
  const label = score >= 85 ? 'Very steady' : score >= 65 ? 'Steady' : 'Uneven';
  return { takes: qs.length, wpmCv, levelSpreadDb, score, label };
}

// The cross-app log file. One per read-through session, rewritten as takes accumulate so a crash
// loses nothing. SpeechImprover treats one log = one training session.
export function buildNarrationLog({ docName = '', startedAt, takes = [] }) {
  const qs = takes.filter(Boolean);
  const totalSpeechMs = qs.reduce((a, t) => a + (t.speechMs || 0), 0);
  const wpms = qs.filter((t) => t.wpm != null);
  const avg = (arr, f) => (arr.length ? arr.reduce((a, t) => a + f(t), 0) / arr.length : null);
  return {
    app: 'tachyread',
    protocol: NARRATION_PROTOCOL,
    version: NARRATION_VERSION,
    createdAt: new Date(startedAt || Date.now()).toISOString(),
    docName,
    takes: qs,
    summary: {
      takes: qs.length,
      totalDurationMs: qs.reduce((a, t) => a + (t.durationMs || 0), 0),
      totalSpeechMs,
      words: null, // per-take words aren't echoed back; wpm carries the pace
      avgWpm: wpms.length ? Math.round(avg(wpms, (t) => t.wpm)) : null,
      avgScore: qs.length ? Math.round(avg(qs, (t) => t.score)) : null,
      consistency: sessionConsistency(qs),
    },
  };
}

// Validation for anything reading a log back (SpeechImprover mirrors this check).
export const isNarrationLog = (o) =>
  !!o && o.protocol === NARRATION_PROTOCOL && o.version === NARRATION_VERSION && Array.isArray(o.takes);
