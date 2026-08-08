// "Show File Location" — open the folder that holds the document you're reading.
//
// No browser can launch Explorer/Finder. The closest the web allows is
// showOpenFilePicker({ startIn: handle }), which opens the OS file dialog already sitting in the
// folder containing that file — same shell UI, right place, and picking a file there just opens it.
// So we stash the FileSystemFileHandle whenever a document is opened from disk, and re-open the
// picker at it later. Chromium only; everywhere else the menu item explains why.
import { getFsHandle, setFsHandle } from '../state/storage.js';

// ponytail: handles are keyed by file name, which every open path (picker, drag-drop) has without
// threading the parsed document back. Two same-named files in different folders means the most
// recently opened one wins — switch to the content checksum if that ever actually bites.
export const handleKey = (name) => `docFile:${name}`;

export const revealSupported = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

// Called from every open path. A missing or unstorable handle is fine — the feature just stays
// unavailable for that document; it must never fail the open itself.
export async function rememberFile(handle) {
  if (!handle?.name) return;
  try { await setFsHandle(handleKey(handle.name), handle); } catch { /* private mode / quota */ }
}

// Returns { text } for the status bar, plus { files } when the user picked something in the dialog
// (an open folder view you can't open from would be a dead end).
export async function revealFile(fileName) {
  if (!fileName) return { text: 'No document open.' };
  if (!revealSupported()) return { text: 'Opening a file’s folder needs a Chromium browser (Chrome, Edge, Brave).' };

  const handle = await getFsHandle(handleKey(fileName));
  if (!handle) return { text: `${fileName} wasn’t opened from a folder on this device — reopen it with File → Open to enable this.` };

  try {
    const picked = await window.showOpenFilePicker({ startIn: handle, id: 'tachyread-reveal', multiple: true });
    const files = await Promise.all(picked.map((h) => h.getFile()));
    for (const h of picked) await rememberFile(h);
    return { text: `Opening ${files.length} file(s) from ${fileName}’s folder…`, files };
  } catch (e) {
    if (e?.name === 'AbortError') return { text: `Closed the folder holding ${fileName}.` };
    return { text: `Couldn’t open that folder: ${e.message}` };
  }
}
