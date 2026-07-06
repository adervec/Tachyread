import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { allFiles } from '../state/storage.js';

function fmtTime(secs) {
  if (!secs) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
}

// Live per-file card for one OPEN tab (has a hydrated tracker). Lazy tabs (not yet loaded) show a
// lightweight line from their stored settings instead.
function OpenFileCard({ tab, active }) {
  if (tab.lazy || !tab.tracker) {
    const s = tab.settings || {};
    const pct = s.totalWords ? ((s.wordIndex / s.totalWords) * 100).toFixed(0) : '0';
    return (
      <div className={`stat-file-card${active ? ' active' : ''}`}>
        <div className="stat-file-name">{tab.fileName || s.fileName || 'Untitled'}{active ? ' ·' : ''} <span className="settings-note">not loaded — {pct}% ({s.wordIndex || 0} words in)</span></div>
      </div>
    );
  }
  const t = tab.tracker;
  return (
    <div className={`stat-file-card${active ? ' active' : ''}`}>
      <div className="stat-file-name">{tab.doc.fileName}{active && <span className="stat-active-tag"> · current</span>}</div>
      <table className="history-table">
        <tbody>
          <tr>
            <td>Coverage</td>
            <td>{(t.coverage() * 100).toFixed(1)}% ({t.readCount} / {t.wordCount} words)</td>
          </tr>
          <tr>
            <td>This session</td>
            <td>{t.sessionNewWords} new words · {fmtTime(Math.round(t.sessionActiveMs / 1000))} active · {t.sessionWpm()} WPM</td>
          </tr>
          <tr>
            <td>Reading now</td>
            <td>{t.recentWpm()} WPM</td>
          </tr>
          <tr>
            <td>Lifetime (this file)</td>
            <td>{fmtTime(Math.round(t.lifetimeActiveMs / 1000))} active · {t.lifetimeWpm()} WPM</td>
          </tr>
          <tr>
            <td>Completions</td>
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

  const today = new Date().toISOString().slice(0, 10);

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

  function wpm({ words, secs }) {
    return secs > 0 ? Math.round((words / secs) * 60) : 0;
  }

  const openTabs = tabs.filter((t) => t && (t.doc || t.lazy));

  return (
    <Dialog title="Statistics" onClose={onClose} width={640}>
      <div className="field-section">Aggregate (all files)</div>
      <table className="history-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Words read</th>
            <th>Active time</th>
            <th>Effective WPM</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Today</td><td>{todayAgg.words}</td><td>{fmtTime(todayAgg.secs)}</td><td>{wpm(todayAgg)}</td></tr>
          <tr><td>This week</td><td>{week.words}</td><td>{fmtTime(week.secs)}</td><td>{wpm(week)}</td></tr>
          <tr><td>This month</td><td>{month.words}</td><td>{fmtTime(month.secs)}</td><td>{wpm(month)}</td></tr>
          <tr><td>All time</td><td>{all.words}</td><td>{fmtTime(all.secs)}</td><td>{wpm(all)}</td></tr>
        </tbody>
      </table>

      <div className="field-section">Open files ({openTabs.length})</div>
      {openTabs.length === 0 && <p className="settings-note">No files open.</p>}
      {openTabs.map((t) => (
        <OpenFileCard key={t.id} tab={t} active={t.id === activeTabId} />
      ))}

      <p className="settings-note">
        “Effective WPM” = unique new words read per active minute (excludes idle, skips, and
        re-reads). “Reading now” is your pace over the last ~30s of active reading.
      </p>
    </Dialog>
  );
}

function withinDays(dateStr, n) {
  if (!dateStr) return false;
  const then = new Date(dateStr).getTime();
  return Date.now() - then <= n * 24 * 3600 * 1000;
}
