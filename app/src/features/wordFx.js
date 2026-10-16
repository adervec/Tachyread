// Reading-aloud word effect: the words the text just moved past flash, more intensely the better
// they were read — a strong green glow for exact matches, softer for near-misses, a faint red for
// words skipped over. Transient (fades in ~1.5 s) and applied straight to the reader's word spans
// (data-wi), so nothing re-renders and nothing is stored.
//   style: 'glow' (colour + glow) · 'pop' (glow + a background flash on perfect words) · 'off'

// Keyframes for one word. q = match quality 0–1. Reduced motion: no pop flash (colour fade only).
export function fxKeyframes(q, style = 'glow', reducedMotion = false) {
  if (style === 'off') return null;
  if (q <= 0) {
    return [{ textDecorationColor: 'rgba(192,57,43,0.7)', color: 'rgba(192,57,43,0.85)' }, { textDecorationColor: 'transparent' }];
  }
  // Only an exact word gets the full glow; near-misses are clearly softer (0.9 → ~half, 0.6 → faint).
  const a = q >= 1 ? 1 : Math.min(0.7, Math.max(0.15, ((q - 0.5) / 0.5) * 0.7));
  const glow = `0 0 ${Math.round(4 + 10 * a)}px rgba(46,157,79,${(0.35 + 0.55 * a).toFixed(2)})`;
  const first = { color: `rgba(46,157,79,${(0.45 + 0.55 * a).toFixed(2)})`, textShadow: glow };
  if (style === 'pop' && !reducedMotion && q >= 0.95) first.backgroundColor = 'rgba(46,157,79,0.28)';
  return [first, { textShadow: '0 0 0 transparent', backgroundColor: 'transparent' }];
}

export function playWordFx(moves, style = 'glow', root = document) {
  if (style === 'off' || !moves?.length) return 0;
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let n = 0;
  for (const [i, q] of moves) {
    const frames = fxKeyframes(q, style, reduced);
    if (!frames) continue;
    for (const el of root.querySelectorAll(`.word[data-wi="${i}"]`)) {
      el.animate?.(frames, { duration: q > 0 ? 1500 : 900, easing: 'ease-out' });
      n++;
    }
  }
  return n;
}
