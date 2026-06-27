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
// Cloud sync carries reading PROGRESS only (see storage.exportProgressData) — a separate, smaller
// file from the full local backup, so a Drive/Dropbox sync folder never holds your file bodies.
export const PROGRESS_FILE_NAME = 'tachyread-progress.json';

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
// Public OAuth client id (shared with the GymTracker app — an identifier, not a secret). It only
// works from the JavaScript origins registered with Google; the origin gate below ALSO refuses it
// app-side on any other origin (e.g. a fork deployed elsewhere) so a different deployment must
// supply its own client id. With this, Drive sync needs zero per-user setup on the authorized site.
export const BUILTIN_DRIVE_CLIENT_ID = '547617739897-br6dj2facmsc34qnkjb5u4dbfhju39pu.apps.googleusercontent.com';
const OAUTH_ORIGINS = ['https://adervec.github.io'];
export function driveOriginAllowed() {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true; // local dev, any port
    return OAUTH_ORIGINS.indexOf(location.origin) !== -1;
  } catch { return false; }
}
// Effective client id: a user-supplied one (fork / self-host) wins; otherwise the built-in id on the
// authorized origin. Empty → Drive isn't available here (a fork without its own id).
export function driveClientId(cfg) {
  return (cfg?.driveClientId || '').trim() || (driveOriginAllowed() ? BUILTIN_DRIVE_CLIENT_ID : '');
}

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
// Scopes: the private app-data folder for sync, plus the standard identity scopes so we can show
// which Google account is signed in (name + photo). `drive.appdata` only sees this app's own folder.
const DRIVE_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';

// Access token cached in memory only (never persisted). Lets isConnected() report a live session so
// the auto-sync timer can fire for Drive, and lets a silent (prompt:'') refresh reconnect on boot.
let _driveToken = null; // { value, exp }
let _driveProfile = null; // { name, picture, email } — the signed-in Google account (cosmetic)
function driveTokenValid() { return !!_driveToken && _driveToken.exp > Date.now() + 60000; }
export function getDriveProfile() { return _driveProfile; }

// Best-effort: fetch the signed-in account's name/photo for display. Never blocks or fails sync.
async function fetchDriveProfile(token) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const j = await r.json();
      _driveProfile = { name: j.name || j.email || 'Google account', picture: j.picture || '', email: j.email || '' };
    }
  } catch { /* cosmetic only */ }
  return _driveProfile;
}

function requestToken(clientId, prompt = '') {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) {
          _driveToken = { value: resp.access_token, exp: Date.now() + ((resp.expires_in || 3600) * 1000) };
          resolve(resp.access_token);
        } else reject(new Error(resp?.error || 'Sign-in failed.'));
      },
      // Fires when the flow can't even produce a response (popup closed/blocked, network) — without
      // this the promise would hang on a dismissed popup.
      error_callback: (err) => reject(new Error(err?.message || err?.type || 'Sign-in was dismissed.')),
    });
    // prompt:'' → silent when a prior grant + active Google session exist (boot/auto); a consent
    // popup only when needed (call from a click). prompt:'consent' forces the chooser.
    client.requestAccessToken({ prompt });
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
  available: (cfg) => (driveClientId(cfg) ? true : { ok: false, reason: 'Google Drive sync isn’t enabled on this deployment — add your own OAuth client ID below.' }),
  // `silent` (used by auto-sync / boot) only reuses an existing grant — it never opens a popup.
  async connect(cfg, { silent = false } = {}) {
    const clientId = driveClientId(cfg);
    if (!clientId) throw new Error('Google Drive sync isn’t available here.');
    if (driveTokenValid()) {
      if (!_driveProfile) await fetchDriveProfile(_driveToken.value);
      return { token: _driveToken.value };
    }
    await loadGis();
    let token;
    try {
      token = await requestToken(clientId, '');            // try silent (existing grant) first
    } catch (e) {
      if (silent) throw e;                                 // auto/boot: never pop a sign-in
      token = await requestToken(clientId, 'consent');     // user-initiated: ask once
    }
    await fetchDriveProfile(token);                        // load name/photo (best-effort)
    return { token };
  },
  async isConnected() { return driveTokenValid(); }, // a live in-session token → auto-sync may fire
  async disconnect() { _driveToken = null; _driveProfile = null; },
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
