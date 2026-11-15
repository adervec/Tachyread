import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { allFiles, allGrabbed, getBinding, getLibraryBooks } from '../state/storage.js';
import { makeGroup, percentOf, masterOf, groupForChecksum, matchRating, matchLabel } from '../features/bookGroups.js';
import { t } from '../i18n.js';

// Group/ungroup files as the SAME book so reading progress syncs across them as a percentage.
// See features/bookGroups.js for the rationale (editions differ → share position, not the mask).
export default function BookGroupsDialog({ onClose }) {
  const { state, updateGlobal, openDialog } = useApp();
  const groups = state.global.bookGroups || [];
  const [files, setFiles] = useState([]); // FileSettings rows {checksum, totalWords, wordIndex}
  const [nameMap, setNameMap] = useState({});
  const [bindMap, setBindMap] = useState({}); // checksum → Trackyread book id
  const [trackerBooks, setTrackerBooks] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const fs = (await allFiles().catch(() => [])).filter((f) => f.checksum);
      setFiles(fs);
      const map = {};
      // The file record's own name first (it syncs with progress, so books read on OTHER devices
      // are named too) — no raw checksums.
      for (const f of fs) if (f.fileName) map[f.checksum] = f.fileName;
      for (const r of state.global.recentFiles || []) if (r.checksum && !map[r.checksum]) map[r.checksum] = r.name;
      for (const g of await allGrabbed().catch(() => [])) if (g.checksum && !map[g.checksum]) map[g.checksum] = g.name;
      for (const tab of state.tabs) if (tab.doc?.contentChecksum && !map[tab.doc.contentChecksum]) map[tab.doc.contentChecksum] = tab.doc.fileName;
      setNameMap(map);
      setBindMap(await getBinding().catch(() => ({})));
      setTrackerBooks(await getLibraryBooks().catch(() => []));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recByChecksum = useMemo(() => Object.fromEntries(files.map((f) => [f.checksum, f])), [files]);
  const groupedSet = useMemo(() => new Set(groups.flatMap((g) => g.members || [])), [groups]);
  const bookById = useMemo(() => Object.fromEntries(trackerBooks.map((b) => [b.id, b])), [trackerBooks]);
  const openSet = useMemo(() => new Set(state.tabs.map((tab) => tab.doc?.contentChecksum).filter(Boolean)), [state.tabs]);
  const nameOf = (cs) => nameMap[cs] || t('Book {id}', { id: cs.slice(0, 6) }); // never a raw checksum
  const pctLabel = (cs) => (recByChecksum[cs]?.totalWords ? `${Math.round(percentOf(recByChecksum[cs]) * 100)}%` : t('not opened here'));
  // The Trackyread book this file is linked to (via the tracker's doc-binding), if any.
  const trackerFor = (cs) => { const id = bindMap[cs]; return id ? bookById[id] : null; };
  const TrackerLink = ({ cs }) => {
    const b = trackerFor(cs);
    if (!b) return null;
    return <button className="link-btn bg-tracker" title={t('Open this book in Trackyread')} onClick={() => openDialog({ kind: 'literary-journey' })}>📖 {b.title || 'Trackyread'}</button>;
  };

  function toggle(cs) {
    setSel((s) => { const n = new Set(s); if (n.has(cs)) n.delete(cs); else n.add(cs); return n; });
  }
  async function createGroup() {
    const g = makeGroup(newName, [...sel], Date.now());
    if (!g) { setMsg(t('Pick at least two files to group as one book.')); return; }
    // A file belongs to at most one group: strip the chosen members from any existing group first.
    const cleaned = groups
      .map((x) => ({ ...x, members: (x.members || []).filter((m) => !g.members.includes(m)) }))
      .filter((x) => (x.members || []).length >= 2);
    await updateGlobal({ bookGroups: [...cleaned, g] });
    setSel(new Set()); setNewName('');
    setMsg(t.n('Grouped {n} file as “{name}”. Opening any of them now shares progress.', 'Grouped {n} files as “{name}”. Opening any of them now shares progress.', g.members.length, { name: g.name }));
  }
  async function ungroup(id) {
    await updateGlobal({ bookGroups: groups.filter((g) => g.id !== id) });
    setMsg(t('Ungrouped on this device. (If another device still has the group, it can return on next sync.)'));
  }
  function rename(id, name) {
    updateGlobal({ bookGroups: groups.map((g) => (g.id === id ? { ...g, name } : g)) });
  }
  function setMaster(id, cs) {
    updateGlobal({ bookGroups: groups.map((g) => (g.id === id ? { ...g, master: cs } : g)) });
  }
  function removeMember(id, cs) {
    const next = groups
      .map((g) => {
        if (g.id !== id) return g;
        const members = (g.members || []).filter((m) => m !== cs);
        const master = g.master === cs ? members[0] : g.master; // reassign master if it was removed
        return { ...g, members, master };
      })
      .filter((g) => (g.members || []).length >= 2);
    updateGlobal({ bookGroups: next });
  }

  const ungrouped = files.filter((f) => !groupedSet.has(f.checksum));

  return (
    <Dialog title={t('Book groups')} onClose={onClose} width={620} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <p className="settings-note" style={{ marginTop: 0 }}>
        {t('Group different files that are really the same book — a re-scan, another edition, or a copy with one stray character. Opening any member resumes at the furthest point reached across the group, and that percentage syncs between your devices. If the files are genuinely different this will mis-track; it trades exactness for never losing your place over a trivial difference.')}
      </p>
      <p className="settings-note" style={{ marginTop: 0 }}>
        {t('Pick a ★ master copy in each group — the canonical edition that represents the book (it names the group and is the one to prefer when they differ).')}
      </p>
      {msg && <p className="settings-note">{msg}</p>}

      {openSet.size > 0 && (
        <>
          <div className="field-section">{t('Open now')}</div>
          <div className="bg-open">
            {[...openSet].map((cs) => {
              const grp = groupForChecksum(groups, cs);
              return (
                <div key={cs} className="bg-open-row">
                  <span className="bg-open-dot" title={t('Currently open')}>●</span>
                  <span className="bg-member-name" title={cs}>{nameOf(cs)}</span>
                  <span className="settings-note" style={{ margin: 0 }}>{pctLabel(cs)}</span>
                  {grp && <span className="bg-open-grp" title={t('Part of a book group')}>📚 {grp.name || t('grouped')}</span>}
                  <TrackerLink cs={cs} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {groups.length > 0 && <div className="field-section">{t('Your book groups')}</div>}
      {groups.map((g) => {
        const master = masterOf(g);
        return (
          <div key={g.id} className="bg-group">
            <div className="bg-group-head">
              <input value={g.name} onChange={(e) => rename(g.id, e.target.value)} aria-label={t('Group name')} />
              <button className="grab-trash" onClick={() => ungroup(g.id)}>{t('Ungroup')}</button>
            </div>
            {(g.members || []).map((cs) => {
              const isMaster = cs === master;
              return (
                <div key={cs} className={`bg-member${isMaster ? ' bg-master' : ''}`}>
                  <label className="bg-master-pick" title={isMaster ? t('Master (canonical) copy') : t('Make this the master copy')}>
                    <input type="radio" name={`master-${g.id}`} checked={isMaster} onChange={() => setMaster(g.id, cs)} />
                    <span className="bg-star">{isMaster ? '★' : '☆'}</span>
                  </label>
                  <span className="bg-member-name" title={cs}>{nameOf(cs)}{isMaster && <span className="bg-master-tag"> · {t('master')}</span>}{openSet.has(cs) && <span className="bg-open-dot" title={t('Currently open')}> ●</span>}</span>
                  <span className="settings-note" style={{ margin: 0 }}>{pctLabel(cs)}</span>
                  {!isMaster && (() => {
                    const r = matchRating(recByChecksum[master], recByChecksum[cs], nameOf(master), nameOf(cs));
                    return <span className={`bg-match bg-match-${matchLabel(r)}`} title={t('How well this edition matches the master (word-count agreement + filename similarity)')}>{t('{pct}% match', { pct: r })}</span>;
                  })()}
                  <TrackerLink cs={cs} />
                  <button onClick={() => removeMember(g.id, cs)} title={t('Remove from this book')}>×</button>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="field-section">{t('New group')}</div>
      {ungrouped.length < 2 ? (
        <p className="settings-note">{t('Open at least two files — they appear in your library once opened — to group them as one book.')}</p>
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
            <input placeholder={t('Book name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="toggle-on" disabled={sel.size < 2} onClick={createGroup}>
              {sel.size >= 2 ? t.n('Group {n} file as one book', 'Group {n} files as one book', sel.size) : t('Group as one book')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
