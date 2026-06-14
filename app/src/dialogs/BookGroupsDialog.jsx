import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { allFiles, allGrabbed } from '../state/storage.js';
import { makeGroup, percentOf } from '../features/bookGroups.js';

// Group/ungroup files as the SAME book so reading progress syncs across them as a percentage.
// See features/bookGroups.js for the rationale (editions differ → share position, not the mask).
export default function BookGroupsDialog({ onClose }) {
  const { state, updateGlobal } = useApp();
  const groups = state.global.bookGroups || [];
  const [files, setFiles] = useState([]); // FileSettings rows {checksum, totalWords, wordIndex}
  const [nameMap, setNameMap] = useState({});
  const [sel, setSel] = useState(() => new Set());
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const fs = (await allFiles().catch(() => [])).filter((f) => f.checksum);
      setFiles(fs);
      const map = {};
      for (const r of state.global.recentFiles || []) if (r.checksum) map[r.checksum] = r.name;
      for (const g of await allGrabbed().catch(() => [])) if (g.checksum && !map[g.checksum]) map[g.checksum] = g.name;
      for (const t of state.tabs) if (t.doc?.contentChecksum && !map[t.doc.contentChecksum]) map[t.doc.contentChecksum] = t.doc.fileName;
      setNameMap(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recByChecksum = useMemo(() => Object.fromEntries(files.map((f) => [f.checksum, f])), [files]);
  const groupedSet = useMemo(() => new Set(groups.flatMap((g) => g.members || [])), [groups]);
  const nameOf = (cs) => nameMap[cs] || `${cs.slice(0, 8)}…`;
  const pctLabel = (cs) => (recByChecksum[cs]?.totalWords ? `${Math.round(percentOf(recByChecksum[cs]) * 100)}%` : 'not opened here');

  function toggle(cs) {
    setSel((s) => { const n = new Set(s); if (n.has(cs)) n.delete(cs); else n.add(cs); return n; });
  }
  async function createGroup() {
    const g = makeGroup(newName, [...sel], Date.now());
    if (!g) { setMsg('Pick at least two files to group as one book.'); return; }
    // A file belongs to at most one group: strip the chosen members from any existing group first.
    const cleaned = groups
      .map((x) => ({ ...x, members: (x.members || []).filter((m) => !g.members.includes(m)) }))
      .filter((x) => (x.members || []).length >= 2);
    await updateGlobal({ bookGroups: [...cleaned, g] });
    setSel(new Set()); setNewName('');
    setMsg(`Grouped ${g.members.length} files as “${g.name}”. Opening any of them now shares progress.`);
  }
  async function ungroup(id) {
    await updateGlobal({ bookGroups: groups.filter((g) => g.id !== id) });
    setMsg('Ungrouped on this device. (If another device still has the group, it can return on next sync.)');
  }
  function rename(id, name) {
    updateGlobal({ bookGroups: groups.map((g) => (g.id === id ? { ...g, name } : g)) });
  }
  function removeMember(id, cs) {
    const next = groups
      .map((g) => (g.id === id ? { ...g, members: (g.members || []).filter((m) => m !== cs) } : g))
      .filter((g) => (g.members || []).length >= 2);
    updateGlobal({ bookGroups: next });
  }

  const ungrouped = files.filter((f) => !groupedSet.has(f.checksum));

  return (
    <Dialog title="Book groups" onClose={onClose} width={620} buttons={<button onClick={onClose}>Close</button>}>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Group different files that are really the <strong>same book</strong> — a re-scan, another edition,
        or a copy with one stray character. Opening any member resumes at the furthest point reached across
        the group, and that percentage syncs between your devices. If the files are genuinely different this
        will mis-track; it trades exactness for never losing your place over a trivial difference.
      </p>
      {msg && <p className="settings-note">{msg}</p>}

      {groups.length > 0 && <div className="field-section">Your book groups</div>}
      {groups.map((g) => (
        <div key={g.id} className="bg-group">
          <div className="bg-group-head">
            <input value={g.name} onChange={(e) => rename(g.id, e.target.value)} aria-label="Group name" />
            <button className="grab-trash" onClick={() => ungroup(g.id)}>Ungroup</button>
          </div>
          {(g.members || []).map((cs) => (
            <div key={cs} className="bg-member">
              <span className="bg-member-name" title={cs}>{nameOf(cs)}</span>
              <span className="settings-note" style={{ margin: 0 }}>{pctLabel(cs)}</span>
              <button onClick={() => removeMember(g.id, cs)} title="Remove from this book">×</button>
            </div>
          ))}
        </div>
      ))}

      <div className="field-section">New group</div>
      {ungrouped.length < 2 ? (
        <p className="settings-note">Open at least two files — they appear in your library once opened — to group them as one book.</p>
      ) : (
        <>
          <div className="bg-pick">
            {ungrouped.map((f) => (
              <label key={f.checksum} className="bg-pick-row">
                <input type="checkbox" checked={sel.has(f.checksum)} onChange={() => toggle(f.checksum)} />
                <span className="bg-member-name" title={f.checksum}>{nameOf(f.checksum)}</span>
                <span className="settings-note" style={{ margin: 0 }}>{f.totalWords ? `${Math.round(percentOf(f) * 100)}%` : ''}</span>
              </label>
            ))}
          </div>
          <div className="data-row">
            <input placeholder="Book name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="toggle-on" disabled={sel.size < 2} onClick={createGroup}>
              Group {sel.size >= 2 ? sel.size : ''} as one book
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
