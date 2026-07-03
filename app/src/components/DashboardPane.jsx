import { useEffect, useMemo, useState } from 'react';
import Face from './Face.jsx';

function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Dedicated pane for the animated reader faces and live, measured reading stats — kept
// separate from the RSVP word display so each can be sized / hidden independently.
export default function DashboardPane({ tab, dock = false, showFaces = true }) {
  const { settings, doc } = tab;
  const idx = settings.wordIndex;
  const tracker = tab.tracker;

  // Re-render once a second so the live WPM/active-time readouts stay current while idle.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lineProgress = useMemo(() => {
    const li = doc.wordToLine[idx] ?? 0;
    const start = doc.lines[li]?.startWordIndex ?? 0;
    const end = li + 1 < doc.lines.length ? doc.lines[li + 1].startWordIndex : doc.words.length;
    const count = Math.max(2, end - start);
    return (idx - start) / (count - 1);
  }, [doc, idx]);

  const count = Math.max(1, Math.min(3, settings.faceCount || 1));
  const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];

  const recent = tracker ? tracker.recentWpm() : 0;
  const sessionWpm = tracker ? tracker.sessionWpm() : 0;
  const coverage = tracker ? tracker.coverageExcluding(settings.skipRanges) : 0;
  const activeMs = tracker ? tracker.sessionActiveMs : 0;
  const newWords = tracker ? tracker.sessionNewWords : 0;

  return (
    <div className={`dashboard-pane${dock ? ' dock' : ''}`}>
      {showFaces && settings.showEyes && (
        <div className="rsvp-faces">
          {Array.from({ length: count }, (_, i) => (
            <Face
              key={i}
              wpm={recent || settings.wpm}
              lineProgress={lineProgress}
              faceStyle={styles[i] || 'Man'}
              artStyle={settings.artStyle || 'Cartoon'}
              size={dock ? 72 : 120}
            />
          ))}
        </div>
      )}

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
    </div>
  );
}
