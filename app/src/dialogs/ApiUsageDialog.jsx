import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { fmtDateTime } from '../features/dateFmt.js';
import { getApiUsage, clearApiUsage } from '../state/storage.js';
import { summarizeUsage, fmtUsd, fmtTokens } from '../features/apiPricing.js';
import { t } from '../i18n.js';

const SOURCE_LABEL = {
  'notes-summary': t('Notes — summary'), 'notes-analysis': t('Notes — analysis'), 'notes-chat': t('Notes — chat'),
  'trackyread-ai': t('Trackyread AI'), audiobook: t('Audiobook (ElevenLabs)'), ai: t('AI'),
};
const fmtWhen = (ts) => fmtDateTime(ts);

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
    <Dialog title={t('API usage & spend')} onClose={onClose} width={720} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      {!s ? <p className="settings-note">{t('Loading…')}</p> : s.calls === 0 ? (
        <p className="settings-note">{t('No API calls recorded yet. The optional Notes AI, Trackyread AI, and ElevenLabs audiobook features log their usage here once you use them with your own key.')}</p>
      ) : (
        <>
          <div className="au-cards">
            <div className="au-card">
              <div className="au-card-h">{t('Total (estimated)')}</div>
              <div className="au-card-big">{fmtUsd(s.total)}</div>
              <div className="settings-note">{t.n('{n} call', '{n} calls', s.calls)}</div>
            </div>
            <div className="au-card">
              <div className="au-card-h">🤖 Anthropic</div>
              <div className="au-card-big">{fmtUsd(s.anthropic.cost)}</div>
              <div className="settings-note">{t.n('{in} in · {out} out · {n} call', '{in} in · {out} out · {n} calls', s.anthropic.calls, { in: fmtTokens(s.anthropic.inTokens), out: fmtTokens(s.anthropic.outTokens) })}</div>
            </div>
            <div className="au-card">
              <div className="au-card-h">🔊 ElevenLabs</div>
              <div className="au-card-big">{fmtUsd(s.elevenlabs.cost)}</div>
              <div className="settings-note">{t.n('{chars} chars · {n} call', '{chars} chars · {n} calls', s.elevenlabs.calls, { chars: fmtTokens(s.elevenlabs.chars) })}</div>
            </div>
          </div>
          <p className="settings-note">{t('Costs are rough estimates from public list prices — your actual billing depends on your plan/tier. Usage is logged locally only.')}</p>

          {days.length > 0 && (
            <>
              <div className="field-section">{t('By day (estimated spend)')}</div>
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

          <div className="field-section">{t('By model')}</div>
          <table className="history-table au-table">
            <thead><tr><th>{t('Model')}</th><th>{t('Calls')}</th><th>{t('In')}</th><th>{t('Out / chars')}</th><th style={{ textAlign: 'right' }}>{t('Est.')}</th></tr></thead>
            <tbody>
              {Object.entries(s.byModel).sort((a, b) => b[1].cost - a[1].cost).map(([model, m]) => (
                <tr key={model}>
                  <td>{model}</td>
                  <td>{m.calls}</td>
                  <td>{m.provider === 'elevenlabs' ? '—' : fmtTokens(m.inTokens)}</td>
                  <td>{m.provider === 'elevenlabs' ? t('{chars} chars', { chars: fmtTokens(m.chars) }) : fmtTokens(m.outTokens)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="field-section">{t('Recent calls ({n})', { n: recent.length })}</div>
          <div className="au-log">
            {recent.map((e, i) => (
              <div key={i} className="au-log-row">
                <span className="au-log-when">{fmtWhen(e.ts)}</span>
                <span className="au-log-src">{SOURCE_LABEL[e.source] || e.source || (e.provider === 'elevenlabs' ? t('Audiobook') : t('AI'))}</span>
                <span className="au-log-detail">{e.provider === 'elevenlabs' ? t('{chars} chars', { chars: fmtTokens(e.chars) }) : t('{in}→{out} tok', { in: fmtTokens(e.inTokens), out: fmtTokens(e.outTokens) })}</span>
                <span className="au-log-cost">{fmtUsd(e.costUsd || 0)}</span>
              </div>
            ))}
          </div>

          <div className="data-row" style={{ marginTop: 10 }}>
            {confirmClear
              ? <><button className="grab-trash" onClick={clear}>⚠ {t('Confirm — clear spend history')}</button><button onClick={() => setConfirmClear(false)}>{t('Cancel')}</button></>
              : <button onClick={() => setConfirmClear(true)}>🗑 {t('Clear history')}</button>}
          </div>
        </>
      )}
    </Dialog>
  );
}
