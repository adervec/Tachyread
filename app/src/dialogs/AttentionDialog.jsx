import { useState } from 'react';
import Dialog from './Dialog.jsx';
import {
  attentionScore, attentionLabel, attentionBreakdown, attentionAdvice, DEFAULT_ATTENTION,
} from '../engine/attention.js';

// Attention Check — a behavioral, on-device read on whether you are still locked in, computed from
// regression bursts, recent comprehension answers, and pace instability. This is the license-clean,
// privacy-preserving stand-in for webcam gaze biofeedback (WebGazer is GPL-3.0 and webcam tracking
// is inaccurate). It only *reports* and *advises* — the adaptive pacer still owns the actual WPM.
export default function AttentionDialog({ tab, recentScores = [], onClose }) {
  const [, force] = useState(0);
  const tracker = tab?.tracker;
  const recentRegressions = tracker ? tracker.recentRegressionCount(DEFAULT_ATTENTION.regWindowMs) : 0;
  const paceCv = tracker ? tracker.recentPaceCv() : 0;
  const signals = { recentRegressions, recentScores, paceCv };

  const score = attentionScore(signals);
  const label = attentionLabel(score);
  const bd = attentionBreakdown(signals);
  const advice = attentionAdvice(score, tab?.settings.wpm || 0);
  const pct = Math.round(score * 100);
  const labelClass = label === 'Focused' ? 'good' : label === 'Wavering' ? 'warn' : 'bad';

  const rows = [
    { key: 'Regression bursts', pen: bd.regression, detail: `${recentRegressions} in last ${Math.round(DEFAULT_ATTENTION.regWindowMs / 1000)}s` },
    { key: 'Comprehension', pen: bd.comprehension, detail: recentScores.length >= 2 ? `${Math.round((1 - bd.comprehension) * 100)}% recent` : 'no recent checks' },
    { key: 'Pace stability', pen: bd.pace, detail: paceCv > 0 ? `CV ${paceCv.toFixed(2)}` : 'no recent pace' },
  ];

  return (
    <Dialog
      title="Attention Check"
      onClose={onClose}
      width={560}
      buttons={
        <>
          <button onClick={() => force((n) => n + 1)}>Refresh</button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="att-head">
        <div className={`att-score ${labelClass}`}>
          <b>{pct}%</b>
          <span>focus</span>
        </div>
        <div className={`att-label ${labelClass}`}>{label}</div>
      </div>

      <div className="att-rows">
        {rows.map((r) => (
          <div key={r.key} className="att-row">
            <span className="att-name">{r.key}</span>
            <span className="att-track">
              <span className="att-fill" style={{ width: `${Math.round(r.pen * 100)}%` }} />
            </span>
            <span className="att-detail">{r.detail}</span>
          </div>
        ))}
      </div>

      <p className="settings-note" style={{ marginTop: 10 }}>
        {advice.message
          ? advice.message + ` (e.g. ease toward ${advice.slowTo} wpm).`
          : 'You look engaged — keep going. Bars show what would pull focus down: a cluster of re-reads, missed comprehension checks, or jumpy pacing.'}
      </p>
      <p className="settings-note" style={{ marginTop: 4 }}>
        Estimated on-device from your reading behavior — no camera, no upload. This is a soft signal,
        not a verdict; the adaptive pacer still controls speed.
      </p>
    </Dialog>
  );
}
