import { useEffect, useRef, useState } from 'react';
import { makeClozeProbe } from '../engine/clozeProbe.js';
import { adaptWpm } from '../engine/adaptivePacer.js';

// Comprehension-gated adaptive pacing. While "Adaptive" is on and the reader is playing forward, this
// fires a quick auto-generated cloze check every ~PROBE_EVERY words: it pauses, asks the reader to fill a
// blank from the text they just covered, then nudges WPM up (passed) or down (missed) and resumes. The
// playback driver already reads settings.wpm, so we only have to patch wpm — no engine changes.
const PROBE_EVERY = 90; // words of forward progress between checks

export default function AdaptiveProbe({ tab, playing, onPause, onResume, onSetWpm }) {
  const [probe, setProbe] = useState(null);
  const [picked, setPicked] = useState(null);
  const lastRef = useRef(tab?.settings.wordIndex || 0);
  const streakRef = useRef(0);
  const enabled = !!tab?.settings.adaptivePace;
  const wi = tab?.settings.wordIndex || 0;

  // Reset the baseline when adaptive turns on/off or the tab changes.
  useEffect(() => {
    lastRef.current = tab?.settings.wordIndex || 0;
    streakRef.current = 0;
    setProbe(null); setPicked(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, enabled]);

  // Fire a probe once enough new words have gone by (only while actually playing forward).
  useEffect(() => {
    if (!enabled || probe || !playing) return;
    if (wi - lastRef.current < PROBE_EVERY) return;
    const from = Math.max(lastRef.current, wi - PROBE_EVERY * 2); // keep the check to recently-covered text
    const p = makeClozeProbe(tab.doc, from, wi);
    if (!p) { lastRef.current = wi; return; } // not enough content to build one — slide the window forward
    onPause();
    setProbe(p); setPicked(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wi, playing, enabled, probe]);

  if (!probe) return null;

  function finish() {
    lastRef.current = tab?.settings.wordIndex || 0;
    setProbe(null); setPicked(null);
    onResume();
  }
  function answer(i) {
    if (picked != null) return;
    setPicked(i);
    const correct = i === probe.answerIndex;
    const r = adaptWpm(tab.settings.wpm, correct, streakRef.current);
    streakRef.current = r.streak;
    setTimeout(() => { if (r.delta) onSetWpm(r.wpm); finish(); }, 800); // brief right/wrong flash, then continue
  }

  return (
    <div className="adapt-probe-overlay">
      <div className="adapt-probe">
        <div className="ap-head">Quick check — which word fits the blank?</div>
        <p className="ap-sentence">
          {probe.words.map((t, k) => (t.blank
            ? <span key={k} className="ap-blank">_____</span>
            : <span key={k}>{t.w} </span>))}
        </p>
        <div className="ap-choices">
          {probe.choices.map((c, i) => (
            <button
              key={i}
              className={`ap-choice${picked != null ? (i === probe.answerIndex ? ' correct' : (i === picked ? ' wrong' : '')) : ''}`}
              onClick={() => answer(i)}
              disabled={picked != null}
            >{c}</button>
          ))}
        </div>
        <div className="ap-foot">
          <button className="ap-skip" onClick={finish} disabled={picked != null}>Skip</button>
          <span className="settings-note" style={{ margin: 0 }}>Speed adapts to your comprehension.</span>
        </div>
      </div>
    </div>
  );
}
