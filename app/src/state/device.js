// Small device / viewport helpers shared across the app. Kept framework-agnostic where possible
// so non-React modules (storage, engine) can call the plain functions too.
import { useEffect, useState } from 'react';

// The breakpoint the responsive CSS uses to stack panes (see App.css @media max-width: 860px).
export const COMPACT_MAX = 860;

export function isCompactScreen() {
  return typeof window !== 'undefined' && window.innerWidth <= COMPACT_MAX;
}

export function isCoarsePointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

// Coarse label for "what kind of device am I" — recorded against typing/reading sessions so the
// history can distinguish a phone run from a desktop run. Intentionally a 2-bucket guess, not a
// full UA parse: compact screen OR coarse pointer → Mobile, else Desktop.
export function deviceKind() {
  return isCompactScreen() || isCoarsePointer() ? 'Mobile' : 'Desktop';
}

// React hook: true while the viewport is at/under the compact breakpoint. Re-evaluates on resize
// and orientation change so a rotate or window-resize flips layouts without a reload.
export function useIsCompact() {
  const [compact, setCompact] = useState(isCompactScreen);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${COMPACT_MAX}px)`);
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return compact;
}
