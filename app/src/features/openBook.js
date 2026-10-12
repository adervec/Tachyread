// Open a Trackyread book's document from wherever it is: an already-open tab, this device's saved
// copy, or the designated search folders (the text never syncs between devices). Shared by the
// queue's ▶ and the book-finished popup's "open next".
import { loadDocPayload } from '../state/storage.js';
import { findFile } from './fileLocator.js';

// Where a linked file can be opened from: 'open' | 'local' | 'folder' | 'missing' | 'unlinked'.
// The folder search is the only slow step, so it runs only when `search` is true.
export async function fileWhere(cs, name, { openChecksums = [], dirs = [], search = false } = {}) {
  if (!cs) return { where: 'unlinked' };
  if (openChecksums.includes(cs)) return { where: 'open' };
  if ((await loadDocPayload(cs).catch(() => null))?.fullText) return { where: 'local' };
  if (!search || !dirs.length) return { where: dirs.length ? 'unsearched' : 'missing' };
  const hit = await findFile(dirs, name).catch(() => null);
  return hit ? { where: 'folder', hit } : { where: 'missing' };
}

// Opens it. Returns { ok, msg } — msg explains a failure in plain words.
export async function openBookFile({ cs, name, openChecksums = [], dirs = [], openRecent, openFiles }) {
  if (!cs) return { ok: false, msg: `“${name}” isn’t linked to a document yet.` };
  const at = await fileWhere(cs, name, { openChecksums, dirs, search: true });
  if ((at.where === 'open' || at.where === 'local') && await openRecent(cs)) return { ok: true };
  if (at.where === 'folder') { openFiles([await at.hit.handle.getFile()]); return { ok: true }; }
  if (!dirs.length) return { ok: false, msg: `“${name}” isn’t saved on this device. Add the folder your documents live in and it can be opened from there.` };
  return { ok: false, msg: `“${name}” isn’t on this device and isn’t in ${dirs.map((d) => d.name).join(', ')}. Add another folder, or open it once with File → Open.` };
}
