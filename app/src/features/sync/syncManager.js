// Sync manager: reading PROGRESS and the Trackyread LIBRARY, each one file in the reader's cloud,
// kept in step through font.js's appFont.cloud.syncDoc (house standard 30). syncDoc reads the cloud
// copy first whenever it changed, merges, and writes only when the result differs, checking just
// before writing that nobody wrote meanwhile. The merges are record by record (mergeDocs.js).
// This device's copy is its last merged copy joined with what it holds now, so a phone that was
// offline for a week adds its reading and never pushes an old view over the desktop's.
// File bodies and grab images never leave the device (see storage.exportProgressData).
import {
  exportProgressData, importProgressData, exportLibraryData, importLibraryData,
  getSyncCache, setSyncCache, stampSync, setLibrarySyncState, getLibraryChangedAt,
} from '../../state/storage.js';
import { getSyncProvider, PROGRESS_FILE_NAME, LIBRARY_FILE_NAME } from './syncProviders.js';
import { mergeProgressDocs, mergeLibraryDocs } from './mergeDocs.js';
import { t } from '../../i18n.js';

async function syncOne(kind, name, exportFn, importFn, merge, opts) {
  const p = getSyncProvider();
  if (!p) throw new Error(t('Cloud sync isn’t available here.'));
  const c = await p.connect(null, opts);
  let doc = null;
  const r = await c.syncDoc(name, {
    load: async () => (doc = merge(await getSyncCache(kind), await exportFn())),
    merge,
    save: async (merged) => { doc = merged; await importFn(merged); },
  });
  if (doc) await setSyncCache(kind, doc);
  const now = Date.now();
  if (r.pulled) await stampSync(kind, { pulledAt: now, pulledFrom: '', remoteAt: now });
  if (r.pushed) await stampSync(kind, { pushedAt: now });
  return { at: now, pulled: r.pulled, pushed: r.pushed, doc };
}

const size = (doc) => (doc ? JSON.stringify(doc).length : 0);
const progress = (opts) => syncOne('progress', PROGRESS_FILE_NAME, exportProgressData, importProgressData, mergeProgressDocs, opts);

// Every way in is the same safe two-way sync now: "back up" and "restore" never overwrite blindly.
export async function syncWithProvider(providerId, cfg, opts = {}) {
  const r = await progress(opts);
  return { ...r, bytes: size(r.doc), merged: r.pulled ? 1 : 0 };
}
export const backupToProvider = syncWithProvider;
export const restoreFromProvider = syncWithProvider;

export async function syncLibraryWithProvider(providerId, cfg, opts = {}) {
  const changedAt = await getLibraryChangedAt();
  const r = await syncOne('library', LIBRARY_FILE_NAME, exportLibraryData,
    (doc) => importLibraryData(doc, { mode: 'merge', fromSync: true }), mergeLibraryDocs, opts);
  await setLibrarySyncState({ localChange: changedAt, syncedAt: r.at });
  return { at: r.at, skipped: !r.pulled && !r.pushed, pulled: r.pulled, pushed: r.pushed, bytes: r.pushed ? size(r.doc) : 0, books: r.doc?.books?.length ?? null };
}
export const backupLibraryToProvider = syncLibraryWithProvider;
export const restoreLibraryFromProvider = syncLibraryWithProvider;
