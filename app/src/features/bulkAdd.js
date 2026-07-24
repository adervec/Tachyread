// Bulk-add-from-folder planning. Given a folder's files (from a webkitdirectory pick) plus the set of
// names already known to the app (recently-opened + currently-open), classify each file: its format,
// whether the app can read it, and whether it's NEW (never added). The dialog uses this to preselect
// "new files of the chosen format" while letting the user override. Pure; see bulkAdd.test.mjs.

// Formats the reader can open (matches the "Open Document" accept list).
export const SUPPORTED_EXTS = ['txt', 'text', 'md', 'markdown', 'html', 'htm', 'pdf', 'epub', 'docx'];

export function fileExt(name) {
  const m = /\.([^.]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

const norm = (s) => String(s || '').trim().toLowerCase();

// descs: [{ name, path?, size? }]. knownNames: Set|array of already-added file names (case-insensitive).
// formats: array of extensions to include, or null = every supported format.
// Returns one row per file: { name, path, size, ext, supported, isNew, inFormat }.
export function planBulkAdd(descs, { knownNames = new Set(), formats = null } = {}) {
  const known = knownNames instanceof Set ? new Set([...knownNames].map(norm)) : new Set((knownNames || []).map(norm));
  const allow = formats ? new Set(formats.map((e) => e.toLowerCase())) : null;
  return (descs || []).map((d) => {
    const ext = fileExt(d.name);
    const supported = SUPPORTED_EXTS.includes(ext);
    return {
      name: d.name,
      path: d.path || d.name,
      size: Number(d.size) || 0,
      ext,
      supported,
      isNew: !known.has(norm(d.name)),
      inFormat: allow ? allow.has(ext) : supported,
    };
  });
}

// Count of supported files per extension (for the format filter chips).
export function extCounts(items) {
  const c = {};
  for (const it of items || []) if (it.supported) c[it.ext] = (c[it.ext] || 0) + 1;
  return c;
}

// The rows that would be added under the current filters: supported, in the chosen format, and (when
// onlyNew) not already added.
export function selectableRows(items, { onlyNew = true } = {}) {
  return (items || []).filter((it) => it.supported && it.inFormat && (!onlyNew || it.isNew));
}
