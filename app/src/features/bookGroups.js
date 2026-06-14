// Book groups — declare several files (different content checksums, e.g. different editions/scans
// or a one-character-off copy of the same book) as ONE logical book, so reading progress syncs
// across them. The exact read mask can't transfer between editions that differ, so progress is
// shared as a PERCENTAGE: opening any member resumes at the furthest point any edition reached.
// Deliberately fuzzy — if two grouped files are genuinely different this mis-tracks, but it spares
// the user from losing their place over a trivial difference between copies.

export function groupForChecksum(groups, checksum) {
  if (!checksum) return null;
  return (groups || []).find((g) => (g.members || []).includes(checksum)) || null;
}

// Fraction [0,1] read of a FileSettings-shaped record (resume cursor over its own word count).
export function percentOf(rec) {
  if (!rec || !rec.totalWords) return 0;
  return Math.min(1, Math.max(0, (rec.wordIndex || 0) / rec.totalWords));
}

// Furthest percent reached across a group: this file's own percent vs. each sibling's.
export function bestGroupPercent(thisPercent, siblingRecs) {
  let best = thisPercent || 0;
  for (const r of siblingRecs || []) best = Math.max(best, percentOf(r));
  return best;
}

const uid = () => Math.random().toString(36).slice(2);

// Create a group from a set of checksums (dedup, drop falsy). Returns null if fewer than 2 members.
export function makeGroup(name, members, createdAt) {
  const uniq = [...new Set((members || []).filter(Boolean))];
  if (uniq.length < 2) return null;
  return { id: uid(), name: (name || '').trim() || 'Untitled book', members: uniq, createdAt: createdAt || 0 };
}
