import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getApiUsage, clearApiUsage } from '../state/storage.js';
import { summarizeUsage, fmtUsd, fmtTokens } from '../features/apiPricing.js';

const SOURCE_LABEL = {
  'notes-summary': 'Notes — summary', 'notes-analysis': 'Notes — analysis', 'notes-chat': 'Notes — chat',
  'trackyread-ai': 'Trackyread AI', audiobook: 'Audiobook (ElevenLabs)', ai: 'AI',
};
const fmtWhen = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// A dashboard reviewing what the optional AI features have spent through your own API keys — Anthropic
// tokens and ElevenLabs characters — with rough cost estimates, a per-day trend, and a per-call log.
export default function ApiUsageDialog({ onClose }) {
  const [entries, setEntries] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { getApiUsage().then(setEntries).catch(() => setEntries([])); }, []);

  const s = useMemo(() => (entries ? summarizeUsage(entries) : null), [entries]);
  const days = useMemo(() => (s ? Object.entries(s.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14) : []), [s]);
  const maxDay = useMemo(() => days.reduce((m, [, d]) => Math.max(m, d.cost), 0) || 1, [days]);
  const recent = useMemo(() => (entries ? [...entries].reverse().slice(0, 60) : []), [entries]);

  async function clear() { await clearApiUsage(); setEntries([]); setConfirmClear(false); }

  return (
    <Dialog title="API usage & spend" onClose={onClose} width={720} buttons={<button onClick={onClose}>Close</button>}>
      {!s ? <p className="settings-note">Loading…</p> : s.calls === 0 ? (
        <p className="settings-note">No API calls recorded yet. The optional Notes AI, Trackyread AI, and ElevenLabs audiobook features log their usage here once you use them with your own key.</p>
      ) : (
        <>
          <div className="au-cards">
            <div className="au-card">
              <div className="au-card-h">Total (estimated)</div>
              <div className="au-card-big">{fmtUsd(s.total)}</div>
              <div className="settings-note">{s.calls} call{s.calls === 1 ? '' : 's'}</div>
            </div>
            <div className="au-card">
              <div className="au-card-h">🤖 Anthropic</div>
              <div className="au-card-big">{fmtUsd(s.anthropic.cost)}</div>
              <div className="settings-note">{fmtTokens(s.anthropic.inTokens)} in · {fmtTokens(s.anthropic.outTokens)} out · {s.anthropic.calls} call{s.anthropic.calls === 1 ? '' : 's'}</div>
            </div>
            <div className="au-card">
              <div className="au-card-h">🔊 ElevenLabs</div>
              <div className="au-card-big">{fmtUsd(s.elevenlabs.cost)}</div>
              <div className="settings-note">{fmtTokens(s.elevenlabs.chars)} chars · {s.elevenlabs.calls} call{s.elevenlabs.calls === 1 ? '' : 's'}</div>
            </div>
          </div>
          <p className="settings-note">Costs are rough estimates from public list prices — your actual billing depends on your plan/tier. Usage is logged locally only.</p>

          {days.length > 0 && (
            <>
              <div className="field-section">By day (estimated spend)</div>
              <div className="au-days">
                {days.map(([day, d]) => (
                  <div key={day} className="au-day">
                    <span className="au-day-label">{day}</span>
                    <div className="au-day-bar"><div style={{ width: `${(d.cost / maxDay) * 100}%` }} /></div>
                    <span className="au-day-cost">{fmtUsd(d.cost)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="field-section">By model</div>
          <table className="history-table au-table">
            <thead><tr><th>Model</th><th>Calls</th><th>In</th><th>Out / chars</th><th style={{ textAlign: 'right' }}>Est.</th></tr></thead>
            <tbody>
              {Object.entries(s.byModel).sort((a, b) => b[1].cost - a[1].cost).map(([model, m]) => (
                <tr key={model}>
                  <td>{model}</td>
                  <td>{m.calls}</td>
                  <td>{m.provider === 'elevenlabs' ? '—' : fmtTokens(m.inTokens)}</td>
                  <td>{m.provider === 'elevenlabs' ? fmtTokens(m.chars) + ' chars' : fmtTokens(m.outTokens)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="field-section">Recent calls ({recent.length})</div>
          <div className="au-log">
            {recent.map((e, i) => (
              <div key={i} className="au-log-row">
                <span className="au-log-when">{fmtWhen(e.ts)}</span>
                <span className="au-log-src">{SOURCE_LABEL[e.source] || e.source || (e.provider === 'elevenlabs' ? 'Audiobook' : 'AI')}</span>
                <span className="au-log-detail">{e.provider === 'elevenlabs' ? `${fmtTokens(e.chars)} chars` : `${fmtTokens(e.inTokens)}→${fmtTokens(e.outTokens)} tok`}</span>
                <span className="au-log-cost">{fmtUsd(e.costUsd || 0)}</span>
              </div>
            ))}
          </div>

          <div className="data-row" style={{ marginTop: 10 }}>
            {confirmClear
              ? <><button className="grab-trash" onClick={clear}>⚠ Confirm — clear spend history</button><button onClick={() => setConfirmClear(false)}>Cancel</button></>
              : <button onClick={() => setConfirmClear(true)}>🗑 Clear history</button>}
          </div>
        </>
      )}
    </Dialog>
  );
}
