import { useMemo, useState, useEffect, useRef } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { planBulkAdd, extCounts, selectableRows, SUPPORTED_EXTS } from '../features/bulkAdd.js';
import { allFiles, getBinding } from '../state/storage.js';
import { trackFiles } from '../features/bulkTrack.js';
import { t } from '../i18n.js';

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
    for (const tab of state.tabs || []) { const n = tab?.lazy ? tab.fileName : tab?.doc?.fileName; if (n) s.add(String(n).toLowerCase()); }
    return s;
  });
  const [trackedNames, setTrackedNames] = useState(() => new Set());
  useEffect(() => {
    Promise.all([getBinding(), allFiles()]).then(([map, recs]) => {
      const tracked = new Set(recs.filter((r) => map[r.checksum] && r.fileName).map((r) => String(r.fileName).toLowerCase()));
      setTrackedNames(tracked);
      setKnownNames((prev) => new Set([...prev, ...tracked]));
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
      setFolderName(list[0]?.webkitRelativePath?.split('/')[0] || t('folder'));
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
    setStatus?.(t.n('Adding {n} file from {folder}…', 'Adding {n} files from {folder}…', fs.length, { folder: folderName }));
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
    // One sentence per part (never a sentence glued from translated fragments).
    const parts = [];
    if (r.stopped) parts.push(t('Stopped.'));
    parts.push(t.n('{n} file added to Trackyread.', '{n} files added to Trackyread.', r.tracked));
    if (r.linked) parts.push(t.n('{n} linked to a book already there.', '{n} linked to books already there.', r.linked));
    if (r.skipped) parts.push(t.n('{n} already tracked.', '{n} already tracked.', r.skipped));
    if (r.failed) parts.push(t.n('{n} couldn’t be read.', '{n} couldn’t be read.', r.failed));
    parts.push(t('Nothing was left open.'));
    setProg(parts.join(' '));
    const names = r.bound.map((n) => n.toLowerCase());
    setTrackedNames((prev) => new Set([...prev, ...names]));
    setKnownNames((prev) => new Set([...prev, ...names])); // the list re-ticks to what is still new
  }

  return (
    <Dialog
      title={t('Bulk add from folder')}
      onClose={onClose}
      width={640}
      buttons={<>
        {busy ? <button onClick={() => { stopRef.current = true; }}>■ {t('Stop')}</button> : <button onClick={onClose}>{typeof prog === 'string' ? t('Close') : t('Cancel')}</button>}
        <button className={track ? '' : 'primary'} disabled={!checked.size || busy} onClick={add} title={t('Open every ticked file as a tab')}>{checked.size ? t.n('Open {n} file', 'Open {n} files', checked.size) : t('Open files')}</button>
        <button className={track ? 'primary' : ''} disabled={!checked.size || busy} onClick={trackAll}
          title={t('Add every ticked file to Trackyread (status: to read) without opening it — each is parsed for its length and fingerprint, then dropped, so hundreds at once are fine')}>＋ {checked.size ? t('Track {n} in Trackyread', { n: checked.size }) : t('Track in Trackyread')}</button>
      </>}
    >
      {!files.length ? (
        <>
          <p>{t('Pick a folder (subfolders included) and Tachyread lists every readable file in it, preselecting the ones you haven’t added yet. Open them as tabs, or Track them — into Trackyread without opening anything, safe for a whole shelf of books.')}</p>
          <p className="settings-note">{t('Readable formats: {formats}. Everything in the folder is scanned locally — nothing is uploaded.', { formats: SUPPORTED_EXTS.filter((e) => e !== 'text' && e !== 'markdown').join(', ') })}</p>
          <button className="primary" onClick={pickFolder}>📂 {t('Choose folder…')}</button>
        </>
      ) : (
        <>
          <div className="ba-head">
            <span><b>{folderName}</b> — {t.n('{n} file scanned, {readable} readable', '{n} files scanned, {readable} readable', files.length, { readable: Object.values(counts).reduce((a, b) => a + b, 0) })}</span>
            <button onClick={pickFolder} disabled={busy}>{t('Change folder…')}</button>
          </div>

          <div className="rh-section-h">{t('Formats')}</div>
          <div className="ba-formats">
            {Object.keys(counts).length === 0 && <span className="settings-note">{t('No readable files in this folder.')}</span>}
            {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([ext, n]) => (
              <button key={ext} className={`ba-fmt${chosenExts.includes(ext) ? ' on' : ''}`} onClick={() => toggleFormat(ext)}>.{ext} ({n})</button>
            ))}
          </div>

          <label className="ba-onlynew">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            {onlyNew ? t('Only files not already opened or tracked') : t('Only files not already opened or tracked (showing those too)')}
          </label>

          {prog && <p className="settings-note" aria-live="polite">{typeof prog === 'string' ? prog : t('Tracking {i} of {total} — {name}', { i: prog.i + 1, total: prog.total, name: prog.name })}</p>}

          <div className="rh-section-h ba-listh">
            <span>{t('Files to add')}</span>
            <span className="ba-count">{t('{n} selected', { n: checked.size })} · {t('{n} new', { n: rows.filter((r) => r.isNew).length })}{unsupportedCount ? <> · {t('{n} skipped (unsupported)', { n: unsupportedCount })}</> : ''}</span>
          </div>
          <div className="ba-list">
            {rows.length === 0 && <p className="settings-note">{t('Nothing matches the current filters.')}</p>}
            {rows.slice(0, MAX_ROWS).map((r) => (
              <label key={r.path} className={`ba-row${r.isNew ? '' : ' seen'}`}>
                <input type="checkbox" checked={checked.has(r.path)} onChange={() => toggleRow(r.path)} disabled={busy} />
                <span className="ba-name" title={r.path}>{r.name}</span>
                <span className="ba-badge">{r.isNew ? <em className="ba-new">{t('new')}</em> : <em className="ba-old">{trackedNames.has(String(r.name).toLowerCase()) ? t('tracked') : t('added')}</em>}</span>
                <span className="ba-meta">.{r.ext}{r.size ? ` · ${fmtSize(r.size)}` : ''}</span>
              </label>
            ))}
            {rows.length > MAX_ROWS && <p className="settings-note">{t('…and {n} more (checked ones still get added).', { n: rows.length - MAX_ROWS })}</p>}
          </div>
        </>
      )}
    </Dialog>
  );
}
