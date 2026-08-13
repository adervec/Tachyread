// Progress + ETA for a long TTS generation run.
//
// The naive ETA (chunks done / chunks total, scaled by elapsed) swings wildly because chunks are
// not the same size — a one-line heading and a 400-word paragraph both count as "1 chunk", so the
// estimate lurches every time the run crosses between them. Synthesis time tracks CHARACTERS far
// more closely than chunk count, so the estimate here is character-weighted and cumulative: it
// converges instead of oscillating, and after a handful of chunks it is close to exact.

export const chunkChars = (c) => String(c?.text || '').trim().length;
export const totalChars = (chunks) => (chunks || []).reduce((a, c) => a + chunkChars(c), 0);

// Seconds remaining. Cumulative (not per-chunk) so it smooths itself, and null until there's enough
// signal to be worth showing — a first estimate off one short chunk is noise dressed up as a number.
export function etaSeconds({ elapsedMs = 0, charsDone = 0, charsTotal = 0, minChars = 400 } = {}) {
  if (!(elapsedMs > 0) || !(charsDone >= minChars) || !(charsTotal > charsDone)) return null;
  return ((charsTotal - charsDone) * (elapsedMs / charsDone)) / 1000;
}

// How the CURRENT chunk is behaving. A long chunk legitimately takes longer, so "slow" is measured
// against what this chunk should cost at the run's own measured rate — not a flat timeout.
export function chunkHealth({ chunkElapsedMs = 0, chunkChars: n = 0, msPerChar = 0, slowFactor = 3, stallFactor = 8 } = {}) {
  // No rate yet (first chunk): fall back to wall-clock limits so a hang is still visible.
  const expected = msPerChar > 0 && n > 0 ? msPerChar * n : 0;
  if (!expected) {
    if (chunkElapsedMs > 60000) return 'stalled';
    if (chunkElapsedMs > 20000) return 'slow';
    return 'ok';
  }
  if (chunkElapsedMs > expected * stallFactor) return 'stalled';
  if (chunkElapsedMs > expected * slowFactor) return 'slow';
  return 'ok';
}

export function fmtEta(secs) {
  if (secs == null || !isFinite(secs) || secs < 0) return '—';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// A short, single-line preview of what's being spoken right now.
export function previewText(text, max = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
