// Vocabulary harvesting: pull the rare/informative words out of a document so the reader can drill them.
// Rarity is judged by the surprisal word-frequency model (words not in the common set). Pure-ish (imports
// only the frequency helper).
import { wordWeight } from './surprisal.js';

const STRIP = /^[^\p{L}]+|[^\p{L}]+$/gu;

// Rare content words in `doc` not already in `existing` (lowercased word list). Returns [{ word, idx }]
// (first occurrence index), ranked hardest-first (by length as a difficulty proxy), capped at `max`.
export function harvestRare(doc, existing = [], max = 20) {
  if (!doc || !Array.isArray(doc.words)) return [];
  const have = new Set((existing || []).map((w) => (w || '').toLowerCase()));
  const seen = new Map();
  for (let i = 0; i < doc.words.length; i++) {
    const w = (doc.words[i] || '').replace(STRIP, '');
    const lw = w.toLowerCase();
    if (w.length < 6 || have.has(lw) || seen.has(lw)) continue;
    if (!/^\p{L}+$/u.test(w)) continue;     // letters only (skip numbers / mixed)
    if (wordWeight(w) < 1.2) continue;       // common word → skip
    seen.set(lw, { word: w, idx: i });
  }
  return [...seen.values()].sort((a, b) => b.word.length - a.word.length).slice(0, max);
}

// A context snippet (the sentence containing idx, else a word window) to show with a card.
export function contextAt(doc, idx, span = 12) {
  if (!doc || !Array.isArray(doc.words)) return '';
  let a = Math.max(0, idx - span), b = Math.min(doc.words.length, idx + span + 1);
  if (Array.isArray(doc.wordToSentence) && Array.isArray(doc.sentences)) {
    const s = doc.sentences[doc.wordToSentence[idx]];
    if (s) { a = s.startWordIndex; b = s.endWordIndex + 1; }
  }
  return doc.words.slice(a, b).join(' ').trim();
}
