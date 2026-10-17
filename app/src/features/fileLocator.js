// Finding a document that isn't saved on THIS device.
//
// A book read on the desktop is known everywhere — the tracker link, the reading history and the
// queue all sync — but the text itself does not: it is far too big to push around, so each device
// only holds copies of what it opened itself. Open such a book on the laptop and there is nothing
// to show. The fix is to let you name the folders your documents actually live in (Dropbox, a NAS
// share, ~/Books) and search them for the file when the local copy is missing, moved or renamed.
//
// The walk is breadth-first and budgeted so a folder picked by mistake — a whole home directory —
// cannot hang the app. Pure apart from the handle store; see fileLocator.test.mjs.
import { getFsHandle, setFsHandle } from '../state/storage.js';

const KEY = 'libraryDirs';
export const pickerSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export async function getSearchDirs() {
  const list = await getFsHandle(KEY);
  return Array.isArray(list) ? list : [];
}
export async function addSearchDir(handle) {
  if (!handle?.name) return getSearchDirs();
  const list = await getSearchDirs();
  for (const d of list) {
    if (typeof d.isSameEntry === 'function' && await d.isSameEntry(handle).catch(() => false)) return list;
  }
  const next = [...list, handle];
  await setFsHandle(KEY, next);
  return next;
}
export async function removeSearchDir(handle) {
  const list = await getSearchDirs();
  const next = [];
  for (const d of list) {
    const same = d === handle || (typeof d.isSameEntry === 'function' && await d.isSameEntry(handle).catch(() => false));
    if (!same) next.push(d);
  }
  await setFsHandle(KEY, next);
  return next;
}

// A stored handle loses its permission between sessions; re-asking needs a user gesture, which is
// why this is only ever called straight off a click. Handles without the permission API (OPFS) pass.
export async function ensureRead(dir) {
  if (typeof dir?.queryPermission !== 'function') return true;
  if (await dir.queryPermission({ mode: 'read' }) === 'granted') return true;
  if (typeof dir.requestPermission !== 'function') return false;
  return await dir.requestPermission({ mode: 'read' }) === 'granted';
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
export const stem = (name) => norm(name).replace(/\.[a-z0-9]{1,5}$/, '');

// How well a file on disk answers to the name we recorded. 2 = the same name, 1 = the same name in
// another format (the epub you re-downloaded as a txt). 0 = not it — a partial word overlap is NOT
// a match here: opening the wrong book silently is worse than saying it could not be found.
export function nameScore(want, got) {
  if (!want || !got) return 0;
  if (norm(want) === norm(got)) return 2;
  const a = stem(want);
  return a && a === stem(got) ? 1 : 0;
}

// Breadth-first so a copy sitting at the top of the folder beats one buried in an archive, and an
// exact name beats a re-format found at the same depth. Returns { handle, dir, score, scanned, path }
// (path relative to `dir`, e.g. 'SF/dune.epub').
export async function findFileIn(dir, fileName, { maxDepth = 4, budget = 4000 } = {}) {
  let queue = [{ dir, depth: 0, path: '' }];
  let scanned = 0;
  let best = null;
  while (queue.length && scanned < budget) {
    const next = [];
    for (const { dir: d, depth, path } of queue) {
      let entries;
      try { entries = d.entries(); } catch { continue; }
      try {
        for await (const [name, handle] of entries) {
          if (++scanned > budget) break;
          if (handle.kind === 'directory') {
            if (depth + 1 <= maxDepth && !name.startsWith('.')) next.push({ dir: handle, depth: depth + 1, path: `${path}${name}/` });
            continue;
          }
          const score = nameScore(fileName, name);
          if (score > (best?.score || 0)) best = { handle, dir: d, score, scanned, path: path + name };
        }
      } catch { /* a folder we can't read — skip it, keep searching the rest */ }
      if (best?.score === 2) return { ...best, scanned };
    }
    queue = next;
  }
  return best ? { ...best, scanned } : null;
}

// Search every designated folder, nearest match wins. Skips folders whose permission was refused.
export async function findFile(dirs, fileName, opts) {
  let best = null;
  for (const d of dirs || []) {
    if (!await ensureRead(d)) continue;
    const hit = await findFileIn(d, fileName, opts);
    if (hit && hit.score > (best?.score || 0)) best = { ...hit, root: d, path: `${d.name}/${hit.path}` };
    if (best?.score === 2) break;
  }
  return best;
}

// One walk over every search folder that records where each wanted file lives — the browser never
// says which folder a file was opened from, so this is how the queue's Folder column gets filled.
// wanted: [{ cs, name }]. Exact names win over another format of the same book; first found (by
// folder order, then depth) wins among equals. Returns { [cs]: 'Root/sub/file.epub' } plus counts.
// ponytail: budgeted, not a full crawl — raise `budget` if huge libraries come up short.
export async function indexFolders(dirs, wanted, { maxDepth = 8, budget = 60000, ask = false } = {}) {
  const byName = new Map(), byStem = new Map();
  for (const w of wanted || []) {
    if (!w?.cs || !w.name) continue;
    const n = norm(w.name), st = stem(w.name);
    if (!byName.has(n)) byName.set(n, []); byName.get(n).push(w.cs);
    if (!byStem.has(st)) byStem.set(st, []); byStem.get(st).push(w.cs);
  }
  const paths = {}, score = {};
  let scanned = 0, skipped = 0;
  for (const root of dirs || []) {
    if (ask ? !await ensureRead(root) : (typeof root.queryPermission === 'function' && await root.queryPermission({ mode: 'read' }) !== 'granted')) { skipped++; continue; }
    let queue = [{ dir: root, depth: 0, path: '' }];
    while (queue.length && scanned < budget) {
      const next = [];
      for (const { dir, depth, path } of queue) {
        try {
          for await (const [name, h] of dir.entries()) {
            if (++scanned > budget) break;
            if (h.kind === 'directory') { if (depth + 1 <= maxDepth && !name.startsWith('.')) next.push({ dir: h, depth: depth + 1, path: `${path}${name}/` }); continue; }
            const exact = byName.get(norm(name)) || [], alt = byStem.get(stem(name)) || [];
            for (const [list, sc] of [[exact, 2], [alt, 1]]) {
              for (const cs of list) if ((score[cs] || 0) < sc) { score[cs] = sc; paths[cs] = `${root.name}/${path}${name}`; }
            }
          }
        } catch { /* unreadable folder — skip it */ }
      }
      queue = next;
    }
  }
  return { paths, found: Object.keys(paths).length, scanned, skipped };
}
export function rememberPaths(map) {
  try { localStorage.setItem(PATHS_KEY, JSON.stringify({ ...foundPaths(), ...map })); } catch { /* private mode */ }
}

// Where each linked file was last found (checksum → 'Folder/sub/file.epub'), so the queue's file
// column and path filter can show real locations. Device-local (paths differ per device).
const PATHS_KEY = 'tachyread-found-paths';
export function foundPaths() {
  try { return JSON.parse(localStorage.getItem(PATHS_KEY) || '{}') || {}; } catch { return {}; }
}
export function rememberPath(cs, path) {
  if (!cs || !path) return;
  try { localStorage.setItem(PATHS_KEY, JSON.stringify({ ...foundPaths(), [cs]: path })); } catch { /* private mode */ }
}
