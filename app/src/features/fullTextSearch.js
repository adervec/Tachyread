// Library-wide search: every document whose text is stored on this device (the `docs` store that
// also restores tabs). Plain substring match, case-insensitive unless asked; per document we keep
// the match count and the first few hits with a little context either side.
// ponytail: linear scan of each stored text per query — fine for hundreds of books; build an
// inverted index if a library ever makes this slow.
export function findInText(text, query, { caseSensitive = false, max = 3, ctx = 60 } = {}) {
  const q = String(query || '');
  if (!text || q.length < 2) return { count: 0, hits: [] };
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  const hits = [];
  let count = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    count++;
    if (hits.length < max) {
      const a = Math.max(0, i - ctx), b = Math.min(text.length, i + q.length + ctx);
      hits.push({
        pos: i,
        before: (a > 0 ? '…' : '') + text.slice(a, i).replace(/\s+/g, ' '),
        match: text.slice(i, i + q.length),
        after: text.slice(i + q.length, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : ''),
      });
    }
  }
  return { count, hits };
}
