import { useMemo, useRef, useState } from 'react';
import Face from './Face.jsx';

// Mobile: the reader face(s) as a floating, draggable overlay with adjustable transparency —
// so it can sit anywhere over the reading area instead of taking a slice of a small screen. The
// stats stay in the dock; only the face floats. Position is passed in (persisted by App), opacity
// is a per-tab face setting (Tab Settings → Animated faces).
export default function FloatingFace({ tab, pos, onMove, onDrop }) {
  const { settings, doc, tracker } = tab;
  const idx = settings.wordIndex;
  const count = Math.max(1, Math.min(3, settings.faceCount || 1));
  const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];
  const opacity = Math.max(0.15, Math.min(1, settings.faceOpacity ?? 0.9));

  const lineProgress = useMemo(() => {
    const li = doc.wordToLine[idx] ?? 0;
    const start = doc.lines[li]?.startWordIndex ?? 0;
    const end = li + 1 < doc.lines.length ? doc.lines[li + 1].startWordIndex : doc.words.length;
    const cnt = Math.max(2, end - start);
    return (idx - start) / (cnt - 1);
  }, [doc, idx]);
  const wpm = (tracker && tracker.recentWpm()) || settings.wpm;

  const elRef = useRef(null);
  const drag = useRef(null);
  const [min, setMin] = useState(false);

  function onDown(e) {
    if (e.target.closest('button')) return; // minimize/expand button — not a drag
    const r = elRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    elRef.current.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const x = Math.max(4, Math.min(window.innerWidth - d.w - 4, e.clientX - d.dx));
    const y = Math.max(52, Math.min(window.innerHeight - d.h - 4, e.clientY - d.dy));
    onMove({ x, y });
  }
  function onUp(e) {
    if (drag.current) { drag.current = null; elRef.current?.releasePointerCapture?.(e.pointerId); onDrop?.(pos); }
  }

  // Default corner: top-right, below the chrome, until the user drags it somewhere.
  const left = pos?.x ?? (typeof window !== 'undefined' ? window.innerWidth - 96 : 280);
  const top = pos?.y ?? 96;

  return (
    <div
      ref={elRef}
      className={`floating-face${min ? ' chip-min' : ''}`}
      style={{ left, top, opacity }}
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      title="Drag to move · transparency in Tab Settings → Animated faces"
    >
      {min ? (
        <>
          <span className="chip-stub-icon">🙂</span>
          <button className="chip-mini-btn" title="Expand" onClick={() => setMin(false)}>+</button>
        </>
      ) : (
        <>
          <button className="chip-mini-btn" title="Minimize" onClick={() => setMin(true)}>–</button>
          <div className="rsvp-faces">
            {Array.from({ length: count }, (_, i) => (
              <Face key={i} wpm={wpm} lineProgress={lineProgress} faceStyle={styles[i] || 'Man'} artStyle={settings.artStyle || 'Cartoon'} size={62} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
