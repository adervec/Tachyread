import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSessionState } from '../state/useSessionState.js';
import Dialog from './Dialog.jsx';
import { allTypingRuns, clearTypingRuns, getJourneyAi } from '../state/storage.js';
import { sessionIdOf, reviewText } from '../features/sessionReview.js';
import { TYPING_MODE_BY_ID } from '../engine/typingModes.js';
import { fmtDateTime } from '../features/dateFmt.js';
import { typingWeekly, typingOverall } from '../features/typingStats.js';
import { typingStreak, aggregateKeys, fingerStats, keyFinger, keyWpm, handSpeed, FINGER_NAMES } from '../features/typingUpgrades.js';
import { runsCsv } from '../features/typingChallenge.js';
import { saveTextToFile } from '../features/fileSystem.js';
import { keyboardRows } from '../features/keyboards.js';
import { normalizeRuns, difficultyRows, runDifficulty, difficultyLabel, DIFFICULTY_NAMES, DIFFICULTY_TEXT } from '../features/typingDifficulty.js';
import { textMatcher, inRange, inDates, anySet } from '../features/tableFilter.js';
import { TextF, RangeF, DateF } from '../components/ColFilter.jsx';
import { t, fmtNum } from '../i18n.js';

function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

// Fill a translated sentence's {placeholders} with elements, so the emphasis survives translation.
// Pass a placeholder back as its own value (keep) to leave it for rich() to fill.
const keep = (...names) => Object.fromEntries(names.map((n) => [n, `{${n}}`]));
function rich(str, nodes) {
  return String(str).split(/\{(\w+)\}/g).map((part, i) => (i % 2 ? <Fragment key={i}>{nodes[part] ?? `{${part}}`}</Fragment> : part));
}
const fingerName = (f) => (f ? FINGER_NAMES[f] || f : '');
const deviceName = (d) => (d === 'Mobile' ? t('Mobile') : d === 'Desktop' ? t('Desktop') : d);

function Stat({ v, l }) {
  return (
    <div className="tp-stat">
      <span className="tp-v">{v}</span>
      <span className="tp-l">{l}</span>
    </div>
  );
}

