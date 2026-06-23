// Small device / viewport helpers shared across the app. Kept framework-agnostic where possible
// so non-React modules (storage, engine) can call the plain functions too.
import { useEffect, useState } from 'react';

// The breakpoint the responsive CSS uses to stack panes (see App.css @media max-width: 860px).
export const COMPACT_MAX = 860;

export function isCoarsePointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

// "Compact" = use the phone/stacked layout. A narrow window is always compact (responsive desktop);
// additionally a TOUCH device is compact whenever its *shorter* side is small — so a phone/tablet
// stays in the mobile layout in landscape instead of flipping to the cramped multi-pane desktop one.
// The coarse-pointer gate keeps real laptops (e.g. 1366×768, fine pointer) on the desktop layout.
export function compactFor(w, h, coarse) {
  return w <= COMPACT_MAX || (coarse && Math.min(w, h) <= COMPACT_MAX);
}

export function isCompactScreen() {
  if (typeof window === 'undefined') return false;
  return compactFor(window.innerWidth, window.innerHeight, isCoarsePointer());
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
    const on = () => setCompact(isCompactScreen());
    on();
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return compact;
}
