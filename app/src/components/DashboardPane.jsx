import Face from './Face.jsx';
import ReadingStats from './ReadingStats.jsx';
import { useLineSweep } from './useLineSweep.js';

// Desktop dock: the animated reader faces and/or the live reading stats, each shown independently
// (showFaces / showStats). On mobile these both float as separate draggable popups instead — see
// FloatingFace / FloatingStats.
export default function DashboardPane({ tab, dock = false, showFaces = true, showStats = true }) {
  const { settings, doc } = tab;
  const idx = settings.wordIndex;

  const count = Math.max(1, Math.min(3, settings.faceCount || 1));
  const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];
  const wpm = (tab.tracker && tab.tracker.recentWpm()) || settings.wpm;
  // Sweeps the eyes along the line in line-at-a-time modes (line/scroll/page) instead of snapping.
  const lineProgress = useLineSweep(doc, idx, wpm);

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
