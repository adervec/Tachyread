// Perceptual-span expansion drill. Flash a short horizontal run of words, then score how much the reader
// recalled. An adaptive staircase widens the span (then shortens the flash at max width) as they succeed,
// training the amount of text captured per fixation. Evidence: visual-span training raises reading speed.
// Pure (no React / no I/O).

export const DEFAULT_DRILL = Object.freeze({
  minSpan: 2, maxSpan: 9, span: 3,
  flashMs: 320, minFlashMs: 140, baseFlashMs: 320,
  passFrac: 0.7, // recall this fraction of the flashed words to advance
});

function clean(w) { return (w || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase(); }

// Pick a contiguous run of `span` words from doc.words at a random valid start. Returns { start, words } or null.
export function pickChunk(doc, span, rand = Math.random) {
  const words = doc && Array.isArray(doc.words) ? doc.words : null;
  if (!words || words.length < span || span < 1) return null;
  const start = Math.floor(rand() * (words.length - span + 1));
  return { start, words: words.slice(start, start + span) };
}

// Score typed recall against the flashed words: order-independent fraction of distinct flashed words recalled.
export function scoreRecall(flashed, typed) {
  const want = (flashed || []).map(clean).filter(Boolean);
  if (!want.length) return { matched: 0, total: 0, frac: 1 };
  const got = new Set((typed || '').split(/\s+/).map(clean).filter(Boolean));
  const used = new Set();
  let matched = 0;
  for (const w of want) { if (got.has(w) && !used.has(w)) { matched++; used.add(w); } }
  return { matched, total: want.length, frac: matched / want.length };
}

// Staircase: on a pass, widen the span; once at max width, shorten the flash. On a fail, restore the flash
// first, then narrow the span. Returns the next { span, flashMs }.
export function nextDrill(state, passed, opts = {}) {
  const o = { ...DEFAULT_DRILL, ...opts };
  let span = state.span, flashMs = state.flashMs;
  if (passed) {
    if (span < o.maxSpan) span += 1;
    else flashMs = Math.max(o.minFlashMs, Math.round(flashMs * 0.9));
  } else if (flashMs < o.baseFlashMs) {
    flashMs = Math.min(o.baseFlashMs, Math.round(flashMs / 0.9));
  } else {
    span = Math.max(o.minSpan, span - 1);
  }
  return { span, flashMs };
}
