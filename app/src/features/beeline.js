// BeeLine-style line gradients: text fades from the base colour into an accent across one visual
// line and back out across the next (base→blue, blue→base, base→red, red→base…), so the eye can
// follow the colour from the end of a line to the start of the next.
// rects: each word's {top, left, width} (px, same frame as boxLeft); lineIndex staggers the cycle
// per source line. Returns per word { accent: 1|2, pct: 0–strength } — how much accent to mix in.
// ponytail: visual lines are counted within one source line; a long wrapped row can put the next
// row one phase off. Fine for reading; track a running visual-line count if it ever matters.
export function beelineMix(rects, boxLeft, boxWidth, lineIndex, strength = 70) {
  const out = [];
  let row = 0, prevTop = null;
  for (const r of rects) {
    if (prevTop != null && r.top > prevTop + 2) row++;
    prevTop = r.top;
    const phase = (lineIndex + row) % 4;
    const f = boxWidth > 0 ? Math.max(0, Math.min(1, (r.left + r.width / 2 - boxLeft) / boxWidth)) : 0;
    const amount = phase % 2 === 0 ? f : 1 - f; // fade in across even phases, out across odd
    out.push({ accent: phase < 2 ? 1 : 2, pct: Math.round(amount * strength) });
  }
  return out;
}
