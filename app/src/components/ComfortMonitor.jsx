import { useEffect, useRef, useState } from 'react';
import { DEFAULT_COMFORT, shouldBreak, fatigueScore, backoffWpm } from '../engine/comfort.js';

// Comfort & calibration monitor. Accumulates *active* reading time (it only ticks while playing
// forward, and the playback gate already pauses on a hidden tab, so background time is never
// credited), prompts a 20-20-20 eye-rest microbreak every breakIntervalMin, and — when autoBackoff
// is on — eases the target WPM down once behavioral fatigue is high, so comprehension stays
// comfortable. A voluntary break can be taken any time via the manualSignal token
// (View → Take a Break Now).
//
// Live note: a backgrounded tab auto-pauses playback (see App's visibilitychange handler), so the
// scheduled time-on-task break only accrues while the app is the foreground tab; the voluntary
// break path and all of engine/comfort.js are driven directly in tests.
export default function ComfortMonitor({
  tab,
  playing,
  cfg,
  manualSignal,
  getRecentScores,
  onPause,
  onResume,
  onSetWpm,
}) {
  const o = { ...DEFAULT_COMFORT, ...(cfg || {}) };
  const sinceBreakRef = useRef(0); // active ms since the last break (drives scheduling)
  const sessionRef = useRef(0); // active ms this session (drives the fatigue estimate)
  const wasPlayingRef = useRef(false);
  const [brk, setBrk] = useState(null); // null | { kind, phase:'rest'|'ready', remain, eased }

  const wpm = tab?.settings.wpm || 0;
  const intervalMin = o.breakIntervalMin;

  function startBreak(kind) {
    if (brk) return;
    wasPlayingRef.current = playing;
    onPause();
    setBrk({ kind, phase: 'rest', remain: Math.max(1, Math.round(o.microbreakSec)), eased: null });
  }

  function close() {
    sinceBreakRef.current = 0; // acknowledged — don't immediately re-fire even if skipped
    const resume = wasPlayingRef.current;
    setBrk(null);
    if (resume) onResume();
  }

  // Accumulate active reading time and fire the scheduled microbreak. Ticks only while actually
  // playing forward, comfort is enabled, and no break is already showing.
  useEffect(() => {
    if (!o.enabled || !playing || brk) return;
    const id = setInterval(() => {
      sinceBreakRef.current += 1000;
      sessionRef.current += 1000;
      if (shouldBreak(sinceBreakRef.current, o)) startBreak('auto');
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, playing, brk, intervalMin]);

  // Microbreak countdown. When the rest completes, optionally ease WPM (based on accumulated
  // fatigue) and advance to the ready card.
  useEffect(() => {
    if (!brk || brk.phase !== 'rest') return;
    if (brk.remain <= 0) {
      let eased = null;
      if (o.autoBackoff) {
        const fatigue = fatigueScore(
          { readingMs: sessionRef.current, recentScores: getRecentScores?.() || [] },
          o,
        );
        const next = backoffWpm(wpm, fatigue, o);
        if (next < wpm) {
          onSetWpm(next);
          eased = next;
        }
      }
      setBrk((b) => (b ? { ...b, phase: 'ready', eased } : b));
      return;
    }
    const id = setTimeout(
      () => setBrk((b) => (b && b.phase === 'rest' ? { ...b, remain: b.remain - 1 } : b)),
      1000,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brk]);

  // Voluntary break (View → Take a Break Now). The token increments on each request; 0 = idle.
  useEffect(() => {
    if (manualSignal) startBreak('manual');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualSignal]);

  if (!brk) return null;

  const resting = brk.phase === 'rest';
  return (
    <div className="comfort-overlay">
      <div className="comfort-card">
        {resting ? (
          <>
            <div className="comfort-eyes" aria-hidden>
              👁️ 👁️
            </div>
            <div className="comfort-head">Microbreak — rest your eyes</div>
            <p className="comfort-tip">
              Look at something about <strong>20 feet (6 m)</strong> away until the timer ends.
            </p>
            <div className="comfort-count">{brk.remain}</div>
            <div className="comfort-foot">
              <button className="comfort-skip" onClick={close}>
                Skip break
              </button>
              <span className="settings-note" style={{ margin: 0 }}>
                Every {intervalMin} min of reading · keeps your eyes fresh.
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="comfort-eyes" aria-hidden>
              ✓
            </div>
            <div className="comfort-head">Eyes rested</div>
            {brk.eased ? (
              <p className="comfort-tip">
                Eased to <strong>{brk.eased} wpm</strong> to keep comprehension comfortable.
              </p>
            ) : (
              <p className="comfort-tip">Looking good — speed unchanged.</p>
            )}
            <div className="comfort-foot" style={{ justifyContent: 'center' }}>
              <button className="comfort-resume" onClick={close}>
                {wasPlayingRef.current ? 'Resume reading' : 'Back to reading'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
