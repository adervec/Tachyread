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

export default function StatisticsDialog({ tab, onClose }) {
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

  return (
    <Dialog title="Statistics" onClose={onClose} width={620}>
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

      {tab && (
        <>
          <div className="field-section">Current file: {tab.doc.fileName}</div>
          {tab.tracker && (
            <table className="history-table" style={{ marginBottom: 10 }}>
              <tbody>
                <tr>
                  <td>Book read (coverage)</td>
                  <td>
                    {(tab.tracker.coverage() * 100).toFixed(1)}% ({tab.tracker.readCount} / {tab.tracker.wordCount} words)
                  </td>
                </tr>
                <tr>
                  <td>This session</td>
                  <td>
                    {tab.tracker.sessionNewWords} new words · {fmtTime(Math.round(tab.tracker.sessionActiveMs / 1000))} active ·{' '}
                    {tab.tracker.sessionWpm()} WPM efficiency
                  </td>
                </tr>
                <tr>
                  <td>Reading now</td>
                  <td>{tab.tracker.recentWpm()} WPM</td>
                </tr>
                <tr>
                  <td>Lifetime (this file)</td>
                  <td>
                    {fmtTime(Math.round(tab.tracker.lifetimeActiveMs / 1000))} active · {tab.tracker.lifetimeWpm()} WPM efficiency
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <div>Completions: {(tab.settings.completions || []).length}</div>
          <p className="settings-note">
            “Efficiency” = unique new words read per active minute (excludes idle, skips, and
            re-reads). “Reading now” is your pace over the last ~30s of active reading.
          </p>
        </>
      )}
    </Dialog>
  );
}

function withinDays(dateStr, n) {
  if (!dateStr) return false;
  const then = new Date(dateStr).getTime();
  return Date.now() - then <= n * 24 * 3600 * 1000;
}
