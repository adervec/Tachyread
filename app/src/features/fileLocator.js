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
// exact name beats a re-format found at the same depth. Returns { handle, dir, score, scanned }.
export async function findFileIn(dir, fileName, { maxDepth = 4, budget = 4000 } = {}) {
  let queue = [{ dir, depth: 0 }];
  let scanned = 0;
  let best = null;
  while (queue.length && scanned < budget) {
    const next = [];
    for (const { dir: d, depth } of queue) {
      let entries;
      try { entries = d.entries(); } catch { continue; }
      try {
        for await (const [name, handle] of entries) {
          if (++scanned > budget) break;
          if (handle.kind === 'directory') {
            if (depth + 1 <= maxDepth && !name.startsWith('.')) next.push({ dir: handle, depth: depth + 1 });
            continue;
          }
          const score = nameScore(fileName, name);
          if (score > (best?.score || 0)) best = { handle, dir: d, score, scanned };
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
    if (hit && hit.score > (best?.score || 0)) best = { ...hit, root: d };
    if (best?.score === 2) break;
  }
  return best;
}
