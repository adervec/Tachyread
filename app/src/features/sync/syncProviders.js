// Cloud-sync provider infrastructure. A provider is a tiny async interface the sync manager drives:
//   supported()            -> can this browser use it at all?
//   available(cfg)         -> true | { ok:false, reason } (config gate, e.g. a missing client ID)
//   connect(cfg)           -> an opaque connection (dir handle, access token, …) or throws
//   isConnected()          -> remembered connection still usable?
//   disconnect()
//   upload(conn,name,blob) / download(conn,name) -> Blob | null
//
// Two ship today:
//   • LOCAL FOLDER — File System Access directory handle. Point it at your Google Drive / Dropbox /
//     OneDrive *desktop sync folder* and you get cloud sync for free, with no accounts or API keys.
//   • GOOGLE DRIVE — direct upload into a private app-data folder via Google Identity Services + the
//     Drive REST API. Needs your own OAuth client ID (see the setup note in the dialog). The Drive
//     bytes still never touch any server of ours; it's your browser talking to your Drive.

import { getFsHandle, setFsHandle } from '../../state/storage.js';

export const BACKUP_FILE_NAME = 'tachyread-backup.json';

async function ensureDirPermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export const localFolderProvider = {
  id: 'localFolder',
  label: 'Local folder (or a Drive / Dropbox sync folder)',
  supported: () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  available: () => true,
  async connect() {
    let handle = await getFsHandle('syncDir');
    if (handle && (await ensureDirPermission(handle))) return handle;
    handle = await window.showDirectoryPicker({ id: 'tachyread-sync', mode: 'readwrite' });
    if (!(await ensureDirPermission(handle))) throw new Error('Folder permission was denied.');
    await setFsHandle('syncDir', handle);
    return handle;
  },
  async isConnected() {
    const h = await getFsHandle('syncDir');
    return !!h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
  },
  async folderName() {
    const h = await getFsHandle('syncDir');
    return h?.name || null;
  },
  async disconnect() { await setFsHandle('syncDir', null); },
  async upload(dir, name, blob) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  },
  async download(dir, name) {
    try {
      const fh = await dir.getFileHandle(name);
      return await fh.getFile();
    } catch {
      return null;
    }
  },
};

// ---- Google Drive (private appDataFolder) -------------------------------------------------------
let gisLoaded = null;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}
function requestToken(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: (resp) => (resp && resp.access_token ? resolve(resp.access_token) : reject(new Error(resp?.error || 'Sign-in failed.'))),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
async function driveFindId(token, name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive list failed (${r.status}).`);
  const j = await r.json();
  return j.files?.[0]?.id || null;
}

export const googleDriveProvider = {
  id: 'googleDrive',
  label: 'Google Drive (private app folder)',
  supported: () => true,
  available: (cfg) => (cfg?.driveClientId ? true : { ok: false, reason: 'Add your Google OAuth client ID below to enable Drive.' }),
  async connect(cfg) {
    if (!cfg?.driveClientId) throw new Error('Set your Google OAuth client ID first.');
    await loadGis();
    const token = await requestToken(cfg.driveClientId);
    return { token };
  },
  async isConnected() { return false; }, // tokens are per-session; reconnect (silently) each time
  async disconnect() {},
  async upload(conn, name, blob) {
    const existing = await driveFindId(conn.token, name);
    const meta = existing ? {} : { name, parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', blob);
    const url = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const r = await fetch(url, { method: existing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${conn.token}` }, body: form });
    if (!r.ok) throw new Error(`Drive upload failed (${r.status}).`);
  },
  async download(conn, name) {
    const id = await driveFindId(conn.token, name);
    if (!id) return null;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${conn.token}` } });
    return r.ok ? await r.blob() : null;
  },
};

export const SYNC_PROVIDERS = [localFolderProvider, googleDriveProvider];
export function getSyncProvider(id) {
  return SYNC_PROVIDERS.find((p) => p.id === id) || null;
}
