// "Open untracked only" / "Open unfinished only": filters for the File menu's open pickers.
//
// Select a folder full of documents and most of them are usually ones you have already dealt with.
// These filters let the open itself do the triage — a document that turns out to be already tracked
// (or already finished) is dropped instead of becoming a tab. A document has to be parsed before its
// content checksum is known, so the decision necessarily happens after the read and before the tab:
// nothing is opened and closed again, it simply never opens.
//
// Pure; see openFilter.test.mjs. The context loader below is the only part that touches storage.
import { readStatus } from './journeyLibrary.js';
import { finishedNotRereading } from './recentFilter.js';
import { getBinding, getLibraryBook, allFiles } from '../state/storage.js';

export const OPEN_ONLY_LABEL = { untracked: 'already in Trackyread', unfinished: 'already finished' };

// Why this document should not be opened under `mode`, or null to open it. `mode` null = open
// everything, so the ordinary File → Open path shares one code path with the filtered ones.
export function skipOpen(mode, info = {}) {
  const { bound = false, book = null, rec = null, shelf } = info;
  if (mode === 'untracked') return bound ? OPEN_ONLY_LABEL.untracked : null;
  if (mode === 'unfinished') {
    // The tracker's own verdict first; failing that, the file's reading record — which is what marks
    // a book finished for someone who never linked it. Both let a re-read through.
    if (book && readStatus(book) === 'finished') return OPEN_ONLY_LABEL.unfinished;
    return finishedNotRereading(rec, shelf) ? OPEN_ONLY_LABEL.unfinished : null;
  }
  return null;
}

// Read the binding map and file records once for a whole batch; books are fetched per document
// (there are only ever a handful) rather than pulling the entire shelf.
export async function openFilterContext(shelves = {}) {
  const [bind, files] = await Promise.all([getBinding().catch(() => ({})), allFiles().catch(() => [])]);
  const recs = {};
  for (const f of files || []) { const cs = f.checksum || f.contentChecksum; if (cs) recs[cs] = f; }
  return async function infoFor(checksum) {
    const id = bind?.[checksum] || null;
    const book = id ? await getLibraryBook(id).catch(() => null) : null;
    return { bound: !!id, book: book && !book.deleted ? book : null, rec: recs[checksum] || null, shelf: shelves[checksum] };
  };
}