// Net-WPM (and accuracy) across runs, oldest → newest.
function TpChart({ runs }) {
  if (runs.length < 2) return null;
  const W = 680, H = 90;
  const maxW = Math.max(40, ...runs.map((r) => r.netWpm || 0));
  const x = (i) => (i / (runs.length - 1)) * W;
  const net = runs.map((r, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${(H - Math.min(1, (r.netWpm || 0) / maxW) * H).toFixed(1)}`).join(' ');
  const acc = runs.map((r, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${(H - Math.min(1, (r.accuracy || 0) / 100) * H).toFixed(1)}`).join(' ');
  return (
    <svg className="tp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={t('Net WPM and accuracy over runs')}>
      <path d={net} className="tp-net" />
      <path d={acc} className="tp-acc" />
    </svg>
  );
}

// Keyboard-shaped error-rate heatmap (Keybr/TIPP10-style) from the aggregated per-key profile.
// Keys with under 5 attempts stay neutral — one early slip shouldn't paint a key red for weeks.
const HEAT_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl;', 'zxcvbnm,.'];
function KeyHeatmap({ agg, mode = 'errors' }) {
  const rates = Object.values(agg).filter((v) => v.n >= 5).map((v) => v.err / v.n);
  const maxRate = Math.max(0.02, ...rates);
  // Speed view: each key's reach-time WPM against your median — slower keys glow amber→red.
  const speeds = Object.values(agg).map((v) => keyWpm(v)).filter((x) => x != null).sort((a, b) => a - b);
  const median = speeds.length ? speeds[speeds.length >> 1] : null;
  return (
    <div className="tp-heat">
      {HEAT_ROWS.map((row, ri) => (
        <div key={ri} className="tp-heat-row" style={{ paddingLeft: ri * 12 }}>
          {[...row].map((ch) => {
            const v = agg[ch];
            const rate = v && v.n >= 5 ? v.err / v.n : null;
            const heat = rate != null ? Math.min(1, rate / maxRate) : 0;
            const w = keyWpm(v);
            const slow = w && median ? Math.max(0, Math.min(1, (median / w - 1) / 0.6)) : 0; // 60% slower than median = full colour
            const style = mode === 'speed'
              ? (w ? { background: slow > 0 ? `color-mix(in srgb, #e0861e ${Math.round(12 + slow * 70)}%, transparent)` : 'color-mix(in srgb, #2e9d4f 18%, transparent)' } : undefined)
              : (rate != null && rate > 0 ? { background: `color-mix(in srgb, #d9534f ${Math.round(12 + heat * 70)}%, transparent)` } : undefined);
            const title = mode === 'speed'
              ? (w ? t.n('{key} · ~{wpm} wpm reach speed ({n} timed keystroke) · {finger}', '{key} · ~{wpm} wpm reach speed ({n} timed keystrokes) · {finger}', v.t, { key: ch, wpm: Math.round(w), finger: fingerName(keyFinger(ch)) }) : t('{key} — no timing yet (new runs record it)', { key: ch }))
              : (v?.n ? t('{key} · {errors}/{n} errors ({pct}%) · {finger}', { key: ch, errors: v.err, n: v.n, pct: fmtNum((v.err / v.n) * 100, 1, 1), finger: fingerName(keyFinger(ch)) }) : t('{key} — not enough data yet', { key: ch }));
            return (
              <span
                key={ch}
                className={`tp-heat-key${(mode === 'speed' ? w : v?.n) ? '' : ' unused'}`}
                style={style}
                title={title}
              >
                {ch}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Detailed typing-practice history — separate from reading history.
export default function TypingProgressDialog({ keyboards = [], onClose }) {
  const [rawRuns, setRawRuns] = useState(null);
  // On by default: raw WPM tracks the text as much as the typist, so an un-normalised trend calls a
  // week of dense text a slump. The toggle is there because the raw number is still what you felt.
  const [adjust, setAdjust] = useState(true);
  const [heatMode, setHeatMode] = useState('errors'); // keyboard heatmap: errors | speed
  // Column filters: weekly summaries and recent runs (regex text · min/max numbers · from/to dates).
  const NO_WF = { week: ['', ''], runs: ['', ''], avg: ['', ''], best: ['', ''], acc: ['', ''], words: ['', ''] };
  const NO_RUNF = { when: ['', ''], mode: '', device: 'all', text: ['', ''], net: ['', ''], gross: ['', ''], acc: ['', ''], cons: ['', ''], words: ['', ''], time: ['', ''], tier: '' };
  const [wf, setWf] = useSessionState('tr-tp-wf', NO_WF);
  const [runF, setRunF] = useSessionState('tr-tp-runf', NO_RUNF);
  const setW = (k) => (v) => setWf((f) => ({ ...f, [k]: v }));
  const setR = (k) => (v) => setRunF((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    allTypingRuns().then((r) => setRawRuns(r.sort((a, b) => a.ts - b.ts))).catch(() => setRawRuns([]));
    getJourneyAi().then((ai) => setAiReviews(ai?.sessionReviews || {})).catch(() => {});
  }, []);
  const [aiReviews, setAiReviews] = useState({}); // AI session reviews (cowork), beside the app's own tier

  // Every aggregate below (chart, weekly, overall, per-keyboard) runs on this one list, so
  // normalising here switches the whole page without touching any of them.
  const runs = useMemo(() => (rawRuns && adjust ? normalizeRuns(rawRuns) : rawRuns), [rawRuns, adjust]);

  const stats = useMemo(() => {
    if (!runs || !runs.length) return null;
    const n = runs.length;
    const best = Math.max(...runs.map((r) => r.netWpm || 0));
    const avgNet = Math.round(runs.reduce((a, r) => a + (r.netWpm || 0), 0) / n);
    const avgAcc = fmtNum(runs.reduce((a, r) => a + (r.accuracy || 0), 0) / n, 1, 1);
    const errAgg = {};
    for (const r of runs) for (const [k, c] of Object.entries(r.errorKeys || {})) errAgg[k] = (errAgg[k] || 0) + c;
    const topErr = Object.entries(errAgg).sort((a, b) => b[1] - a[1]).slice(0, 14);
    const streak = typingStreak(runs, Date.now());
    const keyAgg = aggregateKeys(runs);       // per-key attempts+errors (runs since the upgrade)
    const fingers = fingerStats(keyAgg);
    const hands = handSpeed(keyAgg);
    return { n, best, avgNet, avgAcc, topErr, streak, keyAgg, fingers, hands };
  }, [runs]);

  async function clearAll() {
    await clearTypingRuns().catch(() => {});
    setRawRuns([]);
  }

  return (
    <Dialog
      title={t('Typing Progress')}
      onClose={onClose}
      width={740}
      buttons={
        <>
          <button onClick={() => saveTextToFile(runsCsv(rawRuns || []), `typing-runs-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv').catch(() => {})} disabled={!rawRuns?.length} title={t('Every run as a spreadsheet (CSV) — raw numbers, not the adjusted view')}>⬇ {t('Export CSV')}</button>
          <button onClick={clearAll} disabled={!runs?.length}>{t('Clear history')}</button>
          <button onClick={onClose}>{t('Close')}</button>
        </>
      }
    >
      {!runs && <p>{t('Loading…')}</p>}
      {runs && runs.length === 0 && (
        <p className="settings-note">{t('No typing runs yet. Open a document, then View → Typing Practice and complete a run.')}</p>
      )}
      {stats && (
        <>
          <div className="tp-summary">
            <Stat v={stats.best} l={adjust ? t('best adj WPM') : t('best net WPM')} />
            <Stat v={stats.avgNet} l={adjust ? t('avg adj WPM') : t('avg net WPM')} />
            <Stat v={`${stats.avgAcc}%`} l={t('avg accuracy')} />
            <Stat v={stats.n} l={t('runs')} />
            <Stat v={`🔥 ${stats.streak.days}`} l={t('day streak')} />
            <Stat v={fmtNum(stats.streak.todayWords)} l={t('words today')} />
          </div>

          <label className="inline-check" title={t('Price each run by the keys its text actually demanded — shift, digits and punctuation cost more than home-row prose — and report what that pace is worth on ordinary prose. Scored from the per-key profile every run already stores, so your whole history re-reads.')}>
            <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} />
            <span>{t('Normalise for text difficulty')}</span>
          </label>
          <p className="settings-note">
            {adjust
              ? t('WPM below is difficulty-adjusted: 1.00 is ordinary prose, so a numbers drill or a page of quotes and capitals no longer reads as a slump.')
              : t('Showing raw WPM — it moves with the text as much as with your hands.')}
          </p>

          <div className="tp-legend"><span className="tp-lg-net">— {adjust ? t('adjusted WPM') : t('net WPM')}</span> <span className="tp-lg-acc">— {t('accuracy')}</span></div>
          <TpChart runs={runs} />

          {(() => {
            const o = typingOverall(runs);
            if (!o) return null;
            const sign = (v) => (v > 0 ? `+${v}` : `${v}`);
            return (
              <>
                <div className="tp-section">{t('Overall progress')}</div>
                <p className="tp-overall">
                  {rich(t.n('First {runs} runs averaged {first} · latest {runs} average {last} — {delta} over {n} day.', 'First {runs} runs averaged {first} · latest {runs} average {last} — {delta} over {n} days.', o.spanDays, { runs: o.n, ...keep('first', 'last', 'delta') }), {
                    first: <b>{t('{n} WPM', { n: o.firstNet })}</b>,
                    last: <b>{t('{n} WPM', { n: o.lastNet })}</b>,
                    delta: <b className={o.deltaNet >= 0 ? 'tp-up' : 'tp-down'}>{t('{n} WPM', { n: sign(o.deltaNet) })}{o.pctNet != null ? ` (${sign(o.pctNet)}%)` : ''}</b>,
                  })}
                  {' '}{rich(t('Accuracy {first}% → {last}% ({delta}).', { first: o.firstAcc, last: o.lastAcc, ...keep('delta') }), {
                    delta: <b className={o.deltaAcc >= 0 ? 'tp-up' : 'tp-down'}>{t('{n} pts', { n: sign(o.deltaAcc) })}</b>,
                  })}
                </p>
              </>
            );
          })()}

          {(() => {
            const weekly = typingWeekly(runs);
            if (weekly.length < 1) return null;
            const sign = (v) => (v > 0 ? `+${v}` : `${v}`);
            return (
              <>
                <div className="tp-section">{t('Weekly summaries')}</div>
                <div className="tp-table-wrap">
                  <table className="tp-table">
                    <thead>
                      <tr><th>{t('Week')}</th><th>{t('Runs')}</th><th>{t('Avg net')}</th><th>{t('Δ vs prev')}</th><th>{t('Best')}</th><th>{t('Avg acc')}</th><th>{t('Words')}</th><th>{t('Time')}{anySet(wf) && <button className="ab-clearf" onClick={() => setWf(NO_WF)} title={t('Clear these filters')}>✕</button>}</th></tr>
                      <tr className="ab-filter-row">
                        <th><DateF value={wf.week} onChange={setW('week')} label={t('Week starting')} /></th>
                        <th><RangeF value={wf.runs} onChange={setW('runs')} label={t('runs')} /></th>
                        <th><RangeF value={wf.avg} onChange={setW('avg')} label={t('average net WPM')} /></th>
                        <th />
                        <th><RangeF value={wf.best} onChange={setW('best')} label={t('best WPM')} /></th>
                        <th><RangeF value={wf.acc} onChange={setW('acc')} label={t('average accuracy %')} /></th>
                        <th><RangeF value={wf.words} onChange={setW('words')} label={t('words')} unit="k" /></th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {weekly.filter((w) => inDates(w.week, ...wf.week) && inRange(w.runs, ...wf.runs) && inRange(w.avgNet, ...wf.avg) && inRange(w.best, ...wf.best) && inRange(w.avgAcc, ...wf.acc) && inRange(w.words, ...wf.words, 1000)).map((w) => (
                        <tr key={w.week}>
                          <td>{w.week} → {w.end}</td>
                          <td>{w.runs}</td>
                          <td>{w.avgNet}</td>
                          <td className={w.deltaNet == null ? '' : w.deltaNet >= 0 ? 'tp-up' : 'tp-down'}>{w.deltaNet == null ? '—' : t('{n} WPM', { n: sign(w.deltaNet) })}</td>
                          <td>{w.best}</td>
                          <td>{w.avgAcc}%</td>
                          <td>{fmtNum(w.words)}</td>
                          <td>{fmtDur(w.ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}

          {(() => {
            // Always built from the RAW runs: this table is the evidence that normalising is
            // warranted, so it has to show both numbers side by side.
            const rows = difficultyRows(rawRuns);
            if (rows.length < 2) return null; // one band is nothing to compare
            return (
              <>
                <div className="tp-section">{t('By text difficulty')}</div>
                <div className="tp-table-wrap">
                  <table className="tp-table">
                    <thead><tr><th>{t('Text')}</th><th>{t('Runs')}</th><th>{t('Difficulty')}</th><th>{t('Raw net')}</th><th>{t('Adjusted')}</th><th>{t('Best raw')}</th><th>{t('Avg acc')}</th></tr></thead>
                    <tbody>
                      {rows.map((b) => (
                        <tr key={b.band}>
                          <td>{DIFFICULTY_NAMES[b.band] || b.band}</td>
                          <td>{b.runs}</td>
                          <td>{fmtNum(b.avgDifficulty, 2, 2)}×</td>
                          <td>{b.avgNet}</td>
                          <td className={b.avgAdj >= b.avgNet ? 'tp-up' : 'tp-down'}>{b.avgAdj}</td>
                          <td>{b.best}</td>
                          <td>{b.avgAcc}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="settings-note">
                  {t('Difficulty is priced per keystroke from the run’s own key profile: home-row letters are the unit, other letters cost a little more, then punctuation, digits, and anything needing shift. 1.00× is ordinary prose.')}
                </p>
              </>
            );
          })()}

          {(() => {
            const rows = keyboardRows(runs, keyboards);
            if (rows.length < 2) return null; // one keyboard is just the summary above
            return (
              <>
                <div className="tp-section">{t('By keyboard')}</div>
                <div className="tp-table-wrap">
                  <table className="tp-table">
                    <thead><tr><th>{t('Keyboard')}</th><th>{t('Runs')}</th><th>{t('Avg net')}</th><th>{t('Best')}</th><th>{t('Avg acc')}</th><th>{t('Words')}</th></tr></thead>
                    <tbody>
                      {rows.map((k) => (
                        <tr key={k.id}>
                          <td>{k.label}</td>
                          <td>{k.runs}</td>
                          <td>{k.avgNet}</td>
                          <td>{k.best}</td>
                          <td>{k.avgAcc}%</td>
                          <td>{fmtNum(k.words)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="settings-note">{t('Rename a keyboard in Typing → Typing Settings.')}</p>
              </>
            );
          })()}

          <div className="tp-section">{t('Error-prone keys')}</div>
          <div className="tp-keys">
            {stats.topErr.length === 0 && <span className="settings-note">{t('No errors recorded — nice.')}</span>}
            {stats.topErr.map(([k, c]) => (
              <span key={k} className="tp-key">{k === ' ' ? '␣' : k} <b>{c}</b></span>
            ))}
          </div>

          {Object.keys(stats.keyAgg).length > 0 && (
            <>
              <div className="tp-section">{t('Keyboard heatmap')}
                <span className="lj-viewtoggle" role="tablist" aria-label={t('Heatmap')} style={{ marginInlineStart: 8 }}>
                  <button className={heatMode === 'errors' ? 'on' : ''} onClick={() => setHeatMode('errors')}>{t('Errors')}</button>
                  <button className={heatMode === 'speed' ? 'on' : ''} onClick={() => setHeatMode('speed')}>{t('Speed')}</button>
                </span>
              </div>
              <p className="settings-note" style={{ margin: '0 0 4px' }}>
                {t('Error rate per key across your runs — the redder, the more that key misfires under your fingers. Pick the matching row drill to work on it.')}
              </p>
              <KeyHeatmap agg={stats.keyAgg} mode={heatMode} />
              {heatMode === 'speed' && (
                <p className="settings-note" style={{ margin: '4px 0' }}>
                  {stats.hands.L && stats.hands.R
                    ? rich(Math.abs(stats.hands.L - stats.hands.R) / Math.max(stats.hands.L, stats.hands.R) > 0.1
                      ? (stats.hands.L < stats.hands.R
                        ? t('Left hand ~{left} wpm · right hand ~{right} wpm — your left hand is the slower one.', keep('left', 'right'))
                        : t('Left hand ~{left} wpm · right hand ~{right} wpm — your right hand is the slower one.', keep('left', 'right')))
                      : t('Left hand ~{left} wpm · right hand ~{right} wpm — evenly matched.', keep('left', 'right')),
                    { left: <b>{Math.round(stats.hands.L)}</b>, right: <b>{Math.round(stats.hands.R)}</b> })
                    : t('Key timing is recorded from now on — type a few runs to fill this in.')}
                  {' '}{t('Amber keys are slower than your median; 🩹 Weak spots (typing mode list) drills them.')}
                </p>
              )}
              {stats.fingers.length > 0 && (
                <div className="tp-fingers">
                  {stats.fingers.map((f) => (
                    <span key={f.finger} className={`tp-finger${f.rate > 0.08 ? ' bad' : ''}`} title={t('{errors} errors in {n} keys', { errors: f.err, n: f.n })}>
                      {fingerName(f.finger)}: <b>{fmtNum(f.rate * 100, 1, 1)}%</b>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="tp-section">{t('Recent runs')}</div>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr><th>{t('When')}</th><th>{t('Mode')}</th><th>{t('Device')}</th><th>{t('Text')}</th><th>{adjust ? t('Adj') : t('Net')}</th><th>{t('Gross')}</th><th>{t('Acc')}</th><th>{t('Consist.')}</th><th>{t('Words')}</th><th>{t('Time')}</th><th title={t('AI review from the cowork “AI review of typing runs” operation, beside the app’s own tier')}>{t('AI')}</th><th>{t('Tier')}{anySet(runF) && <button className="ab-clearf" onClick={() => setRunF(NO_RUNF)} title={t('Clear these filters')}>✕</button>}</th></tr>
                <tr className="ab-filter-row">
                  <th><DateF value={runF.when} onChange={setR('when')} label={t('Run date')} /></th>
                  <th><TextF value={runF.mode} onChange={setR('mode')} label={t('mode')} /></th>
                  <th>
                    <select value={runF.device} onChange={(e) => setR('device')(e.target.value)} aria-label={t('Filter by device')}>
                      <option value="all">{t('all')}</option><option value="Desktop">🖥</option><option value="Mobile">📱</option>
                    </select>
                  </th>
                  <th><RangeF value={runF.text} onChange={setR('text')} label={t('text difficulty ×')} /></th>
                  <th><RangeF value={runF.net} onChange={setR('net')} label={t('net WPM')} /></th>
                  <th><RangeF value={runF.gross} onChange={setR('gross')} label={t('gross WPM')} /></th>
                  <th><RangeF value={runF.acc} onChange={setR('acc')} label={t('accuracy %')} /></th>
                  <th><RangeF value={runF.cons} onChange={setR('cons')} label={t('consistency %')} /></th>
                  <th><RangeF value={runF.words} onChange={setR('words')} label={t('words')} /></th>
                  <th><RangeF value={runF.time} onChange={setR('time')} label={t('duration')} unit={' ' + t('min')} /></th>
                  <th />
                  <th><TextF value={runF.tier} onChange={setR('tier')} label={t('tier')} /></th>
                </tr>
              </thead>
              <tbody>
                {/* Unfiltered: the latest 50. Filtered: searches every run (up to 500 shown). */}
                {[...runs].reverse().filter((r) => {
                  const mt = textMatcher(runF.mode).test, tt = textMatcher(runF.tier).test;
                  return inDates(r.ts ? new Date(r.ts).toISOString() : '', ...runF.when) && (!mt || mt(r.mode ? (TYPING_MODE_BY_ID[r.mode]?.label || r.mode) : ''))
                    && (runF.device === 'all' || r.device === runF.device) && inRange(runDifficulty(r), ...runF.text) && inRange(r.netWpm, ...runF.net)
                    && inRange(r.grossWpm, ...runF.gross) && inRange(r.accuracy, ...runF.acc) && inRange(r.consistency, ...runF.cons)
                    && inRange(r.words, ...runF.words) && inRange(r.durationMs / 60000, ...runF.time) && (!tt || tt(r.tier || ''));
                }).slice(0, anySet(runF) ? 500 : 50).map((r, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(r.ts)}{r.pb?.allTime ? ' 🏆' : r.pb?.mode ? ' 🥇' : ''}</td>
                    <td>{r.mode ? (TYPING_MODE_BY_ID[r.mode]?.label || r.mode) : '—'}</td>
                    <td>{r.device ? <span className={`tp-dev tp-dev-${String(r.device).toLowerCase()}`}>{r.device === 'Mobile' ? '📱' : '🖥'} {deviceName(r.device)}</span> : '—'}</td>
                    <td title={DIFFICULTY_TEXT[difficultyLabel(runDifficulty(r))]}>{fmtNum(runDifficulty(r), 2, 2)}×</td>
                    <td title={adjust ? t('{n} raw', { n: r.rawNetWpm }) : undefined}>{r.netWpm}</td>
                    <td>{r.grossWpm}</td>
                    <td>{r.accuracy}%</td>
                    <td>{r.consistency != null ? `${r.consistency}%` : '—'}</td>
                    <td>{r.words}</td>
                    <td>{fmtDur(r.durationMs)}</td>
                    <td>{aiReviews[sessionIdOf('typing', r.ts)] ? <details className="tp-ai"><summary>🎓 {aiReviews[sessionIdOf('typing', r.ts)].grade}</summary><div style={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{reviewText(aiReviews[sessionIdOf('typing', r.ts)])}</div></details> : '—'}</td>
                    <td>{r.tier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialog>
  );
}
