// Turn a just-opened document into a Trackyread library book. Used by the "Add to Trackyread" nudge
// that appears when an untracked document is opened, so it lands in the tracker (status: reading)
// with a sensible title + word count, ready to bind by checksum. Pure; see trackyreadAdd.test.mjs.
import { deriveId, setReadStatus } from './journeyLibrary.js';

// A readable title from a file name: drop the extension, turn separators into spaces, collapse space.
export function titleFromFileName(name) {
  return String(name || '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')     // extension
    .replace(/[._]+/g, ' ')                // dots/underscores → spaces
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

// Build a library book for a freshly opened doc. status defaults to 'reading' (you opened it to read).
// recBy: '' so it reads as a user-added book, not a Claude recommendation.
export function bookFromOpenedDoc({ fileName, words = 0, status = 'reading' } = {}) {
  const title = titleFromFileName(fileName);
  const base = { id: deriveId({ title }), title, recBy: '' };
  if (Number(words) > 0) { base.words = Number(words); base.pages = Math.max(1, Math.round(Number(words) / 275)); }
  return setReadStatus(base, status);
}
