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
// Segment ticks stop being informative once they're a hair apart — past this the bar just reads as
// a texture, so it goes back to plain. ponytail: a flat cap, not a density calculation off the
// measured pixel width; raise it if a wide desktop bar ever wants finer granularity.
const MAX_SEGMENTS = 40;

export default function ChapterHeading({ tab, onJumpWord, visibleRef }) {
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

  // Segment the bar by SCREENFULS, so its ticks answer "how many pages is this section?" at the
  // current text size — resize the font or the pane and the ticks re-space on the next tick (this
  // component already re-renders every second for the clock, so no extra plumbing is needed).
  const pageWords = visibleRef?.current?.words?.() || 0;
  const sectionWords = Math.max(0, chapter.end - chapter.start);
  const rawPages = pageWords > 0 && sectionWords > 0 ? Math.ceil(sectionWords / pageWords) : 0;
  const pages = rawPages > 1 && rawPages <= MAX_SEGMENTS ? rawPages : 0;
  const barTitle = `${pct}% through this section`
    + (rawPages > 1 ? ` · about ${rawPages} screenfuls at this text size` : '');

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
      <div className={`ch-bar${pages > 1 ? ' segmented' : ''}`} title={barTitle} style={pages > 1 ? { '--ch-seg': `${100 / pages}%` } : undefined}>
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
