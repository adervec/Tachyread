// Cloud sync goes through the shared door, font.js's appFont.cloud (house standards 1 and 30): the
// reader's private app folder in the cloud they chose once for every app (Google Drive today). No
// Google code of Tachyread's own, and no "sync folder on this computer" any more: a folder cannot
// read the cloud before writing and never reaches the phone. The sync manager drives this interface:
//   supported() / available(cfg) / connect(cfg, { silent }) / isConnected() / disconnect()
//   upload(conn, name, blob) / download(conn, name) -> Blob | null / stat(conn, name)
//   putFile / getFile / removeFile: the pocket-listening clips
// It keeps the id 'googleDrive' so a saved sync setting (and the menu bar's ☁) carries on.
import { t } from '../../i18n.js';

export const BACKUP_FILE_NAME = 'tachyread-backup.json';
// Cloud sync carries reading PROGRESS only (see storage.exportProgressData), never file bodies.
export const PROGRESS_FILE_NAME = 'tachyread-progress.json';
// The Literary Journey tracker rides its own file: large and mostly static, synced less often.
export const LIBRARY_FILE_NAME = 'tachyread-library.json';

const door = () => (typeof window !== 'undefined' ? window.appFont?.cloud || null : null);

export const cloudProvider = {
  id: 'googleDrive',
  get label() { return door()?.label?.() || t('Google Drive (private app folder)'); },
  supported: () => !!door(),
  available: () => (door() ? true : { ok: false, reason: t('Cloud sync isn’t available here.') }),
  // `silent` (auto-sync, boot) never shows the sign-in window; it fails instead
  async connect(cfg, { silent = false } = {}) {
    const c = door();
    if (!c) throw new Error(t('Cloud sync isn’t available here.'));
    await c.signIn({ silent });
    return c;
  },
  async isConnected() { return !!door()?.signedIn(); },
  async disconnect() { door()?.signOut(); },
  async upload(c, name, blob) { await c.write(name, blob, blob.type || 'application/json'); return name; },
  async download(c, name) { const b = await c.readBytes(name); return b ? new Blob([b]) : null; },
  async stat(c, name) { return (await c.stat(name))?.version ?? null; },
  // Pocket-listening clips: one file per chunk, addressed by name (older clips by their Drive id)
  putFile(c, name, blob) { return cloudProvider.upload(c, name, blob); },
  async getFile(c, id) {
    const b = await c.readBytes(String(id).includes('.') ? id : { id }).catch(() => null);
    return b ? new Blob([b]) : null;
  },
  async removeFile(c, id) {
    let name = id;
    if (!String(id).includes('.')) name = (await c.list('').catch(() => [])).find((f) => f.id === id)?.name; // an older clip, saved by id
    if (name) await c.remove(name).catch(() => {});
  },
};

export const SYNC_PROVIDERS = [cloudProvider];
// Every saved setting (an old 'localFolder' one included) now means the shared cloud.
export function getSyncProvider() { return door() ? cloudProvider : null; }
// The signed-in account, as font.js knows it (shown in the top bar by <app-account>).
export function getDriveProfile() { return (typeof window !== 'undefined' && window.appFont?.getAccount?.()) || null; }
export function driveOriginAllowed() { return !!door(); }
export function driveClientId() { return door() ? 'shared' : ''; }
