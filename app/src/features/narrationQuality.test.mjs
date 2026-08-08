// Self-check for narration quality metrics and the cross-app log contract.
import assert from 'node:assert/strict';
import {
  takeQuality, sessionConsistency, buildNarrationLog, isNarrationLog,
  NARRATION_PROTOCOL, NARRATION_VERSION,
} from './narrationQuality.js';

const SR = 48000;
const secs = (n) => Math.round(SR * n);
function tone(nSamples, amp = 0.2) {
  const out = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR);
  return out;
}
function join(...parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// A clean take at a sane level and pace scores high with no tips.
// 8s of speech at amp 0.2 (≈ -17 dB RMS), 20 words → 150 wpm.
const good = takeQuality(tone(secs(8)), SR, { words: 20 });
assert.ok(good, 'speech must be found');
assert.equal(good.wpm, 150);
assert.ok(good.rmsDb > -20 && good.rmsDb < -14, `level ~-17dB, got ${good.rmsDb}`);
assert.equal(good.clippingPct, 0);
assert.ok(good.volumeCv < 0.2, `steady tone must have low CV, got ${good.volumeCv}`);
assert.ok(good.score >= 90, `clean take should score high, got ${good.score}: ${good.tips}`);

// Problems are detected and scored down, each with a tip a narrator can act on.
const quiet = takeQuality(tone(secs(8), 0.008), SR, { words: 20, threshold: 0.004 });
assert.ok(quiet.score < good.score, 'quiet take scores lower');
assert.ok(quiet.tips.some((t) => /quiet/i.test(t)), 'quiet tip present');

const clipped = takeQuality(tone(secs(8), 1.6), SR, { words: 20 }); // sine clamped… amp>1 clips hard
assert.ok(clipped.clippingPct > 1, `clipping detected, got ${clipped.clippingPct}%`);
assert.ok(clipped.tips.some((t) => /clip/i.test(t)));

const rushed = takeQuality(tone(secs(8)), SR, { words: 32 }); // 32 words in 8s = 240 wpm
assert.equal(rushed.wpm, 240);
assert.ok(rushed.tips.some((t) => /rush/i.test(t)));

// Uneven volume: half loud, half soft.
const uneven = takeQuality(join(tone(secs(4), 0.5), tone(secs(4), 0.04)), SR, { words: 20 });
assert.ok(uneven.volumeCv > 0.55, `CV ${uneven.volumeCv}`);
assert.ok(uneven.tips.some((t) => /volume|uneven/i.test(t)));

// Pause metrics: speech + 1s hole + speech = one internal pause; trimmed edges don't count.
const pausey = takeQuality(join(tone(secs(2)), new Float32Array(secs(1)), tone(secs(2))), SR, { words: 10 });
assert.equal(pausey.pauseCount, 1);
assert.ok(pausey.longestPauseMs >= 900 && pausey.longestPauseMs <= 1200, `~1s pause, got ${pausey.longestPauseMs}`);

// Pure silence has no quality.
assert.equal(takeQuality(new Float32Array(secs(3)), SR, { words: 5 }), null);

// Session consistency: same pace/level = steady; wandering = flagged.
const steadyTakes = [good, { ...good }, { ...good, wpm: 155 }];
const steady = sessionConsistency(steadyTakes);
assert.ok(steady.score >= 85 && steady.label === 'Very steady', `${steady.score} ${steady.label}`);
const wander = sessionConsistency([{ ...good, wpm: 100, rmsDb: -30 }, { ...good, wpm: 200, rmsDb: -12 }]);
assert.ok(wander.score < steady.score && wander.label === 'Uneven', `${wander.score} ${wander.label}`);
assert.equal(sessionConsistency([good]), null, 'one take is not a trend');
assert.equal(sessionConsistency([]), null);

// The log contract SpeechImprover depends on.
const log = buildNarrationLog({ docName: 'Moby.epub', startedAt: 1754650000000, takes: [good, rushed] });
assert.equal(log.protocol, NARRATION_PROTOCOL);
assert.equal(log.version, NARRATION_VERSION);
assert.equal(log.app, 'tachyread');
assert.equal(log.docName, 'Moby.epub');
assert.equal(log.takes.length, 2);
assert.equal(log.summary.takes, 2);
assert.ok(log.summary.totalSpeechMs > 0);
assert.equal(log.summary.avgWpm, Math.round((150 + 240) / 2));
assert.ok(log.summary.avgScore > 0);
assert.ok(isNarrationLog(log));
assert.ok(!isNarrationLog(null));
assert.ok(!isNarrationLog({ protocol: 'other', version: 1, takes: [] }));
assert.ok(!isNarrationLog({ protocol: NARRATION_PROTOCOL, version: 99, takes: [] }), 'future versions are not silently trusted');
assert.ok(JSON.stringify(log).length < 200000, 'log stays a small text file');

console.log('narrationQuality: all cases pass');
