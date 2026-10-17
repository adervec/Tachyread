// Pure reconcile/cleanup helpers for the Trackyread library. Two jobs the user hits over time:
//   1. Finished books with no finish DATE — they count as "finished" (completion flag) yet never show
//      up in dated views. We date them from reading history where we can; the rest are surfaced so the
//      user can date or un-finish them deliberately (un-finishing real off-app reads would lose data).
//   2. Duplicate records — the same title+author stored under two ids (e.g. one gained an ISBN on a
//      re-import). We propose a merge that keeps the richer record and folds in the other's fields.
// No storage/React here so it's trivially testable — see journeyCleanup.demo.mjs.
import { finishMs } from './journeyLibrary.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

// Group key for near-duplicates: normalized title + the author's last token (tolerates "J.R.R.
// Tolkien" vs "Tolkien"). Same-ISBN dups can't occur here — deriveId already merges those on import.
export function dupKey(b) {
  const t = norm(b?.title);
  if (!t) return null; // untitled — never auto-group
  const author = norm(b?.author).split(' ').filter(Boolean);
  return `${t}@@${author[author.length - 1] || ''}`;
}

// How "authoritative" a record is when picking which of a duplicate pair to keep. Higher wins.
function keepScore(b) {
  const filled = Object.values(b).filter((v) => v !== '' && v != null && v !== false).length;
  return (b.completion === true ? 100 : 0) + (finishMs(b) != null ? 50 : 0)
    + (String(b.isbn || '').replace(/[^0-9xX]/g, '').length >= 10 ? 20 : 0) + Math.min(19, filled);
}

// Fold a duplicate INTO the keeper: only fill blanks (keeper's own values always win), but OR the
// finished flag and take the earliest known finish date — the first time it was actually completed.
export function mergeBooks(keep, dup) {
  const out = { ...keep };
  for (const [k, v] of Object.entries(dup)) {
    if (k === 'id' || k === 'updatedAt' || k === 'deleted') continue;
    if ((out[k] === undefined || out[k] === null || out[k] === '') && v !== undefined && v !== null && v !== '') out[k] = v;
  }
  if (dup.completion === true) out.completion = true;
  if (dup.inProgress) out.inProgress = out.inProgress || true;
  const km = finishMs(keep), dm = finishMs(dup);
  if (dm != null && (km == null || dm < km)) out.finishTime = dup.finishTime;
  return out;
}

// Duplicate groups → [{ key, keepId, dropIds, merged, titles }]. `merged` is the record to save under
// keepId; `dropIds` get tombstoned. Deterministic ordering (score then id) so previews are stable.
export function findDuplicates(books) {
  const groups = new Map();
  for (const b of books || []) {
    if (!b || b.deleted) continue;
    const k = dupKey(b);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const out = [];
  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => keepScore(b) - keepScore(a) || String(a.id).localeCompare(String(b.id)));
    const keep = sorted[0];
    const drop = sorted.slice(1);
    let merged = keep;
    for (const d of drop) merged = mergeBooks(merged, d);
    out.push({ key, keepId: keep.id, dropIds: drop.map((d) => d.id), merged, titles: arr.map((b) => b.title || '(untitled)') });
  }
  return out;
}

// Finished-book date issues. `dateFor(book)` returns a sourced finish date (e.g. from a linked
// document's last-read day) or null. Buckets:
//   datable       — finished, no date, and a date could be sourced → stamp it (safe).
//   contradictory — completion AND inProgress both set → clear inProgress (safe).
//   undatable     — finished, no date, nothing to source → surfaced only; clearing is opt-in.
export function finishedDateIssues(books, dateFor = () => null) {
  const datable = [], undatable = [], contradictory = [];
  for (const b of books || []) {
    if (!b || b.deleted) continue;
    if (b.completion === true && finishMs(b) == null) {
      const d = dateFor(b);
      if (d) datable.push({ id: b.id, title: b.title, date: d, fix: { ...b, finishTime: d, inProgress: false } });
      else undatable.push({ id: b.id, title: b.title, author: b.author, fix: { ...b, completion: false, inProgress: false } });
    } else if (b.completion === true && b.inProgress) {
      contradictory.push({ id: b.id, title: b.title, fix: { ...b, inProgress: false } });
    }
  }
  return { datable, undatable, contradictory };
}

