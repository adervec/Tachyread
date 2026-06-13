import { useEffect, useMemo, useState } from 'react';
import { getTocEntries, currentChapter } from '../document/toc.js';

function fmtDur(secs) {
  if (!isFinite(secs) || secs < 0) return '—';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Slim heading bar: current section name, progress within it, and time figures — elapsed in
// the section, an ETA to finish it (from your measured pace), and the estimated total.
export default function ChapterHeading({ tab, onJumpWord }) {
  const { doc, settings, tracker } = tab;
  const idx = settings.wordIndex;
  const entries = useMemo(() => getTocEntries(tab), [tab, settings.tocEntries]); // eslint-disable-line
  const chapter = useMemo(() => currentChapter(entries, idx, doc.words.length), [entries, idx, doc.words.length]);

  // Live clock so elapsed / ETA refresh while reading.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!chapter) return null;

  const pct = (chapter.progress * 100).toFixed(1);
  const num = chapter.index >= 0 ? `${chapter.index + 1}/${chapter.count}` : '—';

  const effWpm = (tracker && (tracker.recentWpm() || tracker.sessionWpm())) || settings.wpm || 250;
  const remainingWords = Math.max(0, chapter.end - idx);
  const etaSecs = effWpm > 0 ? (remainingWords / effWpm) * 60 : Infinity;
  const startedTs = (settings.tocReadStats || {})[chapter.start]?.started;
  const spentSecs = startedTs ? (Date.now() - startedTs) / 1000 : null;
  const totalSecs = spentSecs != null && isFinite(etaSecs) ? spentSecs + etaSecs : null;

  return (
    <div className="chapter-heading">
      <button
        className="ch-prev"
        title="Jump to start of this section"
        onClick={() => onJumpWord(Math.max(0, chapter.start))}
      >
        ▸
      </button>
      <span className="ch-title" title={chapter.title}>{chapter.title}</span>
      <span className="ch-num">§ {num}</span>
      <div className="ch-bar" title={`${pct}% through this section`}>
        <div className="ch-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ch-pct">{pct}%</span>
      <span className="ch-times" title="Time spent in this section · ETA to finish · estimated total">
        <span title="Time spent in this section">⏱ {spentSecs != null ? fmtDur(spentSecs) : '—'}</span>
        <span title="Estimated time to finish this section">→ {fmtDur(etaSecs)}</span>
        <span title="Estimated total time for this section (spent + ETA)">Σ {totalSecs != null ? fmtDur(totalSecs) : '—'}</span>
      </span>
    </div>
  );
}
