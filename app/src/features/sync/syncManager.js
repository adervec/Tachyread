// Sync manager — pushes/pulls reading PROGRESS (not a full backup) through any provider.
// Provider-agnostic: it only knows export → upload and download → merge-import. The bytes that
// travel are progress-only (reading history keyed by file checksum + grab markers + book groups);
// file bodies and grab images never leave the device. See storage.exportProgressData.

import { exportProgressData, importProgressData } from '../../state/storage.js';
import { getSyncProvider, PROGRESS_FILE_NAME } from './syncProviders.js';

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
