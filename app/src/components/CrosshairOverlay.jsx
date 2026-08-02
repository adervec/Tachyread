import { useEffect, useRef, useState } from 'react';
import { normalizeCrosshair, backdropFilterOf, moveCrosshair, animPeriodSecs } from '../features/crosshairs.js';
import { wordDurationMs } from '../engine/rsvpEngine.js';

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

// Trippy fractal ornaments: nested counter-rotating outline shapes (fractal) and two moiré
// spoke wheels spinning against each other (kaleido). Pure SVG, animated by CSS on the groups.
function FractalOrn() {
  return (
    <svg className="xh-orn xh-fractal" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="xh-fr xh-fr1"><polygon points="50,10 85,70 15,70" /><polygon points="50,90 15,30 85,30" opacity="0.6" /></g>
      <g className="xh-fr xh-fr2"><rect x="26" y="26" width="48" height="48" /><rect x="34" y="34" width="32" height="32" opacity="0.6" /></g>
      <g className="xh-fr xh-fr3"><circle cx="50" cy="50" r="14" /><circle cx="50" cy="50" r="7" opacity="0.6" /></g>
    </svg>
  );
}
function spokes(offsetDeg) {
  return Array.from({ length: 8 }, (_, k) => {
    const a = ((k * 45 + offsetDeg) * Math.PI) / 180;
    const r = (v) => Math.round(v * 10) / 10;
    return <line key={k} x1={r(50 + 12 * Math.cos(a))} y1={r(50 + 12 * Math.sin(a))} x2={r(50 + 46 * Math.cos(a))} y2={r(50 + 46 * Math.sin(a))} />;
  });
}
function KaleidoOrn() {
  return (
    <svg className="xh-orn xh-kaleido" viewBox="0 0 100 100" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <g className="xh-fr xh-fr1">{spokes(0)}</g>
      <g className="xh-fr xh-fr2" opacity="0.55">{spokes(22.5)}</g>
    </svg>
  );
}

// A single rendered crosshair (also reused by the editor's live preview via interactive={false}).
// lineSecs: measured read time of the current display line — drives dynamic animation periods.
export function Crosshair({ design, size = 90, interactive = false, onDrag, onDragEnd, style, lineSecs = null }) {
  const d = normalizeCrosshair(design);
  const warpId = `xh-warp-${d.id}`;
  const backdrop = backdropFilterOf(d.fx, d.fx.warp > 0 ? warpId : '');
  const anim = d.anim.style;
  const period = animPeriodSecs(d.anim, lineSecs);
  const animColor = d.layers.find((l) => l.kind === 'shape')?.color || '#ff5c5c';
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
      <div
        className={`xh-anim${['breathe', 'pulse', 'spin', 'rock'].includes(anim) ? ` xh-anim-${anim}` : ''}`}
        style={{ '--xh-period': `${period}s`, '--xh-anim-color': animColor }}
      >
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
        {anim === 'orbit' && [0, 1, 2].map((k) => (
          <span key={k} className="xh-orn xh-rotor" style={{ animationDelay: `${-(period * k) / 3}s` }}><i /></span>
        ))}
        {anim === 'scan' && <span className="xh-orn xh-scan"><i /></span>}
        {anim === 'bounce' && <span className="xh-orn xh-bounce"><i /></span>}
        {anim === 'fractal' && <FractalOrn />}
        {anim === 'kaleido' && <KaleidoOrn />}
      </div>
    </div>
  );
}

// How long the CURRENT DISPLAY LINE takes at the auto-mode pace (even when auto play is off):
// find the current word's visual row (same rendered top — this is the wrapped display line, not
// the file line, so wall-of-text paragraphs measure just the line under the eye) and sum the
// engine's own per-word durations (WPM, speed unit, long-word/digit multipliers, comma pauses).
function measureDisplayLineSecs(pane, settings) {
  const cur = pane?.querySelector('.word.current');
  if (!cur) return null;
  const cr = cur.getBoundingClientRect();
  if (!cr.height) return null;
  const scope = cur.closest('.line-row') || cur.parentElement || pane;
  let ms = 0;
  for (const w of scope.querySelectorAll('.word')) {
    if (Math.abs(w.getBoundingClientRect().top - cr.top) < cr.height * 0.5) ms += wordDurationMs(w.textContent || '', settings);
  }
  return ms > 0 ? ms / 1000 : null;
}

// The per-tab overlay: reads placements from tab settings + designs from the global stable,
// drags update the placement fractions. Missing designs (deleted from the stable, or synced from
// another device) are skipped silently.
export default function CrosshairOverlay({ placements, stable, onChange, settings }) {
  const boxRef = useRef(null);
  // Dynamic-period animations need the current display line's read time; only measure (1 Hz)
  // while a placed design actually asks for it. Small changes are ignored so periods don't jitter.
  const needLine = (placements || []).some((p) => {
    const d = (stable || []).find((c) => c.id === p.id);
    if (!d) return false;
    const a = normalizeCrosshair(d).anim;
    return a.style !== 'none' && a.periodMode === 'line';
  });
  const [lineSecs, setLineSecs] = useState(null);
  useEffect(() => {
    if (!needLine || !settings) return undefined;
    const tick = () => {
      const s = measureDisplayLineSecs(boxRef.current?.closest('.line-pane'), settings);
      if (s != null) setLineSecs((prev) => (prev == null || Math.abs(s - prev) > 0.15 ? s : prev));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [needLine, settings]);
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
            lineSecs={lineSecs}
            onDrag={(cx, cy) => dragTo(i, cx, cy)}
            style={{ left: `${(p.x ?? 0.5) * 100}%`, top: `${(p.y ?? 0.5) * 100}%`, position: 'absolute', transform: 'translate(-50%, -50%)' }}
          />
        );
      })}
    </div>
  );
}
