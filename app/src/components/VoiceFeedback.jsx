import { useEffect, useRef, useState } from 'react';
import { createLiveAnalyzer } from '../features/voice/liveMetrics.js';
import { voiceScores, VOICE_ATTRS } from '../features/voice/voiceScore.js';

// Live voice-quality feedback while advancing the text by reading aloud: SpeechImprover's acoustic
// scores (depth, clarity, expressiveness…) averaged over the session so far, plus a trend of the
// overall score. Pace comes from words the speech advance actually matched. Feedback only — no
// audio or scores are kept. Mic analysis is sampled ~9×/s off an AnalyserNode, not every block.
const TICK_MS = 110;
const PUBLISH_EVERY = 5; // ticks → scores refresh ~every 0.5 s
const TREND_CAP = 120;   // ~1 min of trend

export default function VoiceFeedback({ wordsRef, profile = 'neutral' }) {
  const [v, setV] = useState(null);
  const [trend, setTrend] = useState([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(true);
  const t0 = useRef(0);

  useEffect(() => {
    let stream, ctx, timer, dead = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const la = createLiveAnalyzer(ctx.sampleRate);
        const an = ctx.createAnalyser();
        an.fftSize = la.win;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(la.win);
        let n = 0;
        t0.current = performance.now();
        timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          la.pushWindow(buf, ctx.currentTime);
          if (++n % PUBLISH_EVERY) return;
          const snap = la.snapshot();
          if (!snap.voicedSamples) return;
          const mins = (performance.now() - t0.current) / 60000;
          const speechMins = mins * (1 - snap.silenceRatio);
          const wpm = wordsRef?.current && speechMins > 0.05 ? wordsRef.current / speechMins : 0;
          const next = voiceScores({ ...snap, wpm }, profile);
          if (!next) return;
          setV(next);
          setTrend((tr) => [...tr.slice(-(TREND_CAP - 1)), next.overall]);
        }, TICK_MS);
      } catch (e) {
        setErr(e?.name === 'NotAllowedError' ? 'Microphone blocked — voice feedback is off.' : `No voice feedback: ${e?.message || e}`);
      }
    })();
    return () => {
      dead = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [wordsRef, profile]);

  const W = 120, H = 26;
  const path = trend.length > 1
    ? trend.map((y, i) => `${i ? 'L' : 'M'}${((i / (trend.length - 1)) * W).toFixed(1)} ${(H - (y / 100) * H).toFixed(1)}`).join(' ')
    : '';
  return (
    <div className="vf-card" role="region" aria-label="Live voice feedback">
      <div className="vf-head">
        <span>🗣 Voice {v ? <b>{v.overall}</b> : '…'}</span>
        {path && <svg className="vf-trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Overall voice score trend"><path d={path} /></svg>}
        <button type="button" className="vf-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
      </div>
      {err && <div className="vf-note">{err}</div>}
      {open && !err && !v && <div className="vf-note">Start reading aloud — scores appear after a few seconds.</div>}
      {open && v && (
        <>
          <div className="vf-bars">
            {Object.entries(VOICE_ATTRS).map(([k, [label]]) => (v.scores[k] == null ? null : (
              <div key={k} className="vf-bar" title={`${label}: ${v.scores[k]} / 100`}>
                <span className="vf-lbl">{label}</span>
                <span className="vf-track"><span className="vf-fill" style={{ width: `${v.scores[k]}%` }} /></span>
                <span className="vf-num">{v.scores[k]}</span>
              </div>
            )))}
          </div>
          {v.weakest && <div className="vf-note">Work on <b>{VOICE_ATTRS[v.weakest][0].toLowerCase()}</b>: {VOICE_ATTRS[v.weakest][3]}</div>}
        </>
      )}
    </div>
  );
}
