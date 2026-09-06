// Download-folder sync for the audiobook command centre: which folders exist, which books belong
// to which folder, and — the part that earns its keep — WHICH track files actually need rewriting
// after a (re)generation. Pure (no File System Access, no IndexedDB) so it is node-testable; the
// directory handles ride along inside folder records untouched. The browser-side engine that
// assembles and writes the files lives in AudiobookDialog.
import { readStatus } from './journeyLibrary.js';

// A download folder is partitioned by Trackyread status — <folder>/<shelf>/<book>/ — so a player
// shows Reading / Finished / … shelves. Fixed on-disk names (not STATUS_LABEL) so a relabel in the
// tracker never moves every book. ponytail: whole-document bindings only; a document tracked only
// through section bindings (an anthology) counts as untracked.
export const SHELF_DIR = { reading: 'Reading', queue: 'On deck', toread: 'To read', finished: 'Finished', abandoned: 'Abandoned' };
export const UNTRACKED_DIR = 'Untracked';
export function shelfFor(binding, books, checksum) {
  const id = binding?.[checksum];
  const b = id && (books || []).find((x) => x?.id === id);
  return b ? SHELF_DIR[readStatus(b)] : UNTRACKED_DIR;
}

// Identity of one planned track: the ordered clip ids it would be assembled from. A regenerated
// chunk gets a NEW top clip id, so its track's signature changes and only that file is rewritten.
export function trackSig(track) {
  return (track.items || [])
    .map((it) => (it.kind === 'sec' ? `s:${it.role}:${it.clipId}` : `c:${it.startLine}:${it.clipId || '?'}`))
    .join(',');
}

// Diff a fresh track plan against what a folder last received (prev = { fileName: sig }).
// Returns { write: [trackIndex], remove: [fileName], next: { fileName: sig } }.
export function diffSync(tracks, names, prev = {}) {
  const write = [];
  const next = {};
  tracks.forEach((t, i) => {
    const sig = trackSig(t);
    next[names[i]] = sig;
    if (prev[names[i]] !== sig) write.push(i);
  });
  const remove = Object.keys(prev).filter((n) => !(n in next));
  return { write, remove, next };
}

// ── folder-list bookkeeping (plain immutable array ops; `handle` is opaque here) ──
export function addFolder(list, rec) {
  if (!rec?.id) return list;
  if (list.some((f) => f.id === rec.id)) return list;
  return [...list, { autoSync: true, books: {}, ...rec }];
}
export function removeFolder(list, id) { return list.filter((f) => f.id !== id); }
export function patchFolder(list, id, patch) {
  return list.map((f) => (f.id === id ? { ...f, ...patch } : f));
}
export function assignBook(list, id, checksum, fileName) {
  if (!checksum) return list;
  return list.map((f) => {
    if (f.id !== id || f.books?.[checksum]) return f;
    return { ...f, books: { ...f.books, [checksum]: { fileName: fileName || 'Document', tracks: {}, syncedAt: 0 } } };
  });
}
export function unassignBook(list, id, checksum) {
  return list.map((f) => {
    if (f.id !== id || !f.books?.[checksum]) return f;
    const books = { ...f.books };
    delete books[checksum];
    return { ...f, books };
  });
}
// Record what a folder now holds for a book (called after a successful sync).
export function setFolderBook(list, id, checksum, bookRec) {
  return list.map((f) => (f.id === id ? { ...f, books: { ...f.books, [checksum]: bookRec } } : f));
}
export function foldersForBook(list, checksum, { auto = false } = {}) {
  return (list || []).filter((f) => f.books?.[checksum] && (!auto || f.autoSync !== false));
}
