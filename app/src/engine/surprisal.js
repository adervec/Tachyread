// Surprisal-weighted dwell: spend reading time where the *information* is. Reading time scales with a
// word's surprisal (−log p(word)); we approximate surprisal by word frequency. Common/predictable words
// get less dwell, rare/informative words get more — and the weights are mean-normalized per document so
// the *average* pace stays at the user's WPM (the time budget is redistributed, not inflated).

// The ~200 most-frequent English words (rank-ordered). Words not in this set are treated as rarer (more
// informative → more dwell). A small list already captures the dominant signal: function words speed up,
// content words slow down. It can be expanded later for finer weighting.
const COMMON = (
  'the be to of and a in that have i it for not on with he as you do at this but his by from they we ' +
  'say her she or an will my one all would there their what so up out if about who get which go me when ' +
  'make can like time no just him know take people into year your good some could them see other than ' +
  'then now look only come its over think also back after use two how our work first well way even new ' +
  'want because any these give day most us is are was were been has had said each more very through much ' +
  'before right too old same tell does set three must why ask went men read need land different home move ' +
  'try kind hand again change off play air away animal house point page letter mother answer found study ' +
  'should world high every near add food between own below country plant last school father keep tree never'
).split(/\s+/).filter(Boolean);

export const COMMON_WORDS = COMMON; // reused by the predictive Flow Writer
const RANK = new Map();
COMMON.forEach((w, i) => { if (!RANK.has(w)) RANK.set(w, i); });

const STRIP = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

// Raw dwell multiplier for one word (before per-doc normalization): ~0.7 for the commonest words rising
// to ~1.0 down the list, ~1.35 for words not in the common set (rare → more dwell).
export function wordWeight(word) {
  const w = (word || '').replace(STRIP, '').toLowerCase();
  if (!w) return 1;
  const r = RANK.get(w);
  if (r == null) return 1.35;
  return 0.7 + 0.3 * (r / COMMON.length);
}

// Per-document weights, mean-normalized to 1 (so average pace is preserved) and scaled by `strength`
// (0 = uniform/off, 1 = full redistribution). Returns a Float32Array aligned to `words`.
export function computeSurprisalWeights(words, strength = 1) {
  const n = Array.isArray(words) ? words.length : 0;
  const out = new Float32Array(n);
  if (!n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) { const w = wordWeight(words[i]); out[i] = w; sum += w; }
  const mean = sum / n || 1;
  const s = Math.max(0, Math.min(1.5, Number(strength) || 0));
  for (let i = 0; i < n; i++) {
    const norm = out[i] / mean;        // mean-normalized → mean 1
    let v = 1 + (norm - 1) * s;        // scaling deviation by strength keeps the mean at 1
    if (v < 0.45) v = 0.45; else if (v > 2.2) v = 2.2; // keep any single word readable
    out[i] = v;
  }
  return out;
}
