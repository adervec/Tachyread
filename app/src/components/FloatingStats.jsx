import { useLayoutEffect, useRef, useState } from 'react';
import ReadingStats, { STATS_SACRIFICE_ORDER } from './ReadingStats.jsx';
import { useIsCompact } from '../state/device.js';

// The reading stats as a floating, draggable chip. On desktop it's RESIZABLE by dragging the ↘
// bottom corner; when the box gets too small to fit everything, blocks are sacrificed least
// important first (STATS_SACRIFICE_ORDER) until it fits — the hero WPM survives longest. The old
// timer chip's ETA + auto-stop countdown are merged in here as stats blocks.
export default function FloatingStats({ tab, pos, onMove, onDrop, size, onSize, autoStopAt = 0 }) {
  const { settings } = tab;
  const isCompact = useIsCompact();
  const opacity = Math.max(0.2, Math.min(1, settings.statsOpacity ?? 0.92));
  const elRef = useRef(null);
  const bodyRef = useRef(null);
  const drag = useRef(null);
  const resize = useRef(null);
  const [min, setMin] = useState(false);
  const [liveSize, setLiveSize] = useState(null); // during a resize drag (persisted on release)
  const [drop, setDrop] = useState(0);            // how many sacrifice-order blocks are hidden

  const box = liveSize || size || null;

  // Re-fit when the box or the configured blocks change: reset, then shrink one block per pass
  // until the content fits (each setDrop re-runs this effect — quick convergence, no oscillation).
  useLayoutEffect(() => { setDrop(0); }, [box?.w, box?.h, settings.statsChip, min]);
  useLayoutEffect(() => {
    if (!box || min) return;
    const el = bodyRef.current;
    if (!el) return;
    if ((el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) && drop < STATS_SACRIFICE_ORDER.length) {
      setDrop(drop + 1);
    }
  });

  function onDown(e) {
    if (e.target.closest('button') || e.target.closest('.chip-resize')) return;
    const r = elRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    elRef.current.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (resize.current) {
      const s = resize.current;
      setLiveSize({
        w: Math.max(120, Math.min(window.innerWidth * 0.6, s.w + (e.clientX - s.x))),
        h: Math.max(60, Math.min(window.innerHeight * 0.8, s.h + (e.clientY - s.y))),
      });
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
      if (liveSize) { onSize?.(liveSize); setLiveSize(null); }
      return;
    }
    if (drag.current) { drag.current = null; elRef.current?.releasePointerCapture?.(e.pointerId); onDrop?.(pos); }
  }
  function onResizeDown(e) {
    e.stopPropagation();
    const r = elRef.current.getBoundingClientRect();
    resize.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture?.(e.pointerId); // on the grip — capturing the root would eat its dblclick
  }

  const left = pos?.x ?? 8;
  const top = pos?.y ?? 96;
  const omit = drop > 0 ? STATS_SACRIFICE_ORDER.slice(0, drop) : null;

  return (
    <div
      ref={elRef}
      className={`floating-stats${min ? ' chip-min' : ''}${box && !min ? ' sized' : ''}`}
      style={{ left, top, opacity, ...(box && !min ? { width: box.w, height: box.h } : null) }}
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
          <div className="chip-body" ref={bodyRef}>
            <ReadingStats tab={tab} autoStopAt={autoStopAt} omit={omit} />
          </div>
          {!isCompact && (
            <span
              className="chip-resize"
              title="Drag to resize — too small and the least important stats bow out first (double-click to reset)"
              onPointerDown={onResizeDown}
              onDoubleClick={() => { setLiveSize(null); onSize?.(null); }}
            >◢</span>
          )}
        </>
      )}
    </div>
  );
}
