// Copied from SpeechImprover (speechimprover/src/lib/analysis, commit 4a00776) — keep the two in step.
// Offline DSP analysis of a recorded utterance.
// Input: a Web Audio AudioBuffer (any sample rate / channels).
// Output: a metrics object consumed by attributes.js for scoring.
//
// All measurements are heuristic, fully local approximations — not clinical
// measurements. The UI labels them as estimates.

import { fft, nextPow2 } from './fft.js';

export const MIN_F0 = 70; // Hz
export const MAX_F0 = 400; // Hz

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

// Linear regression slope of y over x.
export function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function hzToSemitones(hz, ref) {
  if (hz <= 0 || ref <= 0) return 0;
  return 12 * Math.log2(hz / ref);
}

// Downmix to mono Float32 array.
function toMono(audioBuffer) {
  const ch = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i += 1) out[i] += data[i] / ch;
  }
  return out;
}

// Build a reusable single-window analyzer (buffers allocated once). `analyzeAt`
// returns the same per-frame feature object the offline pass builds — shared with
// the real-time liveMetrics aggregator so live and final scoring stay consistent.
export function makeFrameAnalyzer(sr, win = nextPow2(Math.round(sr * 0.045))) {
  const hop = Math.round(win / 2);
  const acN = nextPow2(win * 2); // zero-padded length for linear autocorrelation
  const minLag = Math.floor(sr / MAX_F0);
  const maxLag = Math.min(Math.ceil(sr / MIN_F0), win - 1);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  const re = new Float64Array(acN);
  const im = new Float64Array(acN);
  const sRe = new Float64Array(win);
  const sIm = new Float64Array(win);

  // Analyze the `win`-length window at signal[start..]; `t` = its start time (s).
  function analyzeAt(signal, start, t) {
    let sumSq = 0;
    let zc = 0;
    let prev = signal[start];
    for (let i = 0; i < win; i += 1) {
      const v = signal[start + i];
      sumSq += v * v;
      if (i > 0 && ((v >= 0 && prev < 0) || (v < 0 && prev >= 0))) zc += 1;
      prev = v;
    }
    const rms = Math.sqrt(sumSq / win);
    const zcr = zc / win;

    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win; i += 1) re[i] = signal[start + i];
    fft(re, im, false);
    for (let i = 0; i < acN; i += 1) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    fft(re, im, true); // re now holds autocorrelation
    const r0 = re[0] || 1e-9;
    let bestLag = 0;
    let bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      const v = re[lag];
      if (v > bestVal) { bestVal = v; bestLag = lag; }
    }
    const acStrength = bestVal / r0; // autocorrelation peak strength (0..1)
    const f0 = bestLag > 0 ? sr / bestLag : 0;

    sRe.fill(0);
    sIm.fill(0);
    for (let i = 0; i < win; i += 1) sRe[i] = signal[start + i] * hann[i];
    fft(sRe, sIm, false);
    const half = win / 2;
    let total = 0;
    let hf = 0; // 2k-6k
    let mid = 0; // 1k-2.5k
    let centroidNum = 0;
    for (let k = 1; k < half; k += 1) {
      const mag = Math.sqrt(sRe[k] * sRe[k] + sIm[k] * sIm[k]);
      const freq = (k * sr) / win;
      total += mag;
      centroidNum += freq * mag;
      if (freq >= 2000 && freq <= 6000) hf += mag;
      if (freq >= 1000 && freq <= 2500) mid += mag;
    }
    const centroid = total > 0 ? centroidNum / total : 0;

    return { t, rms, zcr, f0, acStrength, centroid, hfRatio: total > 0 ? hf / total : 0, midRatio: total > 0 ? mid / total : 0 };
  }
  return { win, hop, minLag, maxLag, analyzeAt };
}

