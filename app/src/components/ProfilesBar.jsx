import { useEffect, useRef, useState } from 'react';
import { deepEqual } from '../features/deepEqual.js';
import { builtinProfiles, appliesCleanly } from '../features/builtinProfiles.js';

const UNDO_MS = 120000; // an "Update" can be undone for two minutes
const BUILTIN_PREFIX = '__builtin:'; // <select> values for built-ins, so they can't collide with saved names

// Named settings profiles for a settings dialog: save the current values under a name, load /
// overwrite / rename / delete. `profiles` is the full global.settingsProfiles object; `kind` picks
// the 'tab' or 'app' list; `capture()` returns the data to save; `apply(data)` loads one.
// Every kind also offers read-only BUILT-IN presets optimized per device class (desktop / phone /
// tablet — see features/builtinProfiles.js): loadable partial patches that can't be edited.
export default function ProfilesBar({ kind, profiles, onChange, capture, apply }) {
  const all = profiles && typeof profiles === 'object' ? profiles : { tab: [], app: [] };
  const list = all[kind] || [];
  const builtins = builtinProfiles(kind);
  // Current settings, recomputed each render so the button-enable logic tracks live edits.
  const current = capture();
  // The profile (if any) whose data EXACTLY matches the current settings right now. `find` returns
  // the same list element by reference when the match is unchanged, so the effect below is stable.
  const matching = list.find((p) => deepEqual(p.data, current)) || null;
  // Preselect the matching profile when the dialog opens (once). If the current settings are exactly
  // a saved profile, that profile shows selected from the start.
  const [sel, setSel] = useState(() => (list.find((p) => deepEqual(p.data, capture()))?.name || ''));
  const selProfile = list.find((p) => p.name === sel) || null;
  const selBuiltin = sel.startsWith(BUILTIN_PREFIX) ? builtins.find((b) => b.name === sel.slice(BUILTIN_PREFIX.length)) || null : null;
  // Keep the dropdown honest: while nothing is hand-selected, reflect whichever profile the live
  // settings now match (or clear when they match none) — but never fight a manual selection.
  useEffect(() => {
    setSel((cur) => {
      // A hand-picked built-in stays put unless a SAVED profile now matches exactly.
      if (cur.startsWith(BUILTIN_PREFIX)) return matching ? matching.name : cur;
      if (cur && list.some((p) => p.name === cur)) {
        // Hand-selected profile still loaded verbatim? fine. Edited away from it but now matching
        // another? snap to the match. Otherwise keep the manual selection.
        if (deepEqual(selProfile?.data, current)) return cur;
        return matching ? matching.name : cur;
      }
      return matching ? matching.name : '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matching]);
  const selMatchesCurrent = selBuiltin ? appliesCleanly(selBuiltin.data, current) : (!!selProfile && deepEqual(selProfile.data, current));

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
        {builtins.length > 0 && (
          <optgroup label="Built-in (by device)">
            {builtins.map((b) => <option key={b.name} value={BUILTIN_PREFIX + b.name}>{b.name}</option>)}
          </optgroup>
        )}
        {builtins.length > 0 && list.length > 0
          ? <optgroup label="Yours">{list.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
          : list.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <button
        disabled={(!selProfile && !selBuiltin) || selMatchesCurrent}
        onClick={() => apply(selBuiltin ? selBuiltin.data : selProfile.data)}
        title={selMatchesCurrent
          ? (selBuiltin ? 'This preset is already in effect' : 'These settings already match this profile')
          : (selBuiltin ? 'Apply this built-in device preset (only the settings it covers change)' : 'Apply this profile\'s settings')}
      >Load</button>
      <button disabled={!!matching} onClick={saveAs} title={matching ? `These settings are already saved as “${matching.name}”` : 'Save the current settings as a new profile'}>Save as…</button>
      <button disabled={!selProfile || selMatchesCurrent} onClick={update} title={selBuiltin ? 'Built-in presets can\'t be changed — use Save as… to make your own copy' : selMatchesCurrent ? 'This profile already holds these exact settings' : 'Overwrite this profile with the current settings'}>Update</button>
      <button disabled={!selProfile} onClick={rename} title={selBuiltin ? 'Built-in presets can\'t be renamed' : 'Rename this profile'}>Rename</button>
      <button disabled={!selProfile} className="grab-trash" onClick={remove} title={selBuiltin ? 'Built-in presets can\'t be deleted' : 'Delete this profile'}>🗑</button>
      {undo && (
        <button className="profiles-undo" onClick={undoUpdate} title={`Restore “${undo.name}” to what it was before the last Update`}>
          ↩ Undo update ({Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')})
        </button>
      )}
    </div>
  );
}
