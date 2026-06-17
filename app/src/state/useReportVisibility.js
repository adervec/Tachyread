import { useEffect, useRef } from 'react';

// Attach the returned ref to an element; `onChange(visible)` fires as it enters/leaves the viewport
// (>= 30% on screen counts as visible). Reports false on unmount so a torn-down pane counts as
// hidden. Used to pause non-TTS reading when the text you'd be reading isn't actually on screen.
export function useReportVisibility(onChange) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { cb.current?.(true); return undefined; }
    const io = new IntersectionObserver(
      (entries) => { for (const e of entries) cb.current?.(e.isIntersecting && e.intersectionRatio >= 0.3); },
      { threshold: [0, 0.3, 0.6, 1] },
    );
    io.observe(el);
    return () => { io.disconnect(); cb.current?.(false); };
  }, []);
  return ref;
}
