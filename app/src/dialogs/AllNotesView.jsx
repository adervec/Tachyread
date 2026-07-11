import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { allNotes, saveNote, deleteNote, deleteCrossNote, saveCrossNote } from '../state/storage.js';
import { AI_NOTE_TYPES } from '../features/journeyAi.js';
import { readStatus } from '../features/journeyLibrary.js';
import { fmtDateTime } from '../features/dateFmt.js';

// One screen for EVERY note in the app: document notes (incl. section-attached + orphans), each
// book's own notes field, the AI's categorized notes, and the shared multi-book/series notes —
// searchable, filterable by kind, and manageable (edit/delete/open) in place. Rendered as a
// Trackyread tab so it sits beside the library it annotates.
const KIND_LABEL = {
  doc: '📄 Document',
  book: '📖 Book',
  ai: '✨ AI',
  shared: '🔗 Shared',
};

export default function AllNotesView({ books, crossNotes, fileStats, onSaveBook, onReloadCross }) {
  const { openRecent, closeDialog } = useApp();
  const [docNotes, setDocNotes] = useState(null);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // { key, text }
  const [revealed, setRevealed] = useState(() => new Set());

  const refreshDocs = () => allNotes().then(setDocNotes).catch(() => setDocNotes([]));
  useEffect(() => { refreshDocs(); }, []);

  const bookById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
  const nameOf = (cs) => fileStats[cs]?.fileName || `${String(cs).slice(0, 8)}…`;

  // Unify all four sources into one sortable list.
  const items = useMemo(() => {
    const out = [];
    for (const n of docNotes || []) {
      out.push({
        key: `doc:${n.checksum}:${n.id}`, kind: 'doc', when: n.updatedAt || n.createdAt || 0,
        where: nameOf(n.checksum), sub: n.section ? `§ ${n.section.title}` : (n.wordIndex != null ? `@ word ${n.wordIndex + 1}` : ''),
        text: n.text, raw: n,
      });
    }
    for (const b of books) {
      if (b.notes && String(b.notes).trim()) {
        out.push({ key: `book:${b.id}`, kind: 'book', when: b.updatedAt || 0, where: b.title, sub: '', text: b.notes, raw: b });
      }
      (Array.isArray(b.aiNotes) ? b.aiNotes : []).forEach((n, i) => {
        const spoiler = (n.type === 'summary' || n.type === 'section-summary') && readStatus(b) !== 'finished';
        out.push({
          key: `ai:${b.id}:${i}`, kind: 'ai', when: n.createdAt || 0, where: b.title,
          sub: `${AI_NOTE_TYPES[n.type] || 'Note'}${n.sectionTitle ? ` · § ${n.sectionTitle}` : ''}`,
          text: n.text, raw: { book: b, index: i }, spoiler,
        });
      });
    }
    for (const n of crossNotes || []) {
      const spanTitles = (n.bookIds || []).map((id) => bookById[id]?.title || id);
      const spoiler = (n.type === 'summary' || n.type === 'section-summary')
        && (n.bookIds || []).some((id) => bookById[id] && readStatus(bookById[id]) !== 'finished');
      out.push({
        key: `shared:${n.id}`, kind: 'shared', when: n.updatedAt || n.createdAt || 0,
        where: [...spanTitles, ...(n.series ? [`📚 ${n.series}`] : [])].join(' · '),
        sub: `${AI_NOTE_TYPES[n.type] || 'Note'}${n.source === 'ai' ? ' · AI' : ''}`,
        text: n.text, raw: n, spoiler,
      });
    }
    return out.sort((a, b) => b.when - a.when);
  }, [docNotes, books, crossNotes, bookById]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { all: items.length, doc: 0, book: 0, ai: 0, shared: 0 };
    for (const it of items) c[it.kind]++;
    return c;
  }, [items]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter((it) => (kind === 'all' || it.kind === kind)
    && (!needle || `${it.text} ${it.where} ${it.sub}`.toLowerCase().includes(needle)));

  async function remove(it) {
    if (it.kind === 'doc') { await deleteNote(it.raw.checksum, it.raw.id); refreshDocs(); }
    else if (it.kind === 'book') { await onSaveBook({ ...it.raw, notes: '' }); }
    else if (it.kind === 'ai') { const b = it.raw.book; await onSaveBook({ ...b, aiNotes: b.aiNotes.filter((_, i) => i !== it.raw.index) }); }
    else if (it.kind === 'shared') { await deleteCrossNote(it.raw.id); onReloadCross?.(); }
  }
  async function saveEdit(it, text) {
    if (it.kind === 'doc') { await saveNote(it.raw.checksum, { ...it.raw, text }); refreshDocs(); }
    else if (it.kind === 'book') { await onSaveBook({ ...it.raw, notes: text }); }
    else if (it.kind === 'ai') { const b = it.raw.book; await onSaveBook({ ...b, aiNotes: b.aiNotes.map((n, i) => (i === it.raw.index ? { ...n, text } : n)) }); }
    else if (it.kind === 'shared') { await saveCrossNote({ ...it.raw, text }); onReloadCross?.(); }
    setEditing(null);
  }

  if (docNotes === null) return <p>Loading…</p>;
  return (
    <div className="an-view">
      <div className="lj-toolbar">
        <input className="lj-search" placeholder="Search all notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        {['all', 'doc', 'book', 'ai', 'shared'].map((k) => (
          <button key={k} className={`lj-qcat${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'All' : KIND_LABEL[k]} ({counts[k]})
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="settings-note">No notes match. Document notes come from the reader (View → Notes & Annotations); book, AI and shared notes live on your tracker books.</p>}
      <div className="an-list">
        {shown.map((it) => {
          const hidden = it.spoiler && !revealed.has(it.key);
          return (
            <div key={it.key} className={`an-card${hidden ? ' lj-spoiler' : ''}`}
              onClick={hidden ? () => setRevealed((r) => new Set(r).add(it.key)) : undefined}>
              <div className="an-head">
                <span className="an-kind">{KIND_LABEL[it.kind]}</span>
                <b className="an-where">{it.where}</b>
                {it.sub && <em className="an-sub">{it.sub}</em>}
                <span className="an-when">{it.when ? fmtDateTime(it.when) : ''}</span>
              </div>
              {hidden ? <span className="lj-spoiler-label">🙈 Spoiler — unfinished. Click to reveal.</span> : null}
              {editing?.key === it.key ? (
                <>
                  <textarea rows={3} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                  <div className="an-actions">
                    <button className="toggle-on" onClick={() => saveEdit(it, editing.text)}>Save</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className={`an-text${hidden ? ' an-blur' : ''}`}>{it.text}</div>
                  <div className="an-actions">
                    {it.kind === 'doc' && (
                      <button title="Open this document in the reader" onClick={async () => { if (await openRecent(it.raw.checksum)) closeDialog?.(); }}>▶ Open file</button>
                    )}
                    <span style={{ flex: 1 }} />
                    <button onClick={() => setEditing({ key: it.key, text: it.text })}>Edit</button>
                    <button className="grab-trash" onClick={() => remove(it)}>🗑</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
