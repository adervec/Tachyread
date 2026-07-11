import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsCompact } from '../state/device.js';
import { fmtDateTime } from '../features/dateFmt.js';

// Mountain-graph progress bar: an area chart of recorded reading pace across the whole book.
// Filled columns are colored by state — read this session, read in a prior session, or
// unread (faint hatch). A marker tracks the current position; click/drag to scrub there.
// Desktop hover shows the segment's WPM + when it was first read; faint dashes mark the
// breaks between past reading sessions. Ported in spirit from the WPF ProgressTrendlineControl.
const COLS = 240;
const H = 46;
const SESSION_GAP_MS = 25 * 60 * 1000; // same lull that splits sessions in Progress Detail

export default function Trendline({ tab, onPeek, peekIdx = -1 }) {
  const tracker = tab.tracker;
  const total = tab.doc.words.length;
  const idx = tab.settings.wordIndex;
  const skipRanges = tab.settings.skipRanges || [];
  const svgRef = useRef(null);
  const isCompact = useIsCompact();
  const [hover, setHover] = useState(null); // { frac, tipX } — desktop mouse only

  // Recompute the (downsampled) trace on a throttle rather than every word advance.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 700);
    return () => clearInterval(id);
  }, []);

  const cols = useMemo(() => (tracker ? tracker.sampleTrend(COLS) : []), [tracker, idx]); // eslint-disable-line
  // Paragraph first-read timeline (word-ordered): datetimes for the hover tip + session breaks.
  const timeline = useMemo(() => (tracker ? tracker.paraTimeline() : []), [tracker, idx]); // eslint-disable-line

  // Session-break word positions: sort reads by time, split on a >25-minute lull, and mark where
  // each later session STARTED in the text — a faint seam between past reading stretches.
  const sessionBreaks = useMemo(() => {
    if (!timeline.length || !total) return [];
    const byTime = [...timeline].sort((a, b) => a.ts - b.ts);
    const breaks = [];
    for (let i = 1; i < byTime.length; i++) {
      if (byTime[i].ts - byTime[i - 1].ts > SESSION_GAP_MS) breaks.push(byTime[i].startWord);
    }
    return breaks;
  }, [timeline, total]);

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
  const peekX = peekIdx >= 0 && total ? (peekIdx / total) * 1000 : -1;
  // Excluded (skip) sections as fractions of the book — shaded so you can see what won't count.
  const skipRects = total
    ? skipRanges.map((r) => ({ x: (r.start / total) * 1000, w: (Math.max(r.start, r.end) - r.start) / total * 1000 }))
    : [];

  function peekFromEvent(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onPeek?.(Math.round(frac * (total - 1)));
  }
  const dragging = useRef(false);

  // Hover tooltip (desktop mouse only): the segment's pace + when it was first read.
  let tip = null;
  if (hover && total && cols.length) {
    const wi = Math.min(total - 1, Math.floor(hover.frac * total));
    const col = cols[Math.min(COLS - 1, Math.floor(hover.frac * COLS))];
    const read = col && col.readFrac > 0.05;
    // Last timeline paragraph at or before the hovered word that has a first-read stamp.
    let when = null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].startWord <= wi) { when = timeline[i].ts; break; }
    }
    tip = {
      x: hover.tipX,
      pct: ((wi / total) * 100).toFixed(1),
      wpm: read && col.wpm > 0 ? Math.round(col.wpm) : null,
      when: read && when ? fmtDateTime(when) : null,
      read,
    };
  }

  return (
    <div className="tl-wrap">
      <svg
        ref={svgRef}
        className="trendline"
        viewBox={`0 0 1000 ${H}`}
        preserveAspectRatio="none"
        title="Reading-pace trendline — click/drag to peek (resume reading to return)"
        onPointerDown={(e) => {
          dragging.current = true;
          peekFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) peekFromEvent(e);
          if (!isCompact && e.pointerType !== 'touch') {
            const rect = svgRef.current.getBoundingClientRect();
            const px = e.clientX - rect.left;
            setHover({ frac: Math.max(0, Math.min(0.9999, px / rect.width)), tipX: Math.min(Math.max(px, 70), rect.width - 70) });
          }
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => { dragging.current = false; setHover(null); }}
      >
        {/* baseline */}
        <line x1="0" y1={H - 1} x2="1000" y2={H - 1} className="tl-base" />
        {/* excluded (skip) sections: shaded full-height bands */}
        {skipRects.map((r, i) => (
          <rect key={`s${i}`} x={r.x} y="0" width={r.w} height={H} className="tl-skip" />
        ))}
        {/* unread columns: faint */}
        {unreadRects.map((r, i) => (
          <rect key={i} x={r.x} y={H - 4} width={r.w} height={3} className="tl-unread" />
        ))}
        <path d={historyPath} className="tl-history" />
        <path d={sessionPath} className="tl-session" />
        {/* faint seams where a new reading session began */}
        {total > 0 && sessionBreaks.map((w, i) => (
          <line key={`sb${i}`} x1={(w / total) * 1000} y1="4" x2={(w / total) * 1000} y2={H - 2} className="tl-sess-break" />
        ))}
        {/* peek marker (where you're previewing) */}
        {peekX >= 0 && <line x1={peekX} y1="0" x2={peekX} y2={H} className="tl-peek" />}
        {/* current position marker */}
        <line x1={posX} y1="0" x2={posX} y2={H} className="tl-marker" />
      </svg>
      {tip && (
        <div className="tl-tip" style={{ left: tip.x }}>
          <b>{tip.pct}%</b>{tip.wpm != null ? ` · ${tip.wpm} wpm` : tip.read ? '' : ' · unread'}
          {tip.when && <span className="tl-tip-when">{tip.when}</span>}
        </div>
      )}
    </div>
  );
}
