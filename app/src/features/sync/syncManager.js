// Sync manager — pushes/pulls reading PROGRESS (not a full backup) through any provider.
// Provider-agnostic: it only knows export → upload and download → merge-import. The bytes that
// travel are progress-only (reading history keyed by file checksum + grab markers + book groups);
// file bodies and grab images never leave the device. See storage.exportProgressData.

import { exportProgressData, importProgressData, exportLibraryData, importLibraryData, getLibraryChangedAt, getLibrarySyncState, setLibrarySyncState } from '../../state/storage.js';
import { getSyncProvider, PROGRESS_FILE_NAME, LIBRARY_FILE_NAME } from './syncProviders.js';

export async function backupToProvider(providerId, cfg, opts = {}) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg, opts);
  const bundle = await exportProgressData();
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  await p.upload(conn, PROGRESS_FILE_NAME, blob);
  return { at: Date.now(), bytes: blob.size };
}

export async function restoreFromProvider(providerId, cfg, opts = {}) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg, opts);
  const blob = await p.download(conn, PROGRESS_FILE_NAME);
  if (!blob) throw new Error('No Tachyread progress sync found in that location yet — back up first.');
  const bundle = JSON.parse(await blob.text());
  const r = await importProgressData(bundle);
  return { at: Date.now(), merged: r.merged };
}

// Read-merge-write: pull remote, merge into local, then push the merged result. Used by auto-sync so
// concurrent edits on two devices converge instead of clobbering. `silent` connects without a popup.
export async function syncWithProvider(providerId, cfg, opts = {}) {
  try { await restoreFromProvider(providerId, cfg, opts); }
  catch (e) { if (!/No Tachyread progress sync/.test(e?.message || '')) throw e; } // first sync: nothing remote yet
  return backupToProvider(providerId, cfg, opts);
}

// ── Literary Journey library — its own file, same providers, but NOT on the reading-progress timer.
export async function backupLibraryToProvider(providerId, cfg, opts = {}) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg, opts);
  const bundle = await exportLibraryData();
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  await p.upload(conn, LIBRARY_FILE_NAME, blob);
  return { at: Date.now(), bytes: blob.size, books: bundle.books.length };
}

export async function restoreLibraryFromProvider(providerId, cfg, opts = {}) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg, opts);
  const blob = await p.download(conn, LIBRARY_FILE_NAME);
  if (!blob) throw new Error('No Tachyread library sync found in that location yet — back up first.');
  const bundle = JSON.parse(await blob.text());
  return importLibraryData(bundle, { mode: 'merge' });
}

// Diff-aware read-merge-write. A cheap stat (mtime / one Drive metadata query) decides whether the
// remote changed, and a local change stamp decides whether we have anything to say — steady-state
// sync compares two numbers and moves NO payload instead of shipping ~3,000 books each way.
export async function syncLibraryWithProvider(providerId, cfg, opts = {}) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg, opts);
  const [state, changedAt] = await Promise.all([getLibrarySyncState(), getLibraryChangedAt()]);
  const remoteStamp = p.stat ? await p.stat(conn, LIBRARY_FILE_NAME) : undefined; // undefined = provider can't stat
  const localDirty = changedAt > (state?.localChange || 0);
  const remoteNew = remoteStamp === undefined || (remoteStamp != null && remoteStamp !== (state?.remoteStamp || 0));

  if (!localDirty && !remoteNew && remoteStamp != null) {
    return { at: Date.now(), skipped: true, bytes: 0, books: null };
  }

  // Pull + merge only when the remote actually changed (per-book LWW; tombstones win deletes).
  let pulled = false;
  if (remoteNew && remoteStamp !== null) {
    const blob = await p.download(conn, LIBRARY_FILE_NAME);
    if (blob) { await importLibraryData(JSON.parse(await blob.text()), { mode: 'merge', fromSync: true }); pulled = true; }
  }

  // Push only when we have local changes (or the remote file doesn't exist yet).
  let bytes = 0, books = null, newStamp = remoteStamp ?? null;
  if (localDirty || remoteStamp === null) {
    const bundle = await exportLibraryData();
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    await p.upload(conn, LIBRARY_FILE_NAME, blob);
    bytes = blob.size; books = bundle.books.length;
    newStamp = p.stat ? await p.stat(conn, LIBRARY_FILE_NAME) : null;
  }
  await setLibrarySyncState({ remoteStamp: newStamp, localChange: changedAt, syncedAt: Date.now() });
  return { at: Date.now(), skipped: false, pulled, pushed: bytes > 0, bytes, books };
}
