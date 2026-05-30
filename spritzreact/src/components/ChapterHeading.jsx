import { useMemo } from 'react';
import { getTocEntries, currentChapter } from '../document/toc.js';

// Slim heading bar showing the current chapter/section and progress within it.
export default function ChapterHeading({ tab, onJumpWord }) {
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const entries = useMemo(() => getTocEntries(tab), [tab, settings.tocEntries]); // eslint-disable-line
  const chapter = useMemo(() => currentChapter(entries, idx, doc.words.length), [entries, idx, doc.words.length]);
  if (!chapter) return null;

  const pct = Math.round(chapter.progress * 100);
  const num = chapter.index >= 0 ? `${chapter.index + 1}/${chapter.count}` : '—';

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
    </div>
  );
}
