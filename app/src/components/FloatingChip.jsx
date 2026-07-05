import { useRef, useState } from 'react';

// A generic draggable, transparency-adjustable floating chip — the shared shell behind the goal and
// timer chips (the face and stats chips predate this and keep their own copies). Position is passed
// in (persisted by App); the whole chip is the drag handle. Clamped to stay on screen. A − button
// collapses it to a small draggable stub (its `stub` icon); + restores it.
export default function FloatingChip({ pos, onMove, onDrop, opacity = 0.92, className = '', title, defaultPos = { x: 8, y: 96 }, stub = '▪', children }) {
  const elRef = useRef(null);
  const drag = useRef(null);
  const [min, setMin] = useState(false);

  function onDown(e) {
    if (e.target.closest('button')) return; // let the minimize/expand button work — don't start a drag
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

  return (
    <div
      ref={elRef}
      className={`floating-chip ${className}${min ? ' chip-min' : ''}`}
      style={{ left: pos?.x ?? defaultPos.x, top: pos?.y ?? defaultPos.y, opacity: Math.max(0.2, Math.min(1, opacity)) }}
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      title={title || 'Drag to move · transparency in Tab Settings'}
    >
      {min ? (
        <>
          <span className="chip-stub-icon">{stub}</span>
          <button className="chip-mini-btn" title="Expand" onClick={() => setMin(false)}>+</button>
        </>
      ) : (
        <>
          <button className="chip-mini-btn" title="Minimize" onClick={() => setMin(true)}>–</button>
          {children}
        </>
      )}
    </div>
  );
}
