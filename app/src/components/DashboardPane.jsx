import { useMemo } from 'react';
import Face from './Face.jsx';
import ReadingStats from './ReadingStats.jsx';

// Desktop dock: the animated reader faces and/or the live reading stats, each shown independently
// (showFaces / showStats). On mobile these both float as separate draggable popups instead — see
// FloatingFace / FloatingStats.
export default function DashboardPane({ tab, dock = false, showFaces = true, showStats = true }) {
  const { settings, doc } = tab;
  const idx = settings.wordIndex;

  const lineProgress = useMemo(() => {
    const li = doc.wordToLine[idx] ?? 0;
    const start = doc.lines[li]?.startWordIndex ?? 0;
    const end = li + 1 < doc.lines.length ? doc.lines[li + 1].startWordIndex : doc.words.length;
    const count = Math.max(2, end - start);
    return (idx - start) / (count - 1);
  }, [doc, idx]);

  const count = Math.max(1, Math.min(3, settings.faceCount || 1));
  const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];
  const wpm = (tab.tracker && tab.tracker.recentWpm()) || settings.wpm;

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
