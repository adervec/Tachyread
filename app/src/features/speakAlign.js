// Read-aloud advance: line up what the speech recogniser heard with the text ahead of the reader,
// and say how far to move. Tolerant both ways — a missed or misheard word doesn't stall it, and a
// grunt or a single stray word can't move it:
//   window — how far ahead (words) your reading may start: words you skip over are allowed
//   skip   — words the text may run ahead of you between two matched words
//   fuzz   — how alike a heard word must be to the text word (0–1, 1 = exact)
//   minRun — matched words needed before anything moves
// Heard words that match nothing (ums, stale words from earlier in the phrase) are ignored.

export const SPEAK_DEFAULTS = { window: 6, skip: 2, fuzz: 0.7, minRun: 2 };

export const normWord = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

function lev(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return prev[b.length];
}

// Short words must match exactly — "a"/"I"/"of" are too easy to hit by accident.
export function wordsMatch(heard, text, fuzz = SPEAK_DEFAULTS.fuzz) {
  if (!heard || !text) return false;
  if (heard === text) return true;
  if (heard.length <= 3 || text.length <= 3) return false;
  return 1 - lev(heard, text) / Math.max(heard.length, text.length) >= fuzz;
}

// docWords: the document's words; idx: the reader's current word; heard: the recognised phrase.
// Returns the index to move to (just past the last matched word), or null to stay put.
export function alignSpoken(docWords, idx, heard, opts = {}) {
  const { window, skip, fuzz, minRun } = { ...SPEAK_DEFAULTS, ...opts };
  const H = String(heard || '').split(/\s+/).map(normWord).filter(Boolean);
  if (!H.length) return null;
  const doc = (i) => normWord(docWords[i]);
  const end = Math.min(docWords.length, idx + window);
  // Prefer the match that STARTS nearest the reader, then the one reaching furthest: in repetitive
  // text, stale words from earlier in the phrase would otherwise align further down and jump ahead.
  let best = null, bestStart = Infinity;
  for (let h0 = 0; h0 < H.length; h0++) {
    for (let s = idx; s < end; s++) {
      if (!wordsMatch(H[h0], doc(s), fuzz)) continue;
      let d = s + 1, matched = 1;
      for (let h = h0 + 1; h < H.length; h++) {
        // An exact match anywhere in the look-ahead beats an earlier near-miss ("sixth" vs "fifth").
        const top = Math.min(docWords.length - 1, d + skip);
        let hit = -1;
        for (let j = d; j <= top; j++) if (doc(j) === H[h]) { hit = j; break; }
        if (hit < 0) for (let j = d; j <= top; j++) if (wordsMatch(H[h], doc(j), fuzz)) { hit = j; break; }
        if (hit >= 0) { d = hit + 1; matched++; }
      }
      if (matched >= minRun && (s < bestStart || (s === bestStart && d > best))) { best = d; bestStart = s; }
    }
  }
  return best != null && best > idx ? best : null;
}

// Normal alignment near the reader; failing that, a wider search (you started reading somewhere
// else on the page) that needs a longer matching run, so a lost position re-finds itself without
// letting a couple of common words yank it far ahead.
export const RESYNC_WINDOW = 80;
export function alignOrResync(docWords, idx, heard, opts = {}) {
  const near = alignSpoken(docWords, idx, heard, opts);
  if (near != null) return { to: near, resync: false };
  const minRun = Math.max(3, (opts.minRun ?? SPEAK_DEFAULTS.minRun) + 2);
  const far = alignSpoken(docWords, idx, heard, { ...opts, window: RESYNC_WINDOW, minRun });
  return far != null ? { to: far, resync: true } : null;
}
