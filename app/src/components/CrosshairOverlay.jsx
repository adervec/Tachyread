import { useRef } from 'react';
import { normalizeCrosshair, backdropFilterOf, moveCrosshair } from '../features/crosshairs.js';

// The placed crosshairs floating over the Lines area. Each is draggable in place (grab it, drop it
// where your eye should anchor); position persists per tab as pane fractions, so it stays put
// through resizes. Rendering: an optional backdrop-filter DISC distorts the text behind
// (blur/invert/…/turbulence warp via an inline SVG filter), then the design's layers — shapes as
// SVG strokes, images, emoji — stacked and individually scaled/rotated/faded.

// One shape layer as SVG elements in a 100×100 viewBox (stroke-width in viewBox units).
function ShapeBits({ shape, thickness }) {
  const t = thickness * 1.6; // viewBox units ≈ px at the default 60px size
  switch (shape) {
    case 'cross': return <><line x1="50" y1="8" x2="50" y2="92" /><line x1="8" y1="50" x2="92" y2="50" /></>;
    case 'x': return <><line x1="16" y1="16" x2="84" y2="84" /><line x1="84" y1="16" x2="16" y2="84" /></>;
    case 'circle': return <circle cx="50" cy="50" r="40" fill="none" />;
    case 'ring': return <circle cx="50" cy="50" r="36" fill="none" strokeWidth={t * 2} />;
    case 'dot': return <circle cx="50" cy="50" r={Math.max(4, t * 2)} stroke="none" fill="currentColor" />;
    case 'square': return <rect x="14" y="14" width="72" height="72" fill="none" />;
    case 'triangle': return <polygon points="50,12 90,84 10,84" fill="none" />;
    case 'brackets': return <><path d="M30 14 H14 V86 H30" fill="none" /><path d="M70 14 H86 V86 H70" fill="none" /></>;
    case 'chevron': return <polyline points="20,65 50,30 80,65" fill="none" />;
    case 'hline': return <line x1="6" y1="50" x2="94" y2="50" />;
    case 'vline': return <line x1="50" y1="6" x2="50" y2="94" />;
    default: return null;
  }
}

// A single rendered crosshair (also reused by the editor's live preview via interactive={false}).
export function Crosshair({ design, size = 90, interactive = false, onDrag, onDragEnd, style }) {
  const d = normalizeCrosshair(design);
  const warpId = `xh-warp-${d.id}`;
  const backdrop = backdropFilterOf(d.fx, d.fx.warp > 0 ? warpId : '');
  const drag = useRef(null);
  function onPointerDown(e) {
    if (!interactive) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e) {
    if (!interactive || !drag.current) return;
    onDrag?.(e.clientX, e.clientY);
  }
  function onPointerUp() {
    if (!interactive || !drag.current) return;
    drag.current = null;
    onDragEnd?.();
  }
  return (
    <div
      className={`xh-item${interactive ? ' xh-drag' : ''}`}
      style={{ width: size, height: size, opacity: d.opacity, ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={interactive ? `${d.name} — drag to place` : d.name}
    >
      {d.fx.warp > 0 && (
        <svg width="0" height="0" className="xh-defs" aria-hidden="true">
          <defs>
            <filter id={warpId}>
              <feTurbulence type="turbulence" baseFrequency="0.015 0.025" numOctaves="1" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale={d.fx.warp} />
            </filter>
          </defs>
        </svg>
      )}
      {backdrop && <div className="xh-fx" style={{ backdropFilter: backdrop, WebkitBackdropFilter: backdrop }} />}
      {d.layers.map((l, i) => {
        const wrap = {
          transform: `translate(-50%, -50%) rotate(${l.rotate}deg) scale(${l.scale})`,
          opacity: l.opacity,
        };
        if (l.kind === 'image' && l.src) {
          return <img key={i} className="xh-layer" style={wrap} src={l.src} alt="" draggable={false} />;
        }
        if (l.kind === 'emoji') {
          return <span key={i} className="xh-layer xh-emoji" style={{ ...wrap, fontSize: size * 0.7 }}>{l.char || '🎯'}</span>;
        }
        if (l.kind === 'shape') {
          return (
            <svg key={i} className="xh-layer" style={{ ...wrap, color: l.color }} viewBox="0 0 100 100"
              stroke="currentColor" strokeWidth={l.thickness * 1.6} strokeLinecap="round" strokeLinejoin="round">
              <ShapeBits shape={l.shape} thickness={l.thickness} />
            </svg>
          );
        }
        return null;
      })}
    </div>
  );
}

// The per-tab overlay: reads placements from tab settings + designs from the global stable,
// drags update the placement fractions. Missing designs (deleted from the stable, or synced from
// another device) are skipped silently.
export default function CrosshairOverlay({ placements, stable, onChange }) {
  const boxRef = useRef(null);
  if (!placements?.length || !stable?.length) return null;
  const dragTo = (index, cx, cy) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    onChange(moveCrosshair(placements, index, (cx - r.left) / r.width, (cy - r.top) / r.height));
  };
  return (
    <div className="xh-overlay" ref={boxRef}>
      {placements.map((p, i) => {
        const d = stable.find((c) => c.id === p.id);
        if (!d) return null;
        return (
          <Crosshair
            key={`${p.id}-${i}`}
            design={d}
            size={p.size || 90}
            interactive
            onDrag={(cx, cy) => dragTo(i, cx, cy)}
            style={{ left: `${(p.x ?? 0.5) * 100}%`, top: `${(p.y ?? 0.5) * 100}%`, position: 'absolute', transform: 'translate(-50%, -50%)' }}
          />
        );
      })}
    </div>
  );
}
