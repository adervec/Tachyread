import { useEffect, useRef, useState } from 'react';
import { recordSpark, getSpark, sparkBuckets, sparkPoints, SPARK_MAX_WPM } from '../features/wpmSpark.js';
import { fmtDate } from '../features/dateFmt.js';
import { t, fmtNum } from '../i18n.js';

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
  ['recent', t('Reading now (WPM)'), true],
  ['session', t('Session efficiency (WPM)'), true],
  ['coverage', t('Book read % + active time'), true],
  ['position', t('Word / line position + session words'), true],
  ['set', t('Set speed'), true],
  ['spark', t('WPM trendline (sparkline)'), true],
  ['eta', t('Time to finish (measured pace)'), true], // the old timer chip lives here now
  ['autostop', t('Auto-stop countdown (⏳)'), true],  // …and its read-aloud countdown
  ['lifetime', t('Lifetime WPM'), false],
  ['today', t('Words read today'), false],
  ['regressions', t('Regressions this session'), false],
  ['steadiness', t('Pace steadiness'), false],
  ['pct', t('Position %'), false],
];
export function statsChipShow(settings) {
  const out = {};
  for (const [key, , def] of STATS_CHIP_ITEMS) out[key] = settings?.statsChip?.[key] ?? def;
  return out;
}

// When the (resizable) stats chip is too small to fit everything, blocks are sacrificed LEAST
// important first — the hero "reading now" number survives longest.
// Shown names of the speed units (the stored value stays English: it is compared in the engine).
const SPEED_UNIT_LABELS = { Words: t('Words'), Letters: t('Letters'), Syllables: t('Syllables') };

export const STATS_SACRIFICE_ORDER = ['pct', 'steadiness', 'regressions', 'today', 'lifetime', 'set', 'spark', 'autostop', 'eta', 'position', 'coverage', 'session'];

