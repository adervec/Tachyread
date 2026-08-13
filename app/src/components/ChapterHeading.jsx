import { useEffect, useMemo, useState } from 'react';
import { getTocEntries, currentChapter } from '../document/toc.js';
import { sectionChain, barsForMode, DEFAULT_SECTION_BAR_MODE } from '../features/sectionBars.js';

function fmtDur(secs) {
  if (!isFinite(secs) || secs < 0) return '—';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Segment ticks stop being informative once they're a hair apart — past this the bar just reads as
// a texture, so it goes back to plain. ponytail: a flat cap, not a density calculation off the
// measured pixel width; raise it if a wide desktop bar ever wants finer granularity.
const MAX_SEGMENTS = 40;

// One section's bar. `pages` segments it by screenful (see the ticks note above); `depth` shifts
// the nested mode's inset so outer sections sit behind the inner one.
function SectionBar({ sec, pct, pages, title, depth, nested }) {
  return (
    <div
      className={`ch-bar${pages > 1 ? ' segmented' : ''}${nested ? ' ch-bar-nested' : ''}`}
      title={title}
      style={{
        ...(pages > 1 ? { '--ch-seg': `${100 / pages}%` } : null),
        ...(nested ? { '--ch-depth': depth } : null),
      }}
      data-level={sec.level}
    >
      <div className="ch-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Slim heading bar: current section name, progress within it, and time figures — elapsed in
// the section, an ETA to finish it (from your measured pace), and the estimated total.
export default function ChapterHeading({ tab, onJumpWord, visibleRef, barMode = DEFAULT_SECTION_BAR_MODE, cycleSecs = 6 }) {
  const { doc, settings, tracker } = tab;
  const idx = settings.wordIndex;
  const entries = useMemo(() => getTocEntries(tab), [tab, settings.tocEntries]); // eslint-disable-line
  const chapter = useMemo(() => currentChapter(entries, idx, doc.words.length), [entries, idx, doc.words.length]);

  // Live clock so elapsed / ETA refresh while reading — and, in cycling mode, so the bar rotates.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Every section containing the cursor, outermost first — you are in a part AND a chapter AND a
  // subsection at once, each a different distance from its end.
  const chain = useMemo(
    () => sectionChain(entries, idx, doc.words.length),
    [entries, idx, doc.words.length],
  );
  const tick = Math.floor(now / Math.max(1, cycleSecs));
  const bars = barsForMode(chain, barMode, tick);

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
  const pagesFor = (words) => {
    const raw = pageWords > 0 && words > 0 ? Math.ceil(words / pageWords) : 0;
    return raw > 1 && raw <= MAX_SEGMENTS ? raw : 0;
  };
  const barTitleFor = (sec) => {
    const p = (sec.progress * 100).toFixed(1);
    const raw = pageWords > 0 && sec.words > 0 ? Math.ceil(sec.words / pageWords) : 0;
    return `${sec.title || 'Section'} — ${p}% through${raw > 1 ? ` · about ${raw} screenfuls at this text size` : ''}`;
  };
  // The cycling label names which level is on screen right now, or the whole set would be a mystery.
  const cycling = barMode === 'cycle' && chain.length > 1;

  return (
    <div className={`chapter-heading ch-mode-${barMode}${bars.length > 1 ? ' ch-multi' : ''}`}>
      <button
        className="ch-prev"
        title="Jump to start of this section"
        onClick={() => onJumpWord(Math.max(0, chapter.start))}
      >
        ▸
      </button>
      <span className="ch-title" title={chapter.title}>{cycling ? bars[0].title : chapter.title}</span>
      <span className="ch-num">§ {num}</span>
      <div className={`ch-bars ch-bars-${barMode}`}>
        {bars.length > 0 ? bars.map((sec, i) => (
          <SectionBar
            key={`${sec.level}:${sec.start}`}
            sec={sec}
            pct={(sec.progress * 100).toFixed(1)}
            pages={pagesFor(sec.words)}
            title={barTitleFor(sec)}
            depth={i}
            nested={barMode === 'nested'}
          />
        )) : (
          <div className="ch-bar" title={`${pct}% through this section`}>
            <div className="ch-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <span className="ch-pct">{bars.length ? (bars[bars.length - 1].progress * 100).toFixed(1) : pct}%</span>
      <span className="ch-times" title="Time spent in this section · ETA to finish · estimated total">
        <span title="Time spent in this section">⏱ {spentSecs != null ? fmtDur(spentSecs) : '—'}</span>
        <span title="Estimated time to finish this section">→ {fmtDur(etaSecs)}</span>
        <span title="Estimated total time for this section (spent + ETA)">Σ {totalSecs != null ? fmtDur(totalSecs) : '—'}</span>
      </span>
    </div>
  );
}
