// Sync manager — pushes/pulls the same JSON backup bundle that Backup & Data uses, through any
// provider. Provider-agnostic: it only knows export → upload and download → import.

import { exportAllData, importAllData } from '../../state/storage.js';
import { getSyncProvider, BACKUP_FILE_NAME } from './syncProviders.js';

export async function backupToProvider(providerId, cfg) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg);
  const bundle = await exportAllData();
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  await p.upload(conn, BACKUP_FILE_NAME, blob);
  return { at: Date.now(), bytes: blob.size };
}

export async function restoreFromProvider(providerId, cfg) {
  const p = getSyncProvider(providerId);
  if (!p) throw new Error('Unknown sync target.');
  if (!p.supported()) throw new Error('This browser can’t use that sync target.');
  const conn = await p.connect(cfg);
  const blob = await p.download(conn, BACKUP_FILE_NAME);
  if (!blob) throw new Error('No Tachyread backup found in that location yet — back up first.');
  const bundle = JSON.parse(await blob.text());
  const r = await importAllData(bundle, { replace: true });
  return { at: Date.now(), written: r.written };
}