// ── Quick-added copies of a recommended book ─────────────────────────────────────────────────────
// The common split: a recommendation entry with good metadata (author, ISBN, Open Library cover…)
// and a second entry made by "Add to Trackyread" when its file was opened — titled from the file
// name, no author, linked to the document, and the one you actually read and queued. findQuickAddPairs
// pairs them; mergeQuickInto folds the quick entry into the recommendation without losing anything.
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'by', 'with', 'vol', 'volume', 'book', 'edition', 'ebook', 'epub', 'pdf', 'mobi', 'azw3', 'txt', 'html', 'retail']);
const toks = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));
export const isQuickAdd = (b, linkedIds) => linkedIds.has(b.id) && !String(b.author || '').trim() && !String(b.recBy || '').trim();
const richness = (b) => ['author', 'isbn', 'coverId', 'pages', 'pubDate', 'genre', 'recScore'].filter((k) => b[k] != null && String(b[k]).trim() !== '').length;

// → [{ quick, keep, authorHit, alternatives }]. Every word of the recommendation's title must be in
// the quick entry's (file-derived) title, plus the author's surname — or the titles must be equal, or
// the title must be at least two words. A one-word title with no author in the file name is too weak.
export function findQuickAddPairs(books, bindMap = {}) {
  const linked = new Set(Object.values(bindMap || {}));
  const live = (books || []).filter((b) => b && !b.deleted);
  const rich = live.filter((b) => !isQuickAdd(b, linked) && String(b.author || '').trim());
  const out = [];
  for (const q of live.filter((b) => isQuickAdd(b, linked))) {
    const qt = new Set(toks(q.title));
    if (!qt.size) continue;
    const cands = [];
    for (const r of rich) {
      const rt = toks(r.title);
      if (!rt.length || !rt.every((w) => qt.has(w))) continue;
      const at = toks(r.author);
      const authorHit = at.length > 0 && qt.has(at[at.length - 1]);
      const exact = norm(q.title) === norm(r.title);
      if (!authorHit && !exact && rt.length < 2) continue;
      const extra = [...qt].filter((w) => !rt.includes(w) && !at.includes(w) && !/^\d+$/.test(w)).length;
      cands.push({ r, authorHit, score: rt.length * 2 + (authorHit ? 3 : 0) + (exact ? 2 : 0) - extra * 0.5 + richness(r) * 0.1 });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => b.score - a.score || String(a.r.id).localeCompare(String(b.r.id)));
    out.push({ quick: q, keep: cands[0].r, authorHit: cands[0].authorHit, alternatives: cands.slice(1).map((c) => c.r) });
  }
  return out;
}

// The quick entry folded into the keeper: keeper's metadata wins, blanks fill from the quick entry,
// reading state (started / reading / finished, dates, rating) comes across, the opened file's real
// word count replaces a page estimate, both notes are kept, and the whole quick record is stored in
// `mergedFrom` — so nothing is lost and the merge can be undone.
export function mergeQuickInto(keep, quick, now = Date.now()) {
  const out = mergeBooks(keep, quick);
  if (Number(quick.words) > 0) out.words = Number(quick.words);
  const kn = String(keep.notes || '').trim(), qn = String(quick.notes || '').trim();
  if (kn && qn && kn !== qn) out.notes = `${kn}\n\n${qn}`;
  // You read the quick copy — an On-deck shelf on the recommendation shouldn't mask that.
  if ((quick.inProgress || quick.completion === true) && out.shelf === 'queue') delete out.shelf;
  out.mergedFrom = [...(keep.mergedFrom || []), { at: new Date(now).toISOString(), record: quick }];
  return out;
}

// What changed on a record, for the preview: [{ key, from, to }] (bookkeeping fields left out).
export function bookDiff(before, after) {
  const skip = new Set(['mergedFrom', 'updatedAt', 'id', 'deleted']);
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((k) => !skip.has(k) && JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((k) => ({ key: k, from: before?.[k], to: after?.[k] }));
}
