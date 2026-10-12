// Read-aloud advance: line up what the speech recogniser heard with the text ahead of the reader,
// and say how far to move. Forgiving both ways — misheard or skipped words don't stall it — while a
// grunt or a single stray word can't move it:
//   window — how far ahead (words) your reading may start: words you skip over are allowed
//   skip   — text words that may go unheard between two matched words. Every heard word that
//            matched nothing widens this by one (you said SOMETHING for that text word)
//   fuzz   — how alike a heard word must be to the text word (0–1, 1 = exact)
//   minRun — matched words needed before anything moves
// Punctuation never matters: text tokens are split on it ("stairs—every" is two words, a lone "—"
// is nothing), and common sound-alikes / digits are folded together ("two" = "to" = "2").

export const SPEAK_DEFAULTS = { window: 10, skip: 3, fuzz: 0.6, minRun: 2 };

// One "Strictness" slider (on the reading-aloud card) sets all four at once.
export const STRICTNESS = [
  null,
  { label: 'very forgiving', window: 14, skip: 5, fuzz: 0.5, minRun: 1 },
  { label: 'forgiving', window: 10, skip: 3, fuzz: 0.6, minRun: 2 },
  { label: 'balanced', window: 8, skip: 2, fuzz: 0.7, minRun: 2 },
  { label: 'strict', window: 6, skip: 1, fuzz: 0.8, minRun: 3 },
  { label: 'very strict', window: 4, skip: 0, fuzz: 0.9, minRun: 3 },
];
export function strictnessOf(cfg = {}) {
  const c = { ...SPEAK_DEFAULTS, ...cfg };
  const i = STRICTNESS.findIndex((p) => p && p.window === c.window && p.skip === c.skip && p.fuzz === c.fuzz && p.minRun === c.minRun);
  return i > 0 ? i : null; // null = custom values from Settings
}

const SAME = {};
for (const group of [
  'to too two 2', 'for four 4', 'one won 1', 'there their theyre', 'your youre', 'whose whos',
  'no know', 'new knew', 'by buy bye', 'right write', 'here hear', 'ate eight 8', 'three 3', 'five 5',
  'six 6', 'seven 7', 'nine 9', 'ten 10', 'zero 0', 'okay ok', 'mr mister', 'mrs missus', 'dr doctor', 'st saint',
]) { const ws = group.split(' '); for (const w of ws) SAME[w] = ws[0]; }

const clean = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '');
// A token's spoken parts: split on anything that isn't a letter/digit, fold sound-alikes.
export const partsOf = (w) => clean(w).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((p) => SAME[p] || p);
export const normWord = (w) => partsOf(w).join('');

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

// Full alignment with a trace for the card: { to, start, matched, pairs: [{ w, i (doc word index or
// null), stale }] } or null. `idx` = the reader's current word.
export function alignDetail(docWords, idx, heard, opts = {}) {
  const { window, skip, fuzz, minRun } = { ...SPEAK_DEFAULTS, ...opts };
  const H = String(heard || '').split(/\s+/).flatMap(partsOf);
  if (!H.length) return null;
  // The text ahead as a flat stream of spoken parts, each remembering its word.
  const D = [], owner = [];
  const last = Math.min(docWords.length, idx + window + H.length * (skip + 2) + 8);
  let windowEnd = 0;
  for (let i = idx; i < last; i++) {
    for (const p of partsOf(docWords[i])) { D.push(p); owner.push(i); }
    if (i === Math.min(docWords.length, idx + window) - 1) windowEnd = D.length;
  }
  if (!windowEnd) windowEnd = D.length;
  // Prefer the match that STARTS nearest the reader, then the one reaching furthest: in repetitive
  // text, stale words from earlier in the phrase would otherwise align further down and jump ahead.
  let best = null;
  for (let h0 = 0; h0 < H.length; h0++) {
    for (let s = 0; s < windowEnd; s++) {
      if (!wordsMatch(H[h0], D[s], fuzz)) continue;
      const pairs = H.slice(0, h0).map((w) => ({ w, i: null, stale: true }));
      pairs.push({ w: H[h0], i: owner[s] });
      let d = s + 1, matched = 1, miss = 0;
      for (let h = h0 + 1; h < H.length; h++) {
        const top = Math.min(D.length - 1, d + skip + miss);
        // An exact match anywhere in the look-ahead beats an earlier near-miss ("sixth" vs "fifth").
        let hit = -1;
        for (let j = d; j <= top; j++) if (D[j] === H[h]) { hit = j; break; }
        if (hit < 0) for (let j = d; j <= top; j++) if (wordsMatch(H[h], D[j], fuzz)) { hit = j; break; }
        if (hit >= 0) { d = hit + 1; matched++; miss = 0; pairs.push({ w: H[h], i: owner[hit] }); }
        else { miss++; pairs.push({ w: H[h], i: null }); }
      }
      const to = owner[d - 1] + 1;
      if (matched >= minRun && (!best || s < best.s || (s === best.s && to > best.to))) best = { s, to, start: owner[s], matched, pairs };
    }
  }
  if (!best || best.to <= idx) return null;
  const { s, ...out } = best; // eslint-disable-line no-unused-vars
  return out;
}

// docWords: the document's words; idx: the reader's current word; heard: the recognised phrase.
// Returns the index to move to (just past the last matched word), or null to stay put.
export const alignSpoken = (docWords, idx, heard, opts = {}) => alignDetail(docWords, idx, heard, opts)?.to ?? null;

// Normal alignment near the reader; failing that, a wider search (you started reading somewhere
// else on the page) that needs a longer matching run, so a lost position re-finds itself without
// letting a couple of common words yank it far ahead.
export const RESYNC_WINDOW = 80;
export function alignOrResync(docWords, idx, heard, opts = {}) {
  const near = alignDetail(docWords, idx, heard, opts);
  if (near) return { ...near, resync: false };
  const minRun = Math.max(3, (opts.minRun ?? SPEAK_DEFAULTS.minRun) + 2);
  const far = alignDetail(docWords, idx, heard, { ...opts, window: RESYNC_WINDOW, minRun });
  return far ? { ...far, resync: true } : null;
}

// The strictness actually in force for a tab. Tabs saved with the first release's defaults
// (window 6 · skip 2 · fuzz 0.7 · run 2) were too brittle and get today's defaults instead.
const FIRST_DEFAULTS = { window: 6, skip: 2, fuzz: 0.7, minRun: 2 };
export function speakParams(cfg = {}) {
  const c = { ...SPEAK_DEFAULTS, ...cfg };
  const old = Object.keys(FIRST_DEFAULTS).every((k) => c[k] === FIRST_DEFAULTS[k]);
  const p = old ? SPEAK_DEFAULTS : c;
  return { window: p.window, skip: p.skip, fuzz: p.fuzz, minRun: p.minRun };
}