// Normalized WPM sparkline: 15s-averaged WPM over the trailing 8 minutes on a fixed 0–1400 scale
// (samples recorded once a second below). Shown wherever the stats render — docked stats and the
// floating chip alike — so the trend is visible in non-chip mode too.
export function WpmSparkline({ tabId }) {
  const [buckets, setBuckets] = useState(() => sparkBuckets(getSpark(tabId)));
  useEffect(() => {
    const id = setInterval(() => setBuckets(sparkBuckets(getSpark(tabId))), 3000);
    return () => clearInterval(id);
  }, [tabId]);
  // When the spark is given real height (the resized stats chip flexes it), earn it: labelled
  // horizontal gridlines at the finest WPM step that still leaves each band ~26px — legible or
  // nothing. At the natural 28px only the dashed midline shows, exactly as before.
  const plotRef = useRef(null);
  const [pxH, setPxH] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((es) => setPxH(Math.round(es[0]?.contentRect?.height || 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = 128, H = 28;
  let step = 0;
  for (const s of [100, 200, 350, 700]) { if (pxH / (SPARK_MAX_WPM / s) >= 26) { step = s; break; } }
  const grid = [];
  if (step) for (let v = step; v < SPARK_MAX_WPM; v += step) grid.push(v);
  return (
    <div className="chip-spark" title={t('15s-averaged WPM over the last 8 minutes (scale 0–{max})', { max: SPARK_MAX_WPM })}>
      <div className="chip-spark-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {grid.length
            ? grid.map((v) => <line key={v} className="chip-spark-mid" x1="0" x2={W} y1={H * (1 - v / SPARK_MAX_WPM)} y2={H * (1 - v / SPARK_MAX_WPM)} />)
            : <line className="chip-spark-mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />}
          <polyline className="chip-spark-line" points={sparkPoints(buckets, W, H)} />
        </svg>
        {grid.map((v) => (
          <span key={v} className="chip-spark-gl" style={{ top: `${(1 - v / SPARK_MAX_WPM) * 100}%` }}>{v}</span>
        ))}
      </div>
      <div className="chip-spark-axis"><span>{t('8m')}</span><span>0–{SPARK_MAX_WPM}</span><span>{t('now')}</span></div>
    </div>
  );
}

function steadiness(cv) {
  if (cv <= 0) return t('— pace');
  if (cv < 0.4) return t('steady pace');
  if (cv < 0.8) return t('variable pace');
  return t('erratic pace');
}

// The live, measured reading-stats block — shared by the desktop dock (DashboardPane) and the
// floating stats chip (FloatingStats). Ticks once a second so idle readouts stay current.
// `autoStopAt` (epoch-ms, 0 = none) is the read-aloud auto-stop — the old timer chip's countdown,
// merged in here. `omit` lists blocks the resized chip had to sacrifice for space.
export default function ReadingStats({ tab, autoStopAt = 0, omit = null }) {
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
  if (omit) for (const k of omit) show[k] = false;
  const recentDetail = tracker?.recentWpmDetail ? tracker.recentWpmDetail() : null;
  const recent = recentDetail ? recentDetail.wpm : (tracker ? tracker.recentWpm() : 0);
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
    const key = fmtDate(Date.now()); // LOCAL day — must match the tracker's daily bucket key
    today = tracker.dailyArray().find((d) => d.date === key)?.words || 0;
  }
  const reg = show.regressions && tracker ? tracker.regressionStats() : null;
  const cv = show.steadiness && tracker ? tracker.recentPaceCv() : 0;

  return (
    <div className="dash-stats">
      {show.recent && (
        <div
          className="dash-stat dash-stat-hero"
          title={recentDetail ? (recentDetail.scrolling
            ? t('Words ÷ attentive time over the last {secs}s (scroll mode uses the longer window — gestures are bursty). The current pause counts as reading time up to the idle grace, so pausing visibly drags this down.', { secs: recentDetail.windowSecs })
            : t('Words ÷ attentive time over the last {secs}s. The current pause counts as reading time up to the idle grace, so pausing visibly drags this down.', { secs: recentDetail.windowSecs })) : undefined}
        >
          <span className="dash-num">{recent || '—'}</span>
          <span className="dash-label">{recentDetail ? t('Reading now (WPM · last {secs}s)', { secs: recentDetail.windowSecs }) : t('Reading now (WPM · recent)')}</span>
        </div>
      )}
      {show.session && (
        <div className="dash-stat">
          <span className="dash-num">{sessionWpm || '—'}</span>
          <span className="dash-label">{t('Session efficiency (WPM)')}</span>
        </div>
      )}
      {show.lifetime && (
        <div className="dash-stat">
          <span className="dash-num">{lifetime || '—'}</span>
          <span className="dash-label">{t('Lifetime WPM')}</span>
        </div>
      )}
      {show.coverage && (
        <div className="dash-stat">
          <span className="dash-num">
            {fmtNum(coverage * 100, 1, 1)}<span className="dash-of">%</span>
          </span>
          <span className="dash-label">{t('Book read · {time} active', { time: fmtDuration(activeMs) })}</span>
        </div>
      )}
      {show.eta && (
        <div className="dash-stat">
          <span className="dash-num">{eta != null ? fmtDuration(eta) : '—'}</span>
          <span className="dash-label">{t('To finish (measured pace)')}</span>
        </div>
      )}
      {show.autostop && autoStopAt > 0 && autoStopAt > Date.now() && (
        <div className="dash-stat dash-stat-row">
          <span className="dash-mini">⏳ {t('{time} → auto-stop', { time: fmtDuration(autoStopAt - Date.now()) })}</span>
        </div>
      )}
      {show.position && (
        <div className="dash-stat dash-stat-row">
          <span className="dash-mini">{t('Word {n}/{total}', { n: idx + 1, total })}</span>
          <span className="dash-mini">{t('Line {n}/{total}', { n: (doc.wordToLine[idx] || 0) + 1, total: doc.lines.length })}</span>
          <span className="dash-mini">{t('+{n} this session', { n: newWords })}</span>
        </div>
      )}
      {(show.pct || show.today || show.regressions || show.steadiness) && (
        <div className="dash-stat dash-stat-row">
          {show.pct && <span className="dash-mini">{t('{pct}% through', { pct: fmtNum(total ? (idx / total) * 100 : 0, 1, 1) })}</span>}
          {show.today && <span className="dash-mini">{t('{n} today', { n: fmtNum(today, 0) })}</span>}
          {show.regressions && reg && <span className="dash-mini" title={t('Backward re-reads this session')}>↩ {reg.count} ({fmtNum(reg.ratePer100, 1, 1)}/100)</span>}
          {show.steadiness && <span className="dash-mini" title={t('Pace variability — lower is steadier')}>{steadiness(cv)}</span>}
        </div>
      )}
      {show.set && (
        <div className="dash-stat dash-stat-row">
          <span className="dash-mini">{t('Set {wpm} {unit}/min', { wpm: settings.wpm, unit: SPEED_UNIT_LABELS[settings.speedUnit || 'Words'] || settings.speedUnit })}</span>
        </div>
      )}
      {show.spark && <WpmSparkline tabId={tab.id} />}
    </div>
  );
}
