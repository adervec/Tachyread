import Face from './Face.jsx';
import ReadingStats from './ReadingStats.jsx';
import { useLineSweep } from './useLineSweep.js';
import { useApp } from '../state/AppContext.jsx';

// Desktop dock: the animated reader faces and/or the live reading stats, each shown independently
// (showFaces / showStats). On mobile these both float as separate draggable popups instead — see
// FloatingFace / FloatingStats.
export default function DashboardPane({ tab, dock = false, showFaces = true, showStats = true }) {
  const { state } = useApp();
  const { settings, doc } = tab;
  const idx = settings.wordIndex;

  const count = Math.max(1, Math.min(3, settings.faceCount || 1));
  const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];
  const wpm = (tab.tracker && tab.tracker.recentWpm()) || settings.wpm;
  // Sweeps the eyes along the line in line-at-a-time modes (line/page) instead of snapping; in
  // scroll-to-read the eyes read along continuously at the live pace (the index freezes on dwells).
  const lineProgress = useLineSweep(doc, idx, wpm, {
    scroll: !!state.global.scrollAdvances,
    getWpm: tab.tracker ? () => tab.tracker.recentWpm() : undefined,
  });

  return (
    <div className={`dashboard-pane${dock ? ' dock' : ''}`}>
      {showFaces && settings.showEyes && (
        <div className="rsvp-faces">
          {Array.from({ length: count }, (_, i) => (
            <Face
              key={i}
              wpm={wpm}
              lineProgress={lineProgress}
              faceStyle={styles[i] || 'Man'}
              artStyle={settings.artStyle || 'Cartoon'}
              size={dock ? 72 : 120}
            />
          ))}
        </div>
      )}
      {showStats && <ReadingStats tab={tab} />}
    </div>
  );
}
