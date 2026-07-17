import { useRef, useState } from 'react';
import ReadingStats from './ReadingStats.jsx';

// Mobile: the reading stats as a floating, draggable popup with adjustable transparency — like the
// floating face, but for the numbers. Position is passed in (persisted by App); opacity is a
// per-tab setting (Tab Settings → Animated faces → stats transparency).
export default function FloatingStats({ tab, pos, onMove, onDrop }) {
  const { settings } = tab;
  const opacity = Math.max(0.2, Math.min(1, settings.statsOpacity ?? 0.92));
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

  const left = pos?.x ?? 8;
  const top = pos?.y ?? 96;

  return (
    <div
      ref={elRef}
      className={`floating-stats${min ? ' chip-min' : ''}`}
      style={{ left, top, opacity }}
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      title="Drag to move · transparency in Tab Settings"
    >
      {min ? (
        <>
          <span className="chip-stub-icon">📊</span>
          <button className="chip-mini-btn" title="Expand" onClick={() => setMin(false)}>+</button>
        </>
      ) : (
        <>
          <button className="chip-mini-btn" title="Minimize" onClick={() => setMin(true)}>–</button>
          <ReadingStats tab={tab} />
        </>
      )}
    </div>
  );
}
