import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { allFiles } from '../state/storage.js';
import { MAX_REAL_WPM } from '../engine/readingTracker.js';
import { fmtDate } from '../features/dateFmt.js';
import { parseDay } from '../features/localDay.js';
import { t } from '../i18n.js';

function fmtTime(secs) {
  if (!secs) return t('{s}s', { s: 0 });
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h) return m ? t('{h}h {m}m {s}s', { h, m, s }) : t('{h}h {s}s', { h, s });
  return m ? t('{m}m {s}s', { m, s }) : t('{s}s', { s });
}

// Live per-file card for one OPEN tab (has a hydrated tracker). Lazy tabs (not yet loaded) show a
// lightweight line from their stored settings instead.
function OpenFileCard({ tab, active }) {
  if (tab.lazy || !tab.tracker) {
    const s = tab.settings || {};
    const pct = s.totalWords ? ((s.wordIndex / s.totalWords) * 100).toFixed(0) : '0';
    return (
      <div className={`stat-file-card${active ? ' active' : ''}`}>
        <div className="stat-file-name">{tab.fileName || s.fileName || t('Untitled')}{active ? ' ·' : ''} <span className="settings-note">{t('not loaded — {pct}% ({n} words in)', { pct, n: s.wordIndex || 0 })}</span></div>
      </div>
    );
  }
  const tr = tab.tracker;
  return (
    <div className={`stat-file-card${active ? ' active' : ''}`}>
      <div className="stat-file-name">{tab.doc.fileName}{active && <span className="stat-active-tag"> · {t('current')}</span>}</div>
      <table className="history-table">
        <tbody>
          <tr>
            <td>{t('Coverage')}</td>
            <td>{t('{pct}% ({read} / {total} words)', { pct: (tr.coverage() * 100).toFixed(1), read: tr.readCount, total: tr.wordCount })}</td>
          </tr>
          <tr>
            <td>{t('This session')}</td>
            <td>{t('{n} new words · {time} active · {wpm} WPM', { n: tr.sessionNewWords, time: fmtTime(Math.round(tr.sessionActiveMs / 1000)), wpm: tr.sessionWpm() })}</td>
          </tr>
          <tr>
            <td>{t('Reading now')}</td>
            <td>{tr.recentWpm()} WPM</td>
          </tr>
          <tr>
            <td>{t('Lifetime (this file)')}</td>
            <td>{t('{time} active · {wpm} WPM', { time: fmtTime(Math.round(tr.lifetimeActiveMs / 1000)), wpm: tr.lifetimeWpm() })}</td>
          </tr>
          <tr>
            <td>{t('Completions')}</td>
            <td>{(tab.settings.completions || []).length}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function StatisticsDialog({ tabs = [], activeTabId, onClose }) {
  const [files, setFiles] = useState([]);
  useEffect(() => {
    allFiles().then(setFiles);
  }, []);

  const today = fmtDate(Date.now()); // LOCAL day (matches the tracker's bucket keys)

  function aggregate(filterFn) {
    let words = 0, secs = 0;
    for (const f of files) {
      for (const e of f.dailyHistory || []) {
        if (filterFn(e.date)) {
          words += e.wordsRead || 0;
          secs += e.activeTimeSecs || 0;
        }
      }
    }
    return { words, secs };
  }

  const week = aggregate((d) => withinDays(d, 7));
  const month = aggregate((d) => withinDays(d, 30));
  const all = aggregate(() => true);
  const todayAgg = aggregate((d) => d === today);

  // Per-day breakdown for the trailing week (today first). Zero days still show, so gaps are visible.
  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = fmtDate(d); // LOCAL day (d is stepped by whole local days)
    last7.push({ date: key, ...aggregate((x) => x === key) });
  }

  function wpm({ words, secs }) {
    return secs > 0 ? Math.min(MAX_REAL_WPM, Math.round((words / secs) * 60)) : 0;
  }

  const openTabs = tabs.filter((tb) => tb && (tb.doc || tb.lazy));

  return (
    <Dialog title={t('Statistics')} onClose={onClose} width={640}>
      <div className="field-section">{t('Aggregate (all files)')}</div>
      <table className="history-table">
        <thead>
          <tr>
            <th>{t('Period')}</th>
            <th>{t('Words read')}</th>
            <th>{t('Active time')}</th>
            <th>{t('Effective WPM')}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>{t('Today')}</td><td>{todayAgg.words}</td><td>{fmtTime(todayAgg.secs)}</td><td>{wpm(todayAgg)}</td></tr>
          <tr><td>{t('This week')}</td><td>{week.words}</td><td>{fmtTime(week.secs)}</td><td>{wpm(week)}</td></tr>
          <tr><td>{t('This month')}</td><td>{month.words}</td><td>{fmtTime(month.secs)}</td><td>{wpm(month)}</td></tr>
          <tr><td>{t('All time')}</td><td>{all.words}</td><td>{fmtTime(all.secs)}</td><td>{wpm(all)}</td></tr>
        </tbody>
      </table>

      <div className="field-section">{t('Last 7 days')}</div>
      <table className="history-table">
        <thead>
          <tr>
            <th>{t('Day')}</th>
            <th>{t('Words read')}</th>
            <th>{t('Active time')}</th>
            <th>{t('Effective WPM')}</th>
          </tr>
        </thead>
        <tbody>
          {last7.map((d) => (
            <tr key={d.date} className={d.words || d.secs ? '' : 'stat-day-empty'}>
              <td>{d.date}{d.date === today ? ` · ${t('today')}` : ''}</td>
              <td>{d.words}</td>
              <td>{fmtTime(d.secs)}</td>
              <td>{wpm(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="field-section">{t('Open files ({n})', { n: openTabs.length })}</div>
      {openTabs.length === 0 && <p className="settings-note">{t('No files open.')}</p>}
      {openTabs.map((tb) => (
        <OpenFileCard key={tb.id} tab={tb} active={tb.id === activeTabId} />
      ))}

      <p className="settings-note">
        {t('“Effective WPM” = unique new words read per active minute (excludes idle, skips, and re-reads). “Reading now” is your pace over the last ~30s of active reading.')}
      </p>
    </Dialog>
  );
}

function withinDays(dateStr, n) {
  if (!dateStr) return false;
  const then = parseDay(dateStr);
  return Date.now() - then <= n * 24 * 3600 * 1000;
}
