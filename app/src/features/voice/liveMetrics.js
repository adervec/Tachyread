// Copied from SpeechImprover (speechimprover/src/lib/analysis, commit 4a00776) — keep the two in step.
// Real-time speech metrics: a streaming aggregator fed one analysis window at a
// time (pulled from the recorder's AnalyserNode a few times a second). It produces
// the SAME metric fields the offline pass does, so the live dashboard can score
// each attribute with the very same attributes.js score() functions — live feedback
// and the final report stay consistent.
//
// Frames arrive sampled (not contiguous), so segmentation is time-based off each
// window's timestamp rather than a fixed hop. Terminal slope (uptalk) and trailing
// ratio (projection) are honest live approximations. Transcript-derived metrics
// (pace, fillers, richness) come from analyzeTranscript() and are merged by the caller.

import {
  makeFrameAnalyzer, MIN_F0, MAX_F0, median, mean, stddev, slope, hzToSemitones,
} from './audioAnalysis.js';

const PAUSE_SEC = 0.22; // silence this long ends an utterance / counts as a pause
const HISTORY_CAP = 140; // rolling per-window trace (~15s at the ~110ms sampling cadence)

export function createLiveAnalyzer(sr) {
  const fa = makeFrameAnalyzer(sr);
  const history = []; // { t, rms, f0 (0 = unvoiced), speech } — powers the live waveform

  const f0s = []; // voiced pitches (Hz)
  let hfSum = 0;
  let midSum = 0;
  let rmsSum = 0;
  let speechCount = 0;
  let voicedCount = 0;
  let total = 0;
  let maxRms = 1e-9;

  // Time-based utterance segmentation.
  let speaking = false;
  let silentStartT = 0;
  let pauseCount = 0;
  let voicedTail = []; // {t, hz} of the current utterance
  let uttRms = []; // rms sequence of the current utterance
  const terminalSlopes = [];
  const trailingRatios = [];

  function tailSlope(points) {
    if (points.length < 3) return null;
    const tail = points.slice(Math.floor(points.length * 0.6));
    const ref = median(f0s); // semitones relative to the global median, like the offline pass
    if (tail.length < 3 || ref <= 0) return null;
    return slope(tail.map((p) => p.t), tail.map((p) => hzToSemitones(p.hz, ref)));
  }

  function finalizeUtterance() {
    const ts = tailSlope(voicedTail);
    if (ts != null) terminalSlopes.push(ts);
    if (uttRms.length >= 5) {
      const n = uttRms.length;
      const last = uttRms.slice(Math.floor(n * 0.8));
      const body = uttRms.slice(Math.floor(n * 0.2), Math.floor(n * 0.8));
      const mb = mean(body);
      if (mb > 0) trailingRatios.push(mean(last) / mb);
    }
    voicedTail = [];
    uttRms = [];
  }

  return {
    win: fa.win,

    pushWindow(buffer, t) {
      const fr = fa.analyzeAt(buffer, 0, t);
      total += 1;
      if (fr.rms > maxRms) maxRms = fr.rms;
      const gate = Math.max(maxRms * 0.08, 1e-4);
      const speech = fr.rms > gate;
      const voiced = speech && fr.acStrength > 0.35 && fr.zcr < 0.25 && fr.f0 >= MIN_F0 && fr.f0 <= MAX_F0;

      history.push({ t, rms: fr.rms, f0: voiced ? fr.f0 : 0, speech });
      if (history.length > HISTORY_CAP) history.shift();

      if (speech) {
        speechCount += 1;
        hfSum += fr.hfRatio;
        midSum += fr.midRatio;
        rmsSum += fr.rms;
        speaking = true;
        silentStartT = 0;
        uttRms.push(fr.rms);
        if (voiced) { voicedCount += 1; f0s.push(fr.f0); voicedTail.push({ t, hz: fr.f0 }); }
      } else if (speaking) {
        if (!silentStartT) silentStartT = t;
        if (t - silentStartT >= PAUSE_SEC) {
          pauseCount += 1;
          finalizeUtterance();
          speaking = false;
        }
      }
    },

    // Acoustic metrics so far (merge transcript metrics on top before scoring).
    snapshot() {
      const medianF0 = median(f0s);
      const semis = f0s.filter((hz) => hz > 0 && medianF0 > 0).map((hz) => hzToSemitones(hz, medianF0));
      const meanHfRatio = speechCount ? hfSum / speechCount : 0;
      const meanMidRatio = speechCount ? midSum / speechCount : 0;
      // include the in-flight utterance so uptalk feedback appears before the first pause
      const provisional = tailSlope(voicedTail);
      const allSlopes = provisional != null ? [...terminalSlopes, provisional] : terminalSlopes;
      return {
        medianF0Hz: medianF0,
        f0StdSemitones: stddev(semis),
        meanHfRatio,
        nasalIndex: meanMidRatio / (meanHfRatio + 0.02),
        meanRms: speechCount ? rmsSum / speechCount : 0,
        silenceRatio: total ? 1 - speechCount / total : 1,
        pauseCount,
        terminalSlope: allSlopes.length ? mean(allSlopes) : 0,
        trailingRatio: trailingRatios.length ? mean(trailingRatios) : 1,
        voicedRatio: total ? voicedCount / total : 0,
        samples: total,
        voicedSamples: voicedCount,
        history: history.slice(), // copy so React sees a fresh reference per publish
      };
    },
  };
}
