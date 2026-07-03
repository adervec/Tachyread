import { useEffect, useState } from 'react';
import FloatingChip from './FloatingChip.jsx';

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// Timer info as a floating transparent chip: the finish-at-pace ETA (always), plus a live countdown
// to the read-aloud auto-stop when one is armed. autoStopAt is the epoch-ms the auto-stop fires (0 =
// none). A 1s tick keeps the ETA and countdown current.
export default function FloatingTimer({ tab, pos, onMove, onDrop, autoStopAt = 0 }) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { settings, doc, tracker } = tab;
  const total = doc.words.length;
  const idx = settings.wordIndex;
  const effWpm = (tracker && (tracker.recentWpm() || tracker.sessionWpm())) || settings.wpm;
  const etaSecs = effWpm > 0 ? (Math.max(0, total - idx) / effWpm) * 60 : 0;
  const remainMs = autoStopAt ? autoStopAt - Date.now() : 0;
  // Default to the right side (clear of the top-left stats chip), just below the goal chip.
  const defaultPos = { x: typeof window !== 'undefined' ? window.innerWidth - 210 : 300, y: 220 };

  return (
    <FloatingChip
      pos={pos}
      onMove={onMove}
      onDrop={onDrop}
      opacity={settings.statsOpacity ?? 0.92}
      className="floating-timer"
      defaultPos={defaultPos}
      title="Timer · drag to move · transparency in Tab Settings"
    >
      <div className="chip-status">⏱ {fmt(etaSecs)} <span className="chip-dim">left at pace</span></div>
      {autoStopAt > 0 && remainMs > 0 && (
        <div className="chip-status">⏳ {fmt(remainMs / 1000)} <span className="chip-dim">→ auto-stop</span></div>
      )}
    </FloatingChip>
  );
}
