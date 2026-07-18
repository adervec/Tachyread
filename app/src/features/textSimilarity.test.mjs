// Run: node src/features/textSimilarity.test.mjs
import assert from 'node:assert';
import { textSignature, signatureSimilarity, similarityTier } from './textSimilarity.js';

const lorem = (seed, n) => {
  // xorshift + high-bit sampling over a 300-word vocab — low-bit LCG cycling made "unrelated"
  // fixtures genuinely share shingle runs.
  const vocab = Array.from({ length: 300 }, (_, i) => `w${i}`);
  const out = [];
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    out.push(vocab[(x >>> 8) % vocab.length]);
  }
  return out;
};

const A = lorem(1, 3000);
const B = lorem(2, 3000);              // unrelated text
const A2 = [...A];                      // light edit of A: change ~2% of words
for (let i = 0; i < A2.length; i += 50) A2[i] = 'edited';
const HALF = [...A.slice(0, 1500), ...B.slice(0, 1500)]; // half A, half B

const sA = textSignature(A);
const sB = textSignature(B);
assert.equal(signatureSimilarity(sA, sA), 1, 'identical text → 1');
assert.ok(signatureSimilarity(sA, sB) < 0.35, `unrelated texts stay low (${signatureSimilarity(sA, sB).toFixed(2)})`);
const edited = signatureSimilarity(sA, textSignature(A2));
assert.ok(edited > 0.5, `lightly edited copy reads as highly similar (${edited.toFixed(2)})`);
const half = signatureSimilarity(sA, textSignature(HALF));
assert.ok(half > 0.2 && half < 0.85, `half-shared text lands in the middle (${half.toFixed(2)})`);
assert.ok(edited > half, 'light edit ranks above half-share');

// Punctuation/case robustness: the same words with different punctuation are the same shingles.
const punct = A.map((w, i) => (i % 7 === 0 ? `${w[0].toUpperCase()}${w.slice(1)},` : w));
assert.equal(signatureSimilarity(sA, textSignature(punct)), 1, 'case/punctuation-insensitive');

// Edge cases.
assert.deepEqual(textSignature(['one', 'two']), [], 'shorter than one shingle → empty');
assert.equal(signatureSimilarity([], sA), 0, 'empty sketch → 0');

assert.equal(similarityTier(0.9).key, 'dup');
assert.equal(similarityTier(0.5).key, 'strong');
assert.equal(similarityTier(0.2).key, 'some');
assert.equal(similarityTier(0.05).key, 'none');
console.log('ok');
