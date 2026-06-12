// Predictive text entry for the Flow Writer (output-rate trainer). Output-per-keystroke is the lever for
// fast text output — stenographers hit ~3× QWERTY by emitting whole words per stroke. These helpers let a
// few keystrokes yield whole words. Pure (no React / no I/O).

const STRIP = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
function clean(w) { return (w || '').replace(STRIP, '').toLowerCase(); }

// Build a frequency-ranked dictionary (most frequent first) from base common words plus a frequency count
// over extra words (e.g. the open document, so domain terms predict too).
export function buildDict(base, extraWords) {
  const score = new Map();
  (base || []).forEach((w, i) => { const k = clean(w); if (k) score.set(k, (base.length - i) + 2000); });
  for (const w of (extraWords || [])) { const k = clean(w); if (k.length >= 3) score.set(k, (score.get(k) || 0) + 3); }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

// Best completion suffix for a prefix: the most frequent dictionary word that starts with the (lowercased)
// prefix and is strictly longer. Returns the suffix to append, or '' if none / the prefix is too short.
export function completeWord(prefix, dict, minPrefix = 2) {
  const p = clean(prefix);
  if (p.length < minPrefix || !dict) return '';
  for (const w of dict) { if (w.length > p.length && w.startsWith(p)) return w.slice(p.length); }
  return '';
}

// Throughput metrics: net WPM (chars/5 per minute) and amplification (characters output per keystroke).
export function throughput(chars, keystrokes, ms) {
  const min = ms > 2000 ? ms / 60000 : 0; // ignore the first ~2s — too little time for a meaningful WPM
  const wpm = min > 0 ? Math.round((chars / 5) / min) : 0;
  const amplification = keystrokes > 0 ? Math.round((chars / keystrokes) * 100) / 100 : 0;
  return { wpm, amplification };
}
