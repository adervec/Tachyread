import { useEffect, useState } from 'react';
import { recordSpark } from '../features/wpmSpark.js';

function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
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

  const recent = tracker ? tracker.recentWpm() : 0;
  const sessionWpm = tracker ? tracker.sessionWpm() : 0;
  const coverage = tracker ? tracker.coverageExcluding(settings.skipRanges) : 0;
  const activeMs = tracker ? tracker.sessionActiveMs : 0;
  const newWords = tracker ? tracker.sessionNewWords : 0;

  return (
    <div className="dash-stats">
      <div className="dash-stat dash-stat-hero">
        <span className="dash-num">{recent || '—'}</span>
        <span className="dash-label">Reading now (WPM)</span>
      </div>
      <div className="dash-stat">
        <span className="dash-num">{sessionWpm || '—'}</span>
        <span className="dash-label">Session efficiency (WPM)</span>
      </div>
      <div className="dash-stat">
        <span className="dash-num">
          {(coverage * 100).toFixed(1)}<span className="dash-of">%</span>
        </span>
        <span className="dash-label">Book read · {fmtDuration(activeMs)} active</span>
      </div>
      <div className="dash-stat dash-stat-row">
        <span className="dash-mini">Word {idx + 1}/{doc.words.length}</span>
        <span className="dash-mini">Line {(doc.wordToLine[idx] || 0) + 1}/{doc.lines.length}</span>
        <span className="dash-mini">+{newWords} this session</span>
      </div>
      <div className="dash-stat dash-stat-row">
        <span className="dash-mini">Set {settings.wpm} {settings.speedUnit || 'Words'}/min</span>
      </div>
    </div>
  );
}
