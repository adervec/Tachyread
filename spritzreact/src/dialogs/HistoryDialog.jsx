import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { allFiles } from '../state/storage.js';

export default function HistoryDialog({ onClose }) {
  const [files, setFiles] = useState([]);
  useEffect(() => {
    allFiles().then(setFiles);
  }, []);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const f of files) {
      for (const e of f.dailyHistory || []) {
        const cur = m.get(e.date) || { date: e.date, words: 0, secs: 0 };
        cur.words += e.wordsRead || 0;
        cur.secs += e.activeTimeSecs || 0;
        m.set(e.date, cur);
      }
    }
    return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [files]);

  return (
    <Dialog title="Reading History" onClose={onClose} width={620}>
      <table className="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Words</th>
            <th>Active time (s)</th>
            <th>WPM</th>
          </tr>
        </thead>
        <tbody>
          {byDay.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.words}</td>
              <td>{d.secs}</td>
              <td>{d.secs > 0 ? Math.round((d.words / d.secs) * 60) : 0}</td>
            </tr>
          ))}
          {byDay.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', padding: 12 }}>
                No history yet — start reading to record daily progress.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
