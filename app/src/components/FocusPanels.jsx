import { useEffect, useState } from 'react';
import FocusCover from './FocusCover.jsx';
import { useApp } from '../state/AppContext.jsx';
import { useLineSweep } from './useLineSweep.js';
import { recordSpark } from '../features/wpmSpark.js';
import { focusPanelsToShow } from '../features/focusWidgets.js';

// Renders the user's chosen reading widgets onto EACH Focus-mode cover window (the blacked-out other
// monitors). Lives in the MAIN React tree so `useApp()` + the live tab flow through the portals; the
// per-cover portal + widget switch is in FocusCover. Ticks once a second so readouts + the sparkline
// stay current (mirrors ReadingStats' own tick, so the spark trend isn't empty during focus).
export default function FocusPanels({ covers, tab, readingMode }) {
  const { state } = useApp();
  const g = state.global;
  const [nowMs, setNow] = useState(() => 0);
  const wpm = (tab.tracker && tab.tracker.recentWpm()) || tab.settings.wpm;
  const lineProgress = useLineSweep(tab.doc, tab.settings.wordIndex, wpm, {
    scroll: !!g.scrollAdvances,
    getWpm: tab.tracker ? () => tab.tracker.recentWpm() : undefined,
  });
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (tab.tracker) recordSpark(tab.id, tab.tracker.sessionNewWords || 0);
    }, 1000);
    return () => clearInterval(id);
  }, [tab]);

  const ids = focusPanelsToShow(g.focusPanels, g.focusShowWidgets);
  if (!ids.length) return null;
  return (
    <>
      {(covers || []).map((cover, i) => (
        <FocusCover key={i} cover={cover} ids={ids} tab={tab} wpm={wpm} lineProgress={lineProgress} readingMode={readingMode} nowMs={nowMs} />
      ))}
    </>
  );
}
