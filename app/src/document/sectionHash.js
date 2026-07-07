// Content fingerprint of a word range [start, end). Case/whitespace/punctuation-insensitive, so the
// same chapter matches across editions and formats (PDF vs EPUB, reflowed, re-typeset) as long as the
// prose itself is unchanged. Two independent rolling hashes → 16 hex chars, to keep collisions
// negligible across a large library. Returns null for a range too short to fingerprint reliably.
// Pure; see sectionHash.demo.mjs.

const MIN_WORDS = 20;

function normWord(w) {
  return String(w || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function sectionChecksum(words, start, end) {
  if (!Array.isArray(words) && !ArrayBuffer.isView(words) && !(words && typeof words.length === 'number')) return null;
  let h1 = 5381, h2 = 52711, count = 0;
  const lo = Math.max(0, start | 0), hi = Math.min(end | 0, words.length);
  for (let i = lo; i < hi; i++) {
    const w = normWord(words[i]);
    if (!w) continue;
    for (let k = 0; k < w.length; k++) {
      const c = w.charCodeAt(k);
      h1 = ((h1 << 5) + h1 + c) >>> 0;      // djb2
      h2 = ((h2 << 5) + (h2 ^ c)) >>> 0;    // variant
    }
    h1 = (h1 + 0x9e3779b1) >>> 0;           // word separator
    h2 = Math.imul(h2, 16777619) >>> 0;
    count++;
  }
  if (count < MIN_WORDS) return null;
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
