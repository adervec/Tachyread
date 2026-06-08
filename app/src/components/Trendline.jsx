import { useEffect, useMemo, useRef, useState } from 'react';

// Mountain-graph progress bar: an area chart of recorded reading pace across the whole book.
// Filled columns are colored by state — read this session, read in a prior session, or
// unread (faint hatch). A marker tracks the current position; click/drag to scrub there.
// Ported in spirit from the WPF ProgressTrendlineControl.
const COLS = 240;
const H = 46;

export default function Trendline({ tab, onJumpWord }) {
  const tracker = tab.tracker;
  const total = tab.doc.words.length;
  const idx = tab.settings.wordIndex;
  const svgRef = useRef(null);

  // Recompute the (downsampled) trace on a throttle rather than every word advance.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 700);
    return () => clearInterval(id);
  }, []);

  const cols = useMemo(() => (tracker ? tracker.sampleTrend(COLS) : []), [tracker, idx]); // eslint-disable-line

  const maxWpm = useMemo(() => {
    let m = 300;
    for (const c of cols) if (c.wpm > m) m = c.wpm;
    return m;
  }, [cols]);

  // Build area paths for session-read and history-read columns.
  const { sessionPath, historyPath, unreadRects } = useMemo(() => {
    const w = 1000; // viewBox width; SVG scales to container
    const colW = w / COLS;
    const y = (wpm) => H - 3 - (Math.min(wpm, maxWpm) / maxWpm) * (H - 6);
    let sess = '';
    let hist = '';
    const unread = [];
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const x = c * colW;
      if (col.readFrac > 0.05) {
        const seg = `M ${x.toFixed(1)} ${H} L ${x.toFixed(1)} ${y(col.wpm).toFixed(1)} L ${(x + colW).toFixed(1)} ${y(col.wpm).toFixed(1)} L ${(x + colW).toFixed(1)} ${H} Z `;
        if (col.sessionFrac > 0.05) sess += seg;
        else hist += seg;
      } else {
        unread.push({ x, w: colW });
      }
    }
    return { sessionPath: sess, historyPath: hist, unreadRects: unread };
  }, [cols, maxWpm]);

  const posX = total ? (idx / total) * 1000 : 0;

  function jumpFromEvent(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onJumpWord(Math.round(frac * (total - 1)));
  }
  const dragging = useRef(false);

  return (
    <svg
      ref={svgRef}
      className="trendline"
      viewBox={`0 0 1000 ${H}`}
      preserveAspectRatio="none"
      title="Reading-pace trendline — click to jump"
      onPointerDown={(e) => {
        dragging.current = true;
        jumpFromEvent(e);
      }}
      onPointerMove={(e) => dragging.current && jumpFromEvent(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      {/* baseline */}
      <line x1="0" y1={H - 1} x2="1000" y2={H - 1} className="tl-base" />
      {/* unread columns: faint */}
      {unreadRects.map((r, i) => (
        <rect key={i} x={r.x} y={H - 4} width={r.w} height={3} className="tl-unread" />
      ))}
      <path d={historyPath} className="tl-history" />
      <path d={sessionPath} className="tl-session" />
      {/* current position marker */}
      <line x1={posX} y1="0" x2={posX} y2={H} className="tl-marker" />
    </svg>
  );
}