export function analyzeAudioBuffer(audioBuffer) {
  const sr = audioBuffer.sampleRate;
  const signal = toMono(audioBuffer);
  const totalSec = signal.length / sr;

  const fa = makeFrameAnalyzer(sr);
  const { win, hop } = fa;

  const frames = [];
  let maxRms = 1e-9;
  for (let start = 0; start + win <= signal.length; start += hop) {
    const fr = fa.analyzeAt(signal, start, start / sr);
    if (fr.rms > maxRms) maxRms = fr.rms;
    frames.push(fr);
  }

  if (!frames.length) {
    return emptyMetrics(totalSec);
  }

  // --- Voicing decision ---
  const rmsGate = Math.max(maxRms * 0.08, 1e-4);
  for (const f of frames) {
    f.voiced =
      f.rms > rmsGate &&
      f.acStrength > 0.35 &&
      f.zcr < 0.25 &&
      f.f0 >= MIN_F0 &&
      f.f0 <= MAX_F0;
    f.speech = f.rms > rmsGate; // voiced or voiceless consonant energy
  }

  const voiced = frames.filter((f) => f.voiced);
  const f0s = voiced.map((f) => f.f0);
  const medianF0 = median(f0s);

  // F0 variability in semitones relative to the speaker's own median.
  const semis = f0s
    .filter((hz) => hz > 0 && medianF0 > 0)
    .map((hz) => hzToSemitones(hz, medianF0));
  const f0StdSemitones = stddev(semis);

  // --- Segment into utterances separated by pauses ---
  const frameDur = hop / sr;
  const pauseFrames = Math.max(1, Math.round(0.22 / frameDur)); // >=220ms = pause
  const utterances = [];
  let cur = null;
  let silentRun = 0;
  const pauses = [];
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    if (f.speech) {
      if (silentRun >= pauseFrames && cur) {
        pauses.push(silentRun * frameDur);
      }
      silentRun = 0;
      if (!cur) cur = { startIdx: i, endIdx: i };
      cur.endIdx = i;
    } else {
      silentRun += 1;
      if (cur && silentRun >= pauseFrames) {
        utterances.push(cur);
        cur = null;
      }
    }
  }
  if (cur) utterances.push(cur);

  // --- Terminal pitch slope (uptalk) and trailing-off (projection) ---
  const terminalSlopes = [];
  const trailingRatios = [];
  for (const u of utterances) {
    const seg = frames.slice(u.startIdx, u.endIdx + 1);
    if (seg.length < 4) continue;
    // Terminal pitch: regression over the voiced frames in the last ~40%.
    const tailStart = Math.floor(seg.length * 0.6);
    const tail = seg.slice(tailStart).filter((f) => f.voiced && f.f0 > 0);
    if (tail.length >= 3 && medianF0 > 0) {
      const xs = tail.map((f) => f.t);
      const ys = tail.map((f) => hzToSemitones(f.f0, medianF0));
      terminalSlopes.push(slope(xs, ys)); // semitones/sec, + = rising
    }
    // Trailing-off: energy in last 20% vs middle 60%.
    const last = seg.slice(Math.floor(seg.length * 0.8)).map((f) => f.rms);
    const body = seg
      .slice(Math.floor(seg.length * 0.2), Math.floor(seg.length * 0.8))
      .map((f) => f.rms);
    const mb = mean(body);
    if (mb > 0) trailingRatios.push(mean(last) / mb);
  }

  const spVoiced = voiced.length ? voiced : frames.filter((f) => f.speech);
  const meanHfRatio = mean(spVoiced.map((f) => f.hfRatio));
  const meanMidRatio = mean(spVoiced.map((f) => f.midRatio));
  const meanCentroid = mean(spVoiced.map((f) => f.centroid));
  const nasalIndex = meanMidRatio / (meanHfRatio + 0.02); // higher ~ more nasal/muffled

  const speechFrames = frames.filter((f) => f.speech).length;
  const silenceRatio = 1 - speechFrames / frames.length;

  return {
    durationSec: totalSec,
    medianF0Hz: medianF0,
    f0StdSemitones,
    meanRms: mean(spVoiced.map((f) => f.rms)),
    peakRms: maxRms,
    voicedRatio: voiced.length / frames.length,
    terminalSlope: terminalSlopes.length ? mean(terminalSlopes) : 0,
    trailingRatio: trailingRatios.length ? mean(trailingRatios) : 1,
    meanHfRatio,
    meanCentroidHz: meanCentroid,
    nasalIndex,
    pauseCount: pauses.length,
    meanPauseSec: pauses.length ? mean(pauses) : 0,
    longestPauseSec: pauses.length ? Math.max(...pauses) : 0,
    silenceRatio,
    utteranceCount: utterances.length,
  };
}

function emptyMetrics(totalSec) {
  return {
    durationSec: totalSec,
    medianF0Hz: 0,
    f0StdSemitones: 0,
    meanRms: 0,
    peakRms: 0,
    voicedRatio: 0,
    terminalSlope: 0,
    trailingRatio: 1,
    meanHfRatio: 0,
    meanCentroidHz: 0,
    nasalIndex: 0,
    pauseCount: 0,
    meanPauseSec: 0,
    longestPauseSec: 0,
    silenceRatio: 1,
    utteranceCount: 0,
  };
}
