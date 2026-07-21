import { useEffect, useRef, useState } from 'react';

const UNDO_MS = 120000; // an "Update" can be undone for two minutes

// Named settings profiles for a settings dialog: save the current values under a name, load /
// overwrite / rename / delete. `profiles` is the full global.settingsProfiles object; `kind` picks
// the 'tab' or 'app' list; `capture()` returns the data to save; `apply(data)` loads one.
export default function ProfilesBar({ kind, profiles, onChange, capture, apply }) {
  const all = profiles && typeof profiles === 'object' ? profiles : { tab: [], app: [] };
  const list = all[kind] || [];
  const [sel, setSel] = useState('');
  const selProfile = list.find((p) => p.name === sel) || null;

  // An "Update" overwrites a profile in place — easy to do by accident, and there's no other copy.
  // Keep the pre-update data around for UNDO_MS so a mis-click is recoverable. `left` ticks the
  // visible countdown down each second.
  const [undo, setUndo] = useState(null); // { name, prevData } | null
  const [left, setLeft] = useState(0);
  const undoTimer = useRef(0);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  useEffect(() => {
    if (!undo) return undefined;
    const iv = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [undo]);

  const write = (nextList) => onChange({ ...all, [kind]: nextList });
  function saveAs() {
    const name = (window.prompt('Save these settings as a profile named:', sel || '') || '').trim();
    if (!name) return;
    write([...list.filter((p) => p.name !== name), { name, data: capture(), savedAt: Date.now() }]);
    setSel(name);
  }
  function update() {
    if (!selProfile) return;
    const prevData = selProfile.data; // snapshot BEFORE overwriting, for the undo
    write(list.map((p) => (p.name === sel ? { ...p, data: capture(), savedAt: Date.now() } : p)));
    setUndo({ name: sel, prevData });
    setLeft(Math.round(UNDO_MS / 1000));
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }
  function undoUpdate() {
    if (!undo) return;
    // Restore the snapshot onto whichever profile still bears that name (renamed → gone, that's fine).
    onChange({ ...all, [kind]: (all[kind] || []).map((p) => (p.name === undo.name ? { ...p, data: undo.prevData, savedAt: Date.now() } : p)) });
    clearTimeout(undoTimer.current);
    setUndo(null);
  }
  function rename() {
    if (!selProfile) return;
    const name = (window.prompt('Rename profile to:', sel) || '').trim();
    if (!name || name === sel) return;
    write(list.filter((p) => p.name !== name).map((p) => (p.name === sel ? { ...p, name } : p)));
    setSel(name);
  }
  function remove() {
    if (!selProfile) return;
    if (!window.confirm(`Delete the profile “${sel}”?`)) return;
    write(list.filter((p) => p.name !== sel));
    setSel('');
  }

  return (
    <div className="profiles-bar">
      <span className="profiles-label">Profiles</span>
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">— pick a profile —</option>
        {list.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <button disabled={!selProfile} onClick={() => apply(selProfile.data)} title="Apply this profile's settings">Load</button>
      <button onClick={saveAs} title="Save the current settings as a new profile">Save as…</button>
      <button disabled={!selProfile} onClick={update} title="Overwrite this profile with the current settings">Update</button>
      <button disabled={!selProfile} onClick={rename} title="Rename this profile">Rename</button>
      <button disabled={!selProfile} className="grab-trash" onClick={remove} title="Delete this profile">🗑</button>
      {undo && (
        <button className="profiles-undo" onClick={undoUpdate} title={`Restore “${undo.name}” to what it was before the last Update`}>
          ↩ Undo update ({Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')})
        </button>
      )}
    </div>
  );
}
