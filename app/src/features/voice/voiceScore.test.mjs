import assert from 'node:assert/strict';
import { scoreSamples, voiceScores, averageVoice, voiceLine } from './voiceScore.js';
import { createLiveAnalyzer } from './liveMetrics.js';

// Synthetic "speech": 120 Hz voiced bursts with a gliding pitch, separated by short pauses.
const sr = 16000;
const sig = new Float32Array(sr * 6);
for (let i = 0; i < sig.length; i++) {
  const t = i / sr, inBurst = (t % 1.5) < 1.1;
  const hz = 110 + 30 * Math.sin(t * 2);
  sig[i] = inBurst ? 0.2 * Math.sin(2 * Math.PI * hz * t) + 0.05 * Math.sin(2 * Math.PI * hz * 3 * t) : 0;
}
const v = scoreSamples(sig, sr, { words: 12, profile: 'male' });
assert.ok(v, 'a voiced take scores');
for (const k of ['clarity', 'resonantDepth', 'expressiveness', 'projection', 'breath', 'pace']) assert.ok(v.scores[k] >= 0 && v.scores[k] <= 100, k);
assert.ok(v.overall >= 0 && v.overall <= 100);
// Depth is relative to the profile: the same 120 Hz voice sounds deeper for "female" than "male".
assert.ok(scoreSamples(sig, sr, { profile: 'female' }).scores.resonantDepth > v.scores.resonantDepth);
// No word count → no pace score (not guessed).
assert.equal(scoreSamples(sig, sr).scores.pace, undefined);
// Silence has no voice.
assert.equal(scoreSamples(new Float32Array(sr), sr), null);
assert.equal(voiceScores(null), null);

// The live analyzer produces metrics the same scorer accepts.
const la = createLiveAnalyzer(sr);
for (let s = 0; s + la.win <= sig.length; s += la.win) la.pushWindow(sig.subarray(s, s + la.win), s / sr);
const live = voiceScores(la.snapshot(), 'male');
assert.ok(live && live.scores.resonantDepth != null && live.scores.expressiveness != null);
// Averaging takes + the one-line summary.
const avg = averageVoice([{ scores: { clarity: 40, breath: 90 }, overall: 60 }, { scores: { clarity: 60 }, overall: 70 }, null]);
assert.deepEqual(avg.scores, { clarity: 50, breath: 90 });
assert.equal(avg.overall, 65);
assert.equal(avg.weakest, 'clarity');
assert.equal(voiceLine(avg), 'Clarity 50 · Breath 90');
assert.equal(averageVoice([]), null);
console.log('voiceScore: all cases pass');
