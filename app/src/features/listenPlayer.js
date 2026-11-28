// The listen-only player (phone): plays the listen queue straight from the clips the sync machine
// rendered and this device pulled (listenCloud.js), with no book file here. The cloud listen list
// carries each chunk's text and each book's order, length and last chunk; positions are the synced
// reading positions, so stopping on the phone and opening the book on the desktop pick up together.

// manifest: { books: { [cs]: { title, author, order, totalWords, lastLine, chunks: { [line]: { endLine,
//   startWordIndex, endWordIndex, durationMs, id, text } } } } }; pos: { [cs]: wordIndex }
// → [{ cs, title, author, line, startWordIndex, endWordIndex, ms, id, text, last }] from each book's
//   position on, books in queue order. `last` = the book's final chunk (playing it finishes the book).
export function playlist(manifest, pos = {}) {
  const books = Object.entries(manifest?.books || {})
    .sort(([, a], [, b]) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.title || '').localeCompare(String(b.title || '')));
  const out = [];
  for (const [cs, b] of books) {
    const at = pos[cs] || 0;
    for (const [line, c] of Object.entries(b.chunks || {}).sort(([x], [y]) => x - y)) {
      if (c.endWordIndex < at) continue; // heard
      out.push({ cs, title: b.title || b.fileName || '', author: b.author || '', line: +line, startWordIndex: c.startWordIndex, endWordIndex: c.endWordIndex, ms: c.durationMs || 0, id: c.id, text: c.text || '', last: b.lastLine != null && +line === b.lastLine });
    }
  }
  return out;
}

// How far through each book (0–1), for the list: position over its length.
export const bookShare = (b, at) => (b?.totalWords ? Math.min(1, (at || 0) / b.totalWords) : 0);
