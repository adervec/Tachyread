import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { allTypingRuns, clearTypingRuns } from '../state/storage.js';

function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

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
    <svg className="tp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Net WPM and accuracy over runs">
      <path d={net} className="tp-net" />
      <path d={acc} className="tp-acc" />
    </svg>
  );
}

// Detailed typing-practice history — separate from reading history.
export default function TypingProgressDialog({ onClose }) {
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    allTypingRuns().then((r) => setRuns(r.sort((a, b) => a.ts - b.ts))).catch(() => setRuns([]));
  }, []);

  const stats = useMemo(() => {
    if (!runs || !runs.length) return null;
    const n = runs.length;
    const best = Math.max(...runs.map((r) => r.netWpm || 0));
    const avgNet = Math.round(runs.reduce((a, r) => a + (r.netWpm || 0), 0) / n);
    const avgAcc = (runs.reduce((a, r) => a + (r.accuracy || 0), 0) / n).toFixed(1);
    const errAgg = {};
    for (const r of runs) for (const [k, c] of Object.entries(r.errorKeys || {})) errAgg[k] = (errAgg[k] || 0) + c;
    const topErr = Object.entries(errAgg).sort((a, b) => b[1] - a[1]).slice(0, 14);
    return { n, best, avgNet, avgAcc, topErr };
  }, [runs]);

  async function clearAll() {
    await clearTypingRuns().catch(() => {});
    setRuns([]);
  }

  return (
    <Dialog
      title="Typing Progress"
      onClose={onClose}
      width={740}
      buttons={
        <>
          <button onClick={clearAll} disabled={!runs?.length}>Clear history</button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      {!runs && <p>Loading…</p>}
      {runs && runs.length === 0 && (
        <p className="settings-note">No typing runs yet. Open a document, then View → Typing Practice and complete a run.</p>
      )}
      {stats && (
        <>
          <div className="tp-summary">
            <Stat v={stats.best} l="best net WPM" />
            <Stat v={stats.avgNet} l="avg net WPM" />
            <Stat v={`${stats.avgAcc}%`} l="avg accuracy" />
            <Stat v={stats.n} l="runs" />
          </div>

          <div className="tp-legend"><span className="tp-lg-net">— net WPM</span> <span className="tp-lg-acc">— accuracy</span></div>
          <TpChart runs={runs} />

          <div className="tp-section">Error-prone keys</div>
          <div className="tp-keys">
            {stats.topErr.length === 0 && <span className="settings-note">No errors recorded — nice.</span>}
            {stats.topErr.map(([k, c]) => (
              <span key={k} className="tp-key">{k === ' ' ? '␣' : k} <b>{c}</b></span>
            ))}
          </div>

          <div className="tp-section">Recent runs</div>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr><th>When</th><th>Net</th><th>Gross</th><th>Acc</th><th>Words</th><th>Time</th><th>Tier</th></tr>
              </thead>
              <tbody>
                {[...runs].reverse().slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{new Date(r.ts).toLocaleString()}</td>
                    <td>{r.netWpm}</td>
                    <td>{r.grossWpm}</td>
                    <td>{r.accuracy}%</td>
                    <td>{r.words}</td>
                    <td>{fmtDur(r.durationMs)}</td>
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
