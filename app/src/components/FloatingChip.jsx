import { useRef } from 'react';

// A generic draggable, transparency-adjustable floating chip — the shared shell behind the goal and
// timer chips (the face and stats chips predate this and keep their own copies). Position is passed
// in (persisted by App); the whole chip is the drag handle. Clamped to stay on screen.
export default function FloatingChip({ pos, onMove, onDrop, opacity = 0.92, className = '', title, defaultPos = { x: 8, y: 96 }, children }) {
  const elRef = useRef(null);
  const drag = useRef(null);

  function onDown(e) {
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
      className={`floating-chip ${className}`}
      style={{ left: pos?.x ?? defaultPos.x, top: pos?.y ?? defaultPos.y, opacity: Math.max(0.2, Math.min(1, opacity)) }}
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      title={title || 'Drag to move · transparency in Tab Settings'}
    >
      {children}
    </div>
  );
}
