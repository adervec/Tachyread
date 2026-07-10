// Smooth line-progress for the reader faces. Word-at-a-time modes already sweep the eyes across
// the line naturally (the word index walks it). Line-at-a-time modes (line/para/page/scroll) snap
// the index to each new line START, so the raw fraction flicks to ~0 and sits there — a nervous
// leftward dart every advance. This hook detects a whole-line jump and instead SWEEPS 0→1 across
// the new line at the reader's effective pace, so the eyes visibly "read along" between advances.
import { useEffect, useRef, useState } from 'react';

export function useLineSweep(doc, idx, wpm) {
  const [lp, setLp] = useState(0.5);
  const prevLine = useRef(-1);
  const raf = useRef(0);
  const lastSet = useRef(0.5);
  const wpmRef = useRef(wpm); wpmRef.current = wpm; // pace read live, not a dep (it ticks constantly)

  useEffect(() => {
    const li = doc.wordToLine[idx] ?? 0;
    const start = doc.lines[li]?.startWordIndex ?? 0;
    const end = li + 1 < doc.lines.length ? doc.lines[li + 1].startWordIndex : doc.words.length;
    const count = Math.max(2, end - start);
    const raw = (idx - start) / (count - 1);
    cancelAnimationFrame(raf.current);
    if (li === prevLine.current || raw > 0.05) {
      // Within-line motion (word stepping) — follow the real position directly.
      prevLine.current = li;
      lastSet.current = raw; setLp(raw);
      return undefined;
    }
    prevLine.current = li;
    // Whole-line advance: sweep across at the effective pace (clamped so one line is 0.9–15 s).
    const ms = Math.min(15000, Math.max(900, (count / Math.max(60, wpmRef.current || 250)) * 60000));
    const t0 = performance.now();
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      // ~2% steps keep re-renders to ≤50 per sweep instead of one per frame.
      if (f - lastSet.current >= 0.02 || f >= 1) { lastSet.current = f; setLp(f); }
      if (f < 1) raf.current = requestAnimationFrame(tick);
    };
    lastSet.current = 0; setLp(0);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [doc, idx]);

  return lp;
}
