import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { useLineSweep } from './useLineSweep.js';
import { useApp } from '../state/AppContext.jsx';

// Mobile: the reader face(s) as a floating, draggable overlay with adjustable transparency —
// so it can sit anywhere over the reading area instead of taking a slice of a small screen. The
// stats stay in the dock; only the face floats. Position is passed in (persisted by App), opacity
// is a per-tab face setting (Tab Settings → Animated faces).
export default function FloatingFace({ tab, pos, onMove, onDrop, scale = 1, onScale, avatar = null }) {
  const { state } = useApp();
  const { settings, doc, tracker } = tab;
  const idx = settings.wordIndex;
  const count = Math.max(1, Math.min(3, settings.faceCount || 1));
  const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];
  const opacity = Math.max(0.15, Math.min(1, settings.faceOpacity ?? 0.9));
  const [liveScale, setLiveScale] = useState(null);
  const k = Math.max(0.6, Math.min(2.5, liveScale ?? scale ?? 1));
  const resize = useRef(null);

  const wpm = (tracker && tracker.recentWpm()) || settings.wpm;
  // Sweeps the eyes along the line in line-at-a-time modes (line/page) instead of snapping; in
  // scroll-to-read the eyes read along continuously at the live pace instead of tracking the frontier.
  const lineProgress = useLineSweep(doc, idx, wpm, {
    scroll: !!state.global.scrollAdvances,
    getWpm: tracker ? () => tracker.recentWpm() : undefined,
  });

  const elRef = useRef(null);
  const drag = useRef(null);
  const [min, setMin] = useState(false);

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
      title="Drag to move · transparency in Tab Settings → Avatars"
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
              <Avatar key={i} wpm={wpm} lineProgress={lineProgress} faceStyle={styles[i] || 'Man'} artStyle={settings.artStyle || 'Cartoon'} size={Math.round(62 * k)}
                activity={avatar?.activity} stage={avatar?.stage || 'awake'} speaking={!!avatar?.speaking} hands={!!avatar?.hands} />
            ))}
          </div>
          {onScale && (
            <span className="chip-resize" title="Drag to resize (double-click to reset)" onPointerDown={onResizeDown} onDoubleClick={() => { setLiveScale(null); onScale(1); }}>◢</span>
          )}
        </>
      )}
    </div>
  );
}
