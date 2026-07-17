import { useEffect, useState } from 'react';
import { recordSpark, getSpark, sparkBuckets, sparkPoints, SPARK_MAX_WPM } from '../features/wpmSpark.js';

function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Which blocks the stats chip can show. Defaults reproduce the original layout exactly; the rest
// are opt-in extras (Tab Settings → Stats chip). Shared by the settings UI so the list stays in sync.
export const STATS_CHIP_ITEMS = [
  ['recent', 'Reading now (WPM)', true],
  ['session', 'Session efficiency (WPM)', true],
  ['coverage', 'Book read % + active time', true],
  ['position', 'Word / line position + session words', true],
  ['set', 'Set speed', true],
  ['spark', 'WPM trendline (sparkline)', true],
  ['lifetime', 'Lifetime WPM', false],
  ['eta', 'Time to finish (measured pace)', false],
  ['today', 'Words read today', false],
  ['regressions', 'Regressions this session', false],
  ['steadiness', 'Pace steadiness', false],
  ['pct', 'Position %', false],
];
export function statsChipShow(settings) {
  const out = {};
  for (const [key, , def] of STATS_CHIP_ITEMS) out[key] = settings?.statsChip?.[key] ?? def;
  return out;
}

// Normalized WPM sparkline: 15s-averaged WPM over the trailing 8 minutes on a fixed 0–1400 scale
// (samples recorded once a second below). Shown wherever the stats render — docked stats and the
// floating chip alike — so the trend is visible in non-chip mode too.
export function WpmSparkline({ tabId }) {
  const [buckets, setBuckets] = useState(() => sparkBuckets(getSpark(tabId)));
  useEffect(() => {
    const id = setInterval(() => setBuckets(sparkBuckets(getSpark(tabId))), 3000);
    return () => clearInterval(id);
  }, [tabId]);
  const W = 128, H = 28;
  return (
    <div className="chip-spark" title={`15s-averaged WPM over the last 8 minutes (scale 0–${SPARK_MAX_WPM})`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line className="chip-spark-mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
        <polyline className="chip-spark-line" points={sparkPoints(buckets, W, H)} />
      </svg>
      <div className="chip-spark-axis"><span>8m</span><span>0–{SPARK_MAX_WPM}</span><span>now</span></div>
    </div>
  );
}

function steadiness(cv) {
  if (cv <= 0) return '—';
  if (cv < 0.4) return 'steady';
  if (cv < 0.8) return 'variable';
  return 'erratic';
}

// The live, measured reading-stats block — shared by the desktop dock (DashboardPane) and the
// mobile floating stats popup (FloatingStats). Ticks once a second so idle readouts stay current.
export default function ReadingStats({ tab }) {
  const { settings, doc, tracker } = tab;
  const idx = settings.wordIndex;
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setNow((n) => n + 1);
      // Feed the WPM sparkline (stats chip): one cumulative new-words sample per second, kept at
      // module level so history survives the chip being toggled while any stats view is mounted.
      if (tab.tracker) recordSpark(tab.id, tab.tracker.sessionNewWords || 0);
    }, 1000);
    return () => clearInterval(id);
  }, [tab]);

  const show = statsChipShow(settings);
  const recent = tracker ? tracker.recentWpm() : 0;
  const sessionWpm = tracker ? tracker.sessionWpm() : 0;
  const coverage = tracker ? tracker.coverageExcluding(settings.skipRanges) : 0;
  const activeMs = tracker ? tracker.sessionActiveMs : 0;
  const newWords = tracker ? tracker.sessionNewWords : 0;
  const total = doc.words.length;

  // Opt-in extras, computed only when shown.
  const lifetime = show.lifetime && tracker ? tracker.lifetimeWpm() : 0;
  let eta = null;
  if (show.eta) {
    const effWpm = recent || sessionWpm || settings.wpm;
    eta = effWpm > 0 ? ((total - idx) / effWpm) * 60000 : null;
  }
  let today = 0;
  if (show.today && tracker) {
    const key = new Date().toISOString().slice(0, 10);
    today = tracker.dailyArray().find((d) => d.date === key)?.words || 0;
  }
  const reg = show.regressions && tracker ? tracker.regressionStats() : null;
  const cv = show.steadiness && tracker ? tracker.recentPaceCv() : 0;

  return (
    <div className="dash-stats">
      {show.recent && (
        <div className="dash-stat dash-stat-hero">
          <span className="dash-num">{recent || '—'}</span>
          <span className="dash-label">Reading now (WPM)</span>
        </div>
      )}
      {show.session && (
        <div className="dash-stat">
          <span className="dash-num">{sessionWpm || '—'}</span>
          <span className="dash-label">Session efficiency (WPM)</span>
        </div>
      )}
      {show.lifetime && (
        <div className="dash-stat">
          <span className="dash-num">{lifetime || '—'}</span>
          <span className="dash-label">Lifetime WPM</span>
        </div>
      )}
      {show.coverage && (
        <div className="dash-stat">
          <span className="dash-num">
            {(coverage * 100).toFixed(1)}<span className="dash-of">%</span>
          </span>
          <span className="dash-label">Book read · {fmtDuration(activeMs)} active</span>
        </div>
      )}
      {show.eta && (
        <div className="dash-stat">
          <span className="dash-num">{eta != null ? fmtDuration(eta) : '—'}</span>
          <span className="dash-label">To finish (measured pace)</span>
        </div>
      )}
      {show.position && (
        <div className="dash-stat dash-stat-row">
          <span className="dash-mini">Word {idx + 1}/{total}</span>
          <span className="dash-mini">Line {(doc.wordToLine[idx] || 0) + 1}/{doc.lines.length}</span>
          <span className="dash-mini">+{newWords} this session</span>
        </div>
      )}
      {(show.pct || show.today || show.regressions || show.steadiness) && (
        <div className="dash-stat dash-stat-row">
          {show.pct && <span className="dash-mini">{total ? ((idx / total) * 100).toFixed(1) : '0.0'}% through</span>}
          {show.today && <span className="dash-mini">{today.toLocaleString()} today</span>}
          {show.regressions && reg && <span className="dash-mini" title="Backward re-reads this session">↩ {reg.count} ({reg.ratePer100.toFixed(1)}/100)</span>}
          {show.steadiness && <span className="dash-mini" title="Pace variability — lower is steadier">{steadiness(cv)} pace</span>}
        </div>
      )}
      {show.set && (
        <div className="dash-stat dash-stat-row">
          <span className="dash-mini">Set {settings.wpm} {settings.speedUnit || 'Words'}/min</span>
        </div>
      )}
      {show.spark && <WpmSparkline tabId={tab.id} />}
    </div>
  );
}
