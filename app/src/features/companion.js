// Side-by-side reading: where the companion document should be for a reading position. Same
// RELATIVE position — word fraction of the main book → the matching line of the companion.
import { getLineIndex } from '../document/readerDocument.js';

export function companionLine(wordIndex, totalWords, doc) {
  if (!doc?.words?.length) return 0;
  const frac = totalWords > 1 ? Math.min(1, Math.max(0, wordIndex / (totalWords - 1))) : 0;
  return getLineIndex(doc, Math.round(frac * (doc.words.length - 1)));
}
