import { useEffect, useRef } from 'react';
import { createTrail } from '../features/cursorTrail.js';

// A fading cursor-trail overlay for the reader area. A full-bleed, click-through canvas over
// `.main-area`; the trail math lives in features/cursorTrail.js. Two modes:
//   • fade        — a comet tail behind the moving pointer.
//   • seismograph — the pen advances while the reader scrolls under the (still or moving) cursor,
//                   drawing a wander line — the page's motion beneath your pointer.
// The whole thing is inert (renders nothing, no listeners) when mode is 'off'.
export default function ReaderTrail({ mode, color, trailMs }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!mode || mode === 'off') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const host = canvas.parentElement; // .main-area (position: relative)
    const trail = createTrail({ mode, trailMs });
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let cursor = null;       // latest pointer position within the host, in CSS px
    let lastScrollTop = null;
    let lastFrame = performance.now();

    const scrollerOf = () => {
      const wrap = host.querySelector('.line-pane-list');
      if (!wrap) return null;
      return [...wrap.querySelectorAll('*')].find((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY)) || wrap;
    };

    function onMove(e) {
      const r = host.getBoundingClientRect();
      cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (mode === 'fade') trail.move(cursor.x, cursor.y, performance.now());
    }
    function onLeave() { cursor = null; }
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dpr = window.devicePixelRatio || 1;
      const r = host.getBoundingClientRect();
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;

      if (mode === 'seismograph' && cursor) {
        const sc = scrollerOf();
        const top = sc ? sc.scrollTop : 0;
        const delta = lastScrollTop == null ? 0 : top - lastScrollTop;
        lastScrollTop = top;
        // Only lay down trace while the page is actually moving under the cursor.
        if (Math.abs(delta) > 0.01) trail.scroll(cursor.x, cursor.y, delta, now, dt);
      }

      const pts = trail.sample(now);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      if (pts.length) {
        if (mode === 'seismograph') {
          // A connected wander line, brighter at the leading (newest) end.
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i], b = pts[i - 1];
            ctx.globalAlpha = a.alpha * 0.9;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(b.x % r.width, b.y); ctx.lineTo(a.x % r.width, a.y); ctx.stroke();
          }
        } else {
          for (const p of pts) {
            ctx.globalAlpha = p.alpha * 0.7;
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 2 + 4 * p.alpha, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [mode, color, trailMs]);

  if (!mode || mode === 'off') return null;
  return <canvas ref={canvasRef} className="reader-trail" aria-hidden="true" />;
}
