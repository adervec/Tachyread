import { useRef, useState } from 'react';
import { useIsCompact } from '../state/device.js';

// A generic draggable, transparency-adjustable floating chip — the shared shell behind the goal
// chip (the face and stats chips predate this and keep their own copies). Position is passed in
// (persisted by App); the whole chip is the drag handle. Clamped to stay on screen. A − button
// collapses it to a small draggable stub (its `stub` icon); + restores it. On desktop the ↘
// corner drags a SCALE (persisted via onScale; double-click resets).
export default function FloatingChip({ pos, onMove, onDrop, opacity = 0.92, className = '', title, defaultPos = { x: 8, y: 96 }, stub = '▪', scale = 1, onScale, children }) {
  const elRef = useRef(null);
  const drag = useRef(null);
  const resize = useRef(null);
  const isCompact = useIsCompact();
  const [min, setMin] = useState(false);
  const [liveScale, setLiveScale] = useState(null);
  const k = Math.max(0.6, Math.min(2.5, liveScale ?? scale ?? 1));

  function onDown(e) {
    if (e.target.closest('button') || e.target.closest('.chip-resize')) return;
    const r = elRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    elRef.current.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (resize.current) {
      const s = resize.current;
      const d = Math.max(24, Math.hypot(e.clientX - s.cx, e.clientY - s.cy));
      setLiveScale(Math.max(0.6, Math.min(2.5, s.k * (d / s.d0))));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const x = Math.max(4, Math.min(window.innerWidth - d.w - 4, e.clientX - d.dx));
    const y = Math.max(52, Math.min(window.innerHeight - d.h - 4, e.clientY - d.dy));
    onMove({ x, y });
  }
  function onUp(e) {
    if (resize.current) {
      resize.current = null;
      elRef.current?.releasePointerCapture?.(e.pointerId);
      if (liveScale != null) { onScale?.(Math.round(liveScale * 100) / 100); setLiveScale(null); }
      return;
    }
    if (drag.current) { drag.current = null; elRef.current?.releasePointerCapture?.(e.pointerId); onDrop?.(pos); }
  }
  function onResizeDown(e) {
    e.stopPropagation();
    const r = elRef.current.getBoundingClientRect();
    resize.current = { cx: r.left, cy: r.top, d0: Math.max(24, Math.hypot(e.clientX - r.left, e.clientY - r.top)), k };
    e.currentTarget.setPointerCapture?.(e.pointerId); // on the grip — capturing the root would eat its dblclick
  }

  return (
    <div
      ref={elRef}
      className={`floating-chip ${className}${min ? ' chip-min' : ''}`}
      style={{
        left: pos?.x ?? defaultPos.x, top: pos?.y ?? defaultPos.y, opacity: Math.max(0.2, Math.min(1, opacity)),
        ...(k !== 1 && !min ? { transform: `scale(${k})`, transformOrigin: 'top left' } : null),
      }}
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
          {!isCompact && onScale && (
            <span className="chip-resize" title="Drag to resize (double-click to reset)" onPointerDown={onResizeDown} onDoubleClick={() => { setLiveScale(null); onScale(1); }}>◢</span>
          )}
        </>
      )}
    </div>
  );
}
