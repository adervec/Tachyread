// Audiobook ↔ text sync: Whisper's word timings for YOUR audiobook files, aligned to the book's words,
// give a compact map [[wordIndex, fileIndex, ms], …]. Read-aloud then plays the real narration and
// moves the reading position with it (and seeks the audio when you move). Pure helpers here; the
// transcription runs in whisperWorker.js.

const norm = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

// Similarity 0–1 (Levenshtein ratio) — tolerant of Whisper's spellings ("colour"/"color", "Mr"/"Mister" won't, fine).
export function similar(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// Greedy monotonic alignment: walk the heard words in order; each one looks for its match among the
// next `window` book words after the last anchor. A match needs `minRun` consecutive heard words to
// line up (so one stray "the" can't jump the pointer), then every word of that run becomes an anchor.
// heard: [{ text, ms }] for one file. Returns { anchors: [[wordIndex, fileIndex, ms]], next } where
// `next` is the book position to continue from in the next file.
export function alignTranscript(docWords, heard, { fileIndex = 0, from = 0, window = 120, minRun = 3, minSim = 0.72 } = {}) {
  const doc = docWords.map(norm);
  const h = heard.map((x) => ({ w: norm(x.text), ms: x.ms })).filter((x) => x.w);
  const anchors = [];
  let pos = from, i = 0;
  while (i < h.length) {
    let hit = -1;
    for (let k = pos; k < Math.min(doc.length, pos + window); k++) {
      let ok = true;
      for (let r = 0; r < minRun && ok; r++) ok = i + r < h.length && k + r < doc.length && similar(h[i + r].w, doc[k + r]) >= minSim;
      if (ok) { hit = k; break; }
    }
    if (hit < 0) { i++; continue; } // a word that matches nothing ahead (misheard, ad-lib, "Chapter one" read aloud)
    let r = 0;
    while (i + r < h.length && hit + r < doc.length && similar(h[i + r].w, doc[hit + r]) >= minSim) { anchors.push([hit + r, fileIndex, Math.round(h[i + r].ms)]); r++; }
    pos = hit + r; i += r;
  }
  return { anchors, next: pos };
}

// Where to play from for a word: the last anchor at or before it (or the first anchor).
export function timeForWord(anchors, wi) {
  if (!anchors?.length) return null;
  let lo = 0, hi = anchors.length - 1, best = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (anchors[mid][0] <= wi) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  const a = anchors[best];
  return { file: a[1], ms: a[2] };
}

// Which word is being read at this point of this file: the last anchor at or before (file, ms).
export function wordForTime(anchors, file, ms) {
  let best = null;
  let lo = 0, hi = anchors.length - 1;
  const before = (a) => a[1] < file || (a[1] === file && a[2] <= ms);
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (before(anchors[mid])) { best = anchors[mid]; lo = mid + 1; } else hi = mid - 1; }
  return best ? best[0] : null;
}

// Share of the book the map covers (for the dialog's summary).
export const syncCoverage = (anchors, totalWords) => (anchors?.length && totalWords ? Math.min(1, (anchors[anchors.length - 1][0] - anchors[0][0] + 1) / totalWords) : 0);
