import { useMemo, useState, useEffect, useRef } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { planBulkAdd, extCounts, selectableRows, SUPPORTED_EXTS } from '../features/bulkAdd.js';
import { allFiles, getBinding } from '../state/storage.js';
import { trackFiles } from '../features/bulkTrack.js';

const MAX_ROWS = 400; // ponytail: cap the rendered checklist; the FULL selection is still added

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// Bulk-add: pick a folder (subfolders included), filter to a format, and either OPEN every new file
// as a tab or TRACK them — add each to Trackyread without opening it, so a whole shelf goes in
// without the memory of hundreds of tabs. "New" = a filename the app hasn't opened before
// (recentFiles), isn't open now, and isn't bound to a Trackyread book. The user can flip either
// filter and hand-pick. `track` (File → Add Untracked Files…) only makes Track the default button.
export default function BulkAddWizard({ onClose, track = false }) {
  const { state, openFiles, setStatus } = useApp();
  const [files, setFiles] = useState([]);       // File[] from the folder pick
  const [folderName, setFolderName] = useState('');
  const [formats, setFormats] = useState(null); // Set of chosen extensions, or null = all supported
  const [onlyNew, setOnlyNew] = useState(true);
  const [checked, setChecked] = useState(() => new Set()); // paths the user has ticked

  // Names the app already knows: previously opened (recentFiles) + currently open tabs, snapshot at
  // dialog open — state.tabs changes identity on every background progress flush (e.g. a tab still
  // auto-playing), and a live dependency would cascade into `selectable` and wipe hand-picked ticks.
  // Files bound to a Trackyread book join once their records load (one IDB read).
  const [knownNames, setKnownNames] = useState(() => {
    const s = new Set();
    for (const r of state.global.recentFiles || []) if (r?.name) s.add(String(r.name).toLowerCase());
    for (const t of state.tabs || []) { const n = t?.lazy ? t.fileName : t?.doc?.fileName; if (n) s.add(String(n).toLowerCase()); }
    return s;
  });
  const [trackedNames, setTrackedNames] = useState(() => new Set());
  useEffect(() => {
    Promise.all([getBinding(), allFiles()]).then(([map, recs]) => {
      const t = new Set(recs.filter((r) => map[r.checksum] && r.fileName).map((r) => String(r.fileName).toLowerCase()));
      setTrackedNames(t);
      setKnownNames((prev) => new Set([...prev, ...t]));
    }).catch(() => {});
  }, []);

  const descs = useMemo(() => files.map((f) => ({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size })), [files]);
  const allItems = useMemo(() => planBulkAdd(descs, { knownNames }), [descs, knownNames]); // format-agnostic (for counts)
  const counts = useMemo(() => extCounts(allItems), [allItems]);
  const items = useMemo(() => planBulkAdd(descs, { knownNames, formats: formats ? [...formats] : null }), [descs, knownNames, formats]);
  const selectable = useMemo(() => selectableRows(items, { onlyNew }), [items, onlyNew]);

  // Reset the tick set to the default selection whenever the folder or filters change.
  useEffect(() => { setChecked(new Set(selectable.map((r) => r.path))); }, [selectable]);

  const fileByPath = useMemo(() => { const m = new Map(); for (const f of files) m.set(f.webkitRelativePath || f.name, f); return m; }, [files]);

  function pickFolder() {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => {
      const list = [...(input.files || [])];
      setFiles(list);
      setFolderName(list[0]?.webkitRelativePath?.split('/')[0] || 'folder');
      setFormats(null);
      setOnlyNew(true);
      setProg(null);
    };
    input.click();
  }

  function toggleFormat(ext) {
    setFormats((prev) => {
      const base = prev ? new Set(prev) : new Set(Object.keys(counts));
      if (base.has(ext)) base.delete(ext); else base.add(ext);
      return base;
    });
  }

  function toggleRow(path) {
    setChecked((prev) => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  }

  // Supported files, in the chosen format, sorted new-first then by path — the checklist.
  const rows = useMemo(() => items
    .filter((it) => it.supported && it.inFormat)
    .sort((a, b) => (Number(b.isNew) - Number(a.isNew)) || a.path.localeCompare(b.path)), [items]);
  const unsupportedCount = items.filter((it) => !it.supported).length;
  const chosenExts = formats ? [...formats] : Object.keys(counts);
  const picked = () => [...checked].map((p) => fileByPath.get(p)).filter(Boolean);

  async function add() {
    const fs = picked();
    if (!fs.length) return;
    onClose?.();
    setStatus?.(`Adding ${fs.length} file${fs.length === 1 ? '' : 's'} from ${folderName}…`);
    await openFiles(fs);
  }

  // Tracking progress: { i, total, name } while it runs, a summary string when done, null otherwise.
  const [prog, setProg] = useState(null);
  const busy = !!prog && typeof prog !== 'string';
  const stopRef = useRef(false);
  useEffect(() => () => { stopRef.current = true; }, []); // closing the dialog stops the run
  async function trackAll() {
    const fs = picked();
    if (!fs.length) return;
    stopRef.current = false;
    setProg({ i: 0, total: fs.length, name: fs[0].name });
    const r = await trackFiles(fs, { onProgress: setProg, shouldStop: () => stopRef.current });
    const parts = [`${r.tracked} added to Trackyread`];
    if (r.linked) parts.push(`${r.linked} linked to books already there`);
    if (r.skipped) parts.push(`${r.skipped} already tracked`);
    if (r.failed) parts.push(`${r.failed} couldn’t be read`);
    setProg(`${r.stopped ? 'Stopped — ' : ''}${parts.join(', ')}. Nothing was left open.`);
    const names = r.bound.map((n) => n.toLowerCase());
    setTrackedNames((prev) => new Set([...prev, ...names]));
    setKnownNames((prev) => new Set([...prev, ...names])); // the list re-ticks to what is still new
  }

  return (
    <Dialog
      title="Bulk add from folder"
      onClose={onClose}
      width={640}
      buttons={<>
        {busy ? <button onClick={() => { stopRef.current = true; }}>■ Stop</button> : <button onClick={onClose}>{typeof prog === 'string' ? 'Close' : 'Cancel'}</button>}
        <button className={track ? '' : 'primary'} disabled={!checked.size || busy} onClick={add} title="Open every ticked file as a tab">Open {checked.size || ''} file{checked.size === 1 ? '' : 's'}</button>
        <button className={track ? 'primary' : ''} disabled={!checked.size || busy} onClick={trackAll}
          title="Add every ticked file to Trackyread (status: to read) without opening it — each is parsed for its length and fingerprint, then dropped, so hundreds at once are fine">＋ Track {checked.size || ''} in Trackyread</button>
      </>}
    >
      {!files.length ? (
        <>
          <p>Pick a folder (subfolders included) and Tachyread lists every readable file in it, preselecting the ones you haven’t added yet. <b>Open</b> them as tabs, or <b>Track</b> them — into Trackyread without opening anything, safe for a whole shelf of books.</p>
          <p className="settings-note">Readable formats: {SUPPORTED_EXTS.filter((e) => e !== 'text' && e !== 'markdown').join(', ')}. Everything in the folder is scanned locally — nothing is uploaded.</p>
          <button className="primary" onClick={pickFolder}>📂 Choose folder…</button>
        </>
      ) : (
        <>
          <div className="ba-head">
            <span><b>{folderName}</b> — {files.length} file{files.length === 1 ? '' : 's'} scanned, {Object.values(counts).reduce((a, b) => a + b, 0)} readable</span>
            <button onClick={pickFolder} disabled={busy}>Change folder…</button>
          </div>

          <div className="rh-section-h">Formats</div>
          <div className="ba-formats">
            {Object.keys(counts).length === 0 && <span className="settings-note">No readable files in this folder.</span>}
            {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([ext, n]) => (
              <button key={ext} className={`ba-fmt${chosenExts.includes(ext) ? ' on' : ''}`} onClick={() => toggleFormat(ext)}>.{ext} ({n})</button>
            ))}
          </div>

          <label className="ba-onlynew">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            Only files not already opened or tracked{onlyNew ? '' : ' (showing those too)'}
          </label>

          {prog && <p className="settings-note" aria-live="polite">{typeof prog === 'string' ? prog : `Tracking ${prog.i + 1} of ${prog.total} — ${prog.name}`}</p>}

          <div className="rh-section-h ba-listh">
            <span>Files to add</span>
            <span className="ba-count">{checked.size} selected · {rows.filter((r) => r.isNew).length} new{unsupportedCount ? ` · ${unsupportedCount} skipped (unsupported)` : ''}</span>
          </div>
          <div className="ba-list">
            {rows.length === 0 && <p className="settings-note">Nothing matches the current filters.</p>}
            {rows.slice(0, MAX_ROWS).map((r) => (
              <label key={r.path} className={`ba-row${r.isNew ? '' : ' seen'}`}>
                <input type="checkbox" checked={checked.has(r.path)} onChange={() => toggleRow(r.path)} disabled={busy} />
                <span className="ba-name" title={r.path}>{r.name}</span>
                <span className="ba-badge">{r.isNew ? <em className="ba-new">new</em> : <em className="ba-old">{trackedNames.has(String(r.name).toLowerCase()) ? 'tracked' : 'added'}</em>}</span>
                <span className="ba-meta">.{r.ext}{r.size ? ` · ${fmtSize(r.size)}` : ''}</span>
              </label>
            ))}
            {rows.length > MAX_ROWS && <p className="settings-note">…and {rows.length - MAX_ROWS} more (checked ones still get added).</p>}
          </div>
        </>
      )}
    </Dialog>
  );
}
