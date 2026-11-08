// One Tachyread folder on disk, remembered once, with a subfolder per job:
//   sync/    the cloud-sync files (progress + library) — point the folder at a Drive / Dropbox /
//            OneDrive desktop sync folder and every device that can use folders shares them
//   cowork/  the AI cowork request / response / snapshot files
//   speech/  the narration quality log SpeechImprover watches
// Until the one folder is chosen, the older per-job handles (syncDir, journeyCoworkDir,
// speechTrainingDir) keep working; choosing it forgets them. Browser I/O only — nothing to unit-test.
import { getFsHandle, setFsHandle } from '../state/storage.js';

const SUB = { sync: 'sync', cowork: 'cowork', speech: 'speech' };
const LEGACY = { sync: 'syncDir', cowork: 'journeyCoworkDir', speech: 'speechTrainingDir' };

export const folderSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

// `ask` may open the permission prompt (only from a click); a silent check returns false instead.
async function granted(h, ask) {
  if (!h) return false;
  const o = { mode: 'readwrite' };
  if ((await h.queryPermission(o)) === 'granted') return true;
  return ask ? (await h.requestPermission(o)) === 'granted' : false;
}

export const getRoot = () => getFsHandle('rootDir');

export async function pickRoot() {
  const h = await window.showDirectoryPicker({ id: 'tachyread-folder', mode: 'readwrite' });
  if (!(await granted(h, true))) throw new Error('Folder permission was denied.');
  await setFsHandle('rootDir', h);
  for (const k of Object.values(LEGACY)) await setFsHandle(k, null);
  return h;
}
export const forgetRoot = () => setFsHandle('rootDir', null);

// The handle for one job: <root>/<sub> (created on demand), else that job's legacy folder.
// null when nothing is chosen or permission isn't granted (and we may not ask).
export async function subDir(kind, { ask = false } = {}) {
  const root = await getRoot();
  if (root) return (await granted(root, ask)) ? root.getDirectoryHandle(SUB[kind], { create: true }) : null;
  const h = await getFsHandle(LEGACY[kind]);
  return h && (await granted(h, ask)) ? h : null;
}

// Display name for a job's folder: "Tachyread/cowork", a legacy folder's own name, or ''.
export async function subDirLabel(kind) {
  const root = await getRoot();
  if (root) return `${root.name}/${SUB[kind]}`;
  return (await getFsHandle(LEGACY[kind]))?.name || '';
}
