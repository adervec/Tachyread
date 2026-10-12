// Voice-quality scores (0–100, higher = better) from SpeechImprover's acoustic metrics — the
// attributes that need only the audio, plus pace from a known word count (narration and read-aloud
// know exactly what text was read, so no transcript is needed). Formulas copied from SpeechImprover
// speechimprover/src/lib/analysis/attributes.js (commit 4a00776) — keep the two in step.
// Honest heuristic estimates, not clinical measurements.
import { analyzeAudioBuffer } from './audioAnalysis.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const up = (v, lo, hi) => (hi === lo ? 50 : clamp(((v - lo) / (hi - lo)) * 100, 0, 100));
function band(v, lo, hi, fadeLo, fadeHi) {
  if (v >= lo && v <= hi) return 100;
  if (v < lo) return clamp(((v - fadeLo) / (lo - fadeLo)) * 100, 0, 100);
  return clamp(((fadeHi - v) / (fadeHi - hi)) * 100, 0, 100);
}
// Reference median pitch (Hz) that makes "depth" relative to the speaker's voice profile.
const depthCenter = (profile) => (profile === 'male' ? 115 : profile === 'female' ? 200 : 155);

// key → [short label, weight, score(m, profile), one coaching cue]
export const VOICE_ATTRS = {
  pace: ['Pace', 1.1, (m) => (m.wpm ? band(m.wpm, 110, 150, 60, 210) : null), 'Aim for ~110–150 wpm aloud: land each phrase’s last consonant, then breathe.'],
  clarity: ['Clarity', 1.2, (m) => up(m.meanHfRatio, 0.04, 0.18), 'Open the jaw a finger-width and finish every word ending.'],
  resonantDepth: ['Depth', 0.8, (m, p) => (m.medianF0Hz ? clamp(100 - (m.medianF0Hz / depthCenter(p) - 0.72) * 125, 0, 100) : null), 'Hum “mmm” until the sternum buzzes, then slide into speech keeping it.'],
  expressiveness: ['Expressive', 1.0, (m) => clamp(((m.f0StdSemitones - 1) / 4.5) * 100, 0, 100), 'Lift the key word of each sentence, let the rest fall.'],
  nonNasal: ['Non-nasal', 0.8, (m) => clamp(100 - (m.nasalIndex - 1.5) * 13, 25, 100), 'Lift the soft palate as at the start of a yawn; aim sound at the front teeth.'],
  noUptalk: ['No uptalk', 1.0, (m) => clamp(100 - Math.max(0, m.terminalSlope) * (100 / 6), 0, 100), 'Step the pitch down on the last word of a statement.'],
  projection: ['Projection', 1.0, (m) => clamp(0.4 * up(m.meanRms, 0.02, 0.12) + 0.6 * up(m.trailingRatio, 0.4, 0.85), 0, 100), 'Keep breath support through the last word — send it to the back wall.'],
  breath: ['Breath', 0.9, (m) => band(m.silenceRatio, 0.15, 0.45, 0.02, 0.72), 'Breathe low at commas and full stops; refill before you are empty.'],
};

// Metrics → { scores: {key: 0–100}, overall, weakest: key|null }. Attributes that can't be judged
// (no pitch found, no word count) are left out rather than guessed.
export function voiceScores(m, profile = 'neutral') {
  if (!m) return null;
  const scores = {};
  let num = 0, wsum = 0;
  for (const [k, [, w, fn]] of Object.entries(VOICE_ATTRS)) {
    const v = fn(m, profile);
    if (v == null || !isFinite(v)) continue;
    scores[k] = Math.round(v);
    num += w * v; wsum += w;
  }
  if (!wsum) return null;
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0]?.[0] || null;
  return { scores, overall: Math.round(num / wsum), weakest };
}

// Analyse a mono Float32 take. `words` (known text length) gives pace.
export function scoreSamples(samples, sampleRate, { words = 0, profile = 'neutral' } = {}) {
  const buf = { sampleRate, numberOfChannels: 1, length: samples.length, getChannelData: () => samples };
  const m = analyzeAudioBuffer(buf);
  if (!m.utteranceCount) return null; // silence has no voice
  const speechMin = (m.durationSec * (1 - m.silenceRatio)) / 60;
  return voiceScores({ ...m, wpm: words && speechMin > 0 ? words / speechMin : 0 }, profile);
}

// Average several takes' voice scores (each attribute over the takes that have it).
export function averageVoice(list) {
  const vs = (list || []).filter((v) => v?.scores);
  if (!vs.length) return null;
  const scores = {};
  for (const k of Object.keys(VOICE_ATTRS)) {
    const xs = vs.map((v) => v.scores[k]).filter((x) => x != null);
    if (xs.length) scores[k] = Math.round(xs.reduce((a, x) => a + x, 0) / xs.length);
  }
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0]?.[0] || null;
  return { scores, overall: Math.round(vs.reduce((a, v) => a + v.overall, 0) / vs.length), weakest, takes: vs.length };
}

// "Depth 72 · Clarity 60 · …" in the attribute order above.
export const voiceLine = (v) => Object.keys(VOICE_ATTRS).filter((k) => v?.scores?.[k] != null).map((k) => `${VOICE_ATTRS[k][0]} ${v.scores[k]}`).join(' · ');
