// File System Access helpers with graceful fallback.
//
// Where the browser supports it (Chrome/Edge, secure context), saving opens a native dialog so the
// user picks the exact location AND filename (true "save as / rename to an external location"). Where
// it doesn't, we fall back to a normal download. Reading back uses a file picker. No data leaves the
// device — these are local file operations only.

export function fsSaveSupported() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

// Save a Blob to an external location. `types` is the File System Access `types` array, e.g.
// [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }]. Returns { name, method } or
// { canceled: true } if the user dismissed the native dialog.
export async function saveBlobToFile(blob, suggestedName, types) {
  if (fsSaveSupported()) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { name: handle.name, method: 'fs', handle };
    } catch (e) {
      if (e && e.name === 'AbortError') return { canceled: true };
      // any other failure → fall through to a plain download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { name: suggestedName, method: 'download' };
}

export function extOf(name, fallback = 'txt') {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : fallback;
}

export async function saveTextToFile(text, suggestedName, mime = 'text/plain') {
  const ext = extOf(suggestedName);
  return saveBlobToFile(new Blob([text], { type: mime }), suggestedName, [
    { description: 'File', accept: { [mime]: [`.${ext}`] } },
  ]);
}

// Open a file picker and resolve the chosen File (or null if dismissed).
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function readFileText(file) {
  return file ? await file.text() : '';
}
