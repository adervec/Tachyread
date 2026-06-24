import { useMemo } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { getTocEntries, extractNumeral, formatNumeral } from '../document/toc.js';
import { goalTargetIndex } from '../engine/goals.js';

// A minimap strip beneath the progress bar: one icon per TOC entry positioned by where it
// starts in the document, plus markers for the current reading position and the active goal's
// (confirmed or projected) target. Clicking an icon opens + reveals that entry in the TOC pane.
export default function TocBar({ tab, onIconClick }) {
  const { state } = useApp();
  const { doc, settings } = tab;
  const total = doc.words.length || 1;
  const entries = useMemo(() => getTocEntries(tab), [tab, settings.tocEntries]); // eslint-disable-line
  if (!entries.length) return null;

  const tierIcons = state.global.tocTierIcons || ['📖', '📑', '📄', '§', '•'];
  const numStyle = settings.tocBarNumeralStyle || 'none';
  const regex = settings.tocNumeralRegex || [];
  const curPct = (settings.wordIndex / total) * 100;

  const goal = settings.goal;
  const target = goal ? goalTargetIndex(tab, goal) : null;
  const goalPct = target ? (target.index / total) * 100 : null;

  return (
    <div className="toc-bar" title="Table-of-contents minimap — click an icon to reveal it in the ToC">
      <div className="toc-bar-track" />
      {goalPct != null && (
        <div
          className={`toc-bar-goal${target.projected ? ' projected' : ''}`}
          style={{ left: `${Math.max(0, Math.min(100, goalPct))}%` }}
          title={target.projected ? 'Projected goal position (from your pace)' : 'Goal target position'}
        >🎯</div>
      )}
      <div className="toc-bar-now" style={{ left: `${Math.max(0, Math.min(100, curPct))}%` }} title="Current position" />
      {entries.map((e, i) => {
        const level = e.level || 0;
        const icon = tierIcons[Math.min(level, tierIcons.length - 1)] || '•';
        const left = (e.wordIndex / total) * 100;
        const num = numStyle !== 'none' ? formatNumeral(extractNumeral(e.title, regex[level]), numStyle) : '';
        return (
          <button
            key={`${e.wordIndex}-${i}`}
            className={`toc-bar-icon lvl-${level}`}
            style={{ left: `${Math.max(0, Math.min(100, left))}%` }}
            title={`${e.title}${num ? ` (${num})` : ''}`}
            onClick={() => onIconClick?.(i)}
          >
            <span className="tbi-glyph">{icon}</span>
            {num && <span className="tbi-num">{num}</span>}
          </button>
        );
      })}
    </div>
  );
}
