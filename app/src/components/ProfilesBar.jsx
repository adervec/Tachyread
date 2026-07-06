import { useState } from 'react';

// Named settings profiles for a settings dialog: save the current values under a name, load /
// overwrite / rename / delete. `profiles` is the full global.settingsProfiles object; `kind` picks
// the 'tab' or 'app' list; `capture()` returns the data to save; `apply(data)` loads one.
export default function ProfilesBar({ kind, profiles, onChange, capture, apply }) {
  const all = profiles && typeof profiles === 'object' ? profiles : { tab: [], app: [] };
  const list = all[kind] || [];
  const [sel, setSel] = useState('');
  const selProfile = list.find((p) => p.name === sel) || null;

  const write = (nextList) => onChange({ ...all, [kind]: nextList });
  function saveAs() {
    const name = (window.prompt('Save these settings as a profile named:', sel || '') || '').trim();
    if (!name) return;
    write([...list.filter((p) => p.name !== name), { name, data: capture(), savedAt: Date.now() }]);
    setSel(name);
  }
  function update() {
    if (!selProfile) return;
    write(list.map((p) => (p.name === sel ? { ...p, data: capture(), savedAt: Date.now() } : p)));
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
    </div>
  );
}
