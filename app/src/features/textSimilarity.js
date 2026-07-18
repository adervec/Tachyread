// Fuzzy whole-text similarity for "is this new file like something I've already read?".
// Bottom-k sketch of hashed k-word shingles: each text becomes its `size` smallest shingle hashes,
// and the overlap of two sketches estimates the Jaccard similarity of the full shingle sets. Unlike
// the exact section hashes (sectionHash.js), this survives edition differences, small edits, and
// different chapter splits. Pure — see textSimilarity.test.mjs.
// ponytail: bottom-k Jaccard is a coarse estimator (±a few % at k=256); MinHash-per-permutation
// would tighten it if ranking quality ever matters.

const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Sketch of the text's k-word shingles: the `size` smallest distinct djb2 hashes, ascending.
export function textSignature(words, { k = 5, size = 256 } = {}) {
  const toks = (words || []).map(norm).filter(Boolean);
  if (toks.length < k) return [];
  const hs = new Set();
  for (let i = 0; i + k <= toks.length; i++) {
    let x = 5381;
    for (let j = i; j < i + k; j++) {
      const s = toks[j];
      for (let c = 0; c < s.length; c++) x = ((x * 33) ^ s.charCodeAt(c)) >>> 0;
      x = ((x * 33) ^ 32) >>> 0; // token separator so ["ab","c"] ≠ ["a","bc"]
    }
    hs.add(x);
  }
  return [...hs].sort((a, b) => a - b).slice(0, size);
}

// Jaccard estimate from two sketches: the fraction of the union's bottom-k that both sets contain.
// 1 = same text, 0 = nothing shared. Symmetric; safe on empty sketches.
export function signatureSimilarity(a, b) {
  if (!a?.length || !b?.length) return 0;
  const kk = Math.min(Math.max(a.length, b.length), 256);
  const inA = new Set(a);
  const inB = new Set(b);
  const union = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, kk);
  let both = 0;
  for (const v of union) if (inA.has(v) && inB.has(v)) both++;
  return union.length ? both / union.length : 0;
}

// Human tier for a similarity score (UI labels).
export function similarityTier(sim) {
  if (sim >= 0.8) return { key: 'dup', label: 'near-duplicate' };
  if (sim >= 0.4) return { key: 'strong', label: 'strong overlap' };
  if (sim >= 0.12) return { key: 'some', label: 'some overlap' };
  return { key: 'none', label: 'no meaningful overlap' };
}
