import { useState } from 'react';
import Dialog from './Dialog.jsx';
import {
  attentionScore, attentionLabel, attentionBreakdown, attentionAdvice, DEFAULT_ATTENTION,
} from '../engine/attention.js';
import { t } from '../i18n.js';

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
  const label = attentionLabel(score); // shown with t(label)
  // i18n-keys: Focused | Wavering | Distracted
  const bd = attentionBreakdown(signals);
  const advice = attentionAdvice(score, tab?.settings.wpm || 0);
  const pct = Math.round(score * 100);
  const labelClass = label === 'Focused' ? 'good' : label === 'Wavering' ? 'warn' : 'bad';

  const rows = [
    { key: 'regression', name: t('Regression bursts'), pen: bd.regression, detail: t('{n} in last {secs}s', { n: recentRegressions, secs: Math.round(DEFAULT_ATTENTION.regWindowMs / 1000) }) },
    { key: 'comprehension', name: t('Comprehension'), pen: bd.comprehension, detail: recentScores.length >= 2 ? t('{pct}% recent', { pct: Math.round((1 - bd.comprehension) * 100) }) : t('no recent checks') },
    { key: 'pace', name: t('Pace stability'), pen: bd.pace, detail: paceCv > 0 ? `CV ${paceCv.toFixed(2)}` : t('no recent pace') },
  ];

  return (
    <Dialog
      title={t('Attention Check')}
      onClose={onClose}
      width={560}
      buttons={
        <>
          <button onClick={() => force((n) => n + 1)}>{t('Refresh')}</button>
          <button onClick={onClose}>{t('Close')}</button>
        </>
      }
    >
      <div className="att-head">
        <div className={`att-score ${labelClass}`}>
          <b>{pct}%</b>
          <span>{t('focus')}</span>
        </div>
        <div className={`att-label ${labelClass}`}>{t(label)}</div>
      </div>

      <div className="att-rows">
        {rows.map((r) => (
          <div key={r.key} className="att-row">
            <span className="att-name">{r.name}</span>
            <span className="att-track">
              <span className="att-fill" style={{ width: `${Math.round(r.pen * 100)}%` }} />
            </span>
            <span className="att-detail">{r.detail}</span>
          </div>
        ))}
      </div>

      <p className="settings-note" style={{ marginTop: 10 }}>
        {advice.message
          ? `${advice.message} ${t('(e.g. ease toward {wpm} wpm).', { wpm: advice.slowTo })}`
          : t('You look engaged — keep going. Bars show what would pull focus down: a cluster of re-reads, missed comprehension checks, or jumpy pacing.')}
      </p>
      <p className="settings-note" style={{ marginTop: 4 }}>
        {t('Estimated on-device from your reading behavior — no camera, no upload. This is a soft signal, not a verdict; the adaptive pacer still controls speed.')}
      </p>
    </Dialog>
  );
}
