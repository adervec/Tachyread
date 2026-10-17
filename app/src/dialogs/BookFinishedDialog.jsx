import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getBinding, setBinding, getLibraryBooks, saveLibraryBook, getLibraryRef } from '../state/storage.js';
import { deriveId, setReadStatus } from '../features/journeyLibrary.js';
import { normTitle } from '../document/tocWizard.js';
import { useApp } from '../state/AppContext.jsx';
import { queueBooks, nextInQueue } from '../features/readingQueues.js';
import { getSearchDirs } from '../features/fileLocator.js';
import { fileWhere, openBookFile } from '../features/openBook.js';

function fmtTime(secs) {
  if (!secs) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
}
const todayISO = () => new Date().toISOString().slice(0, 10);

function Stars({ value, onChange }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? 'on' : ''}`}
          onClick={() => onChange(n === value ? 0 : n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// Shown when the reader confirms a book is finished: overall stats, a star rating, notes, and — the
// finish is also the moment to make sure the book is tracked — a check of whether this document is
// linked to a Trackyread library entry, with a one-tap link/create if it isn't. Saving records a
// completion entry, the rating/notes, and marks the linked tracker book finished too.
export default function BookFinishedDialog({ tab, onPatch, onClose }) {
  const tr = tab.tracker;
  const checksum = tab.doc.contentChecksum;
  const cleanName = (tab.doc.fileName || 'Untitled').replace(/\.[^.]+$/, '');
  const [rating, setRating] = useState(tab.settings.rating || 0);
  const [notes, setNotes] = useState(tab.settings.notes || '');

  // Trackyread link state: books + whether this doc is already bound, plus the user's link choice.
  const [lib, setLib] = useState(null); // null while loading → { books, boundBook }
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState({ mode: 'skip', bookId: null }); // 'skip' | 'existing' | 'new'
  useEffect(() => {
    let alive = true;
    (async () => {
      const [map, books] = await Promise.all([getBinding(), getLibraryBooks()]);
      if (!alive) return;
      const boundBook = books.find((b) => b.id === map[checksum]) || null;
      setLib({ books, boundBook, map: map || {} });
    })();
    return () => { alive = false; };
  }, [checksum]);

  // Title-overlap suggestions from the library so linking is usually one tap.
  const suggestions = useMemo(() => {
    if (!lib || lib.boundBook) return [];
    const want = new Set(normTitle(cleanName).split(' ').filter((w) => w.length > 2));
    if (!want.size) return [];
    return lib.books
      .map((b) => {
        const bt = new Set(normTitle(`${b.title || ''} ${b.author || ''}`).split(' ').filter((w) => w.length > 2));
        let overlap = 0; for (const w of want) if (bt.has(w)) overlap++;
        return { b, overlap };
      })
      .filter((x) => x.overlap >= 1)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5)
      .map((x) => x.b);
  }, [lib, cleanName]);

  const candidates = useMemo(() => {
    if (!lib || lib.boundBook) return [];
    const q = search.trim().toLowerCase();
    if (!q) return suggestions;
    return lib.books
      .filter((b) => `${b.title || ''} ${b.author || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [lib, search, suggestions]);

  // "Up next": for every queue holding this book, the first unfinished item whose
  // file can actually be opened (open tab, saved copy, or found in the search folders). Worked out
  // from the queues as they stand now, before this book is marked finished.
  const { state: appState, openRecent, openFiles } = useApp();
  const openChecksums = useMemo(() => appState.tabs.map((t) => (t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum)).filter(Boolean), [appState.tabs]);
  const linkedId = lib?.boundBook?.id || (choice.mode === 'existing' ? choice.bookId : null);
  const [upNext, setUpNext] = useState(null); // null = working it out → [{ label, book, cs, name, skipped }]
  const [dirs, setDirs] = useState([]);
  const [openMsg, setOpenMsg] = useState('');
  useEffect(() => {
    if (!lib) return undefined;
    let alive = true;
    (async () => {
      const [named, ds] = await Promise.all([getLibraryRef('queues').catch(() => null), getSearchDirs().catch(() => [])]);
      const live = lib.books.filter((b) => !b.deleted);
      const csOf = {};
      for (const [cs, id] of Object.entries(lib.map)) if (!csOf[id]) csOf[id] = cs;
      const nameOf = (b) => b.title;
      const available = async (b) => ['open', 'local', 'folder'].includes((await fileWhere(csOf[b.id], nameOf(b), { openChecksums, dirs: ds, search: true })).where);
      const lists = [];
      for (const q of Array.isArray(named) ? named : []) if (linkedId && q.ids.includes(linkedId)) lists.push([q.name, queueBooks(q, live)]);
      const out = [];
      for (const [label, order] of lists) {
        const { book, skipped } = await nextInQueue(order.filter((b) => csOf[b.id] !== checksum), linkedId, available);
        if (book || skipped) out.push({ label, book, cs: book && csOf[book.id], skipped });
      }
      if (alive) { setDirs(ds); setUpNext(out); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, linkedId, checksum]);

  const coverage = tr ? tr.coverage() * 100 : 0;
  const activeSecs = tr ? Math.round(tr.lifetimeActiveMs / 1000) : 0;
  const effWpm = tr ? tr.lifetimeWpm() : 0;
  const readCount = tr ? tr.readCount : 0;
  const completions = tab.settings.completions || [];

  async function applyTrackyread() {
    try {
      if (lib?.boundBook) {
        await saveLibraryBook(setReadStatus({ ...lib.boundBook, rating: rating || lib.boundBook.rating }, 'finished', todayISO()));
      } else if (choice.mode === 'existing' && choice.bookId) {
        const book = lib.books.find((b) => b.id === choice.bookId);
        if (book) {
          await setBinding(checksum, book.id);
          await saveLibraryBook(setReadStatus({ ...book, rating: rating || book.rating }, 'finished', todayISO()));
        }
      } else if (choice.mode === 'new') {
        const nb = setReadStatus({ id: '', title: cleanName, author: '', fnf: 'F', rating }, 'finished', todayISO());
        nb.id = deriveId(nb);
        await saveLibraryBook(nb);
        await setBinding(checksum, nb.id);
      }
    } catch { /* linking is best-effort — the completion is still recorded */ }
  }

  async function record() {
    onPatch({
      rating,
      notes,
      completions: [...completions, { date: new Date().toISOString(), coveragePct: Math.round(coverage), activeSecs, wpm: effWpm, rating }],
    });
    await applyTrackyread();
  }
  async function save() {
    await record();
    onClose();
  }
  // Save, then open the next queue item (jumps to its tab when it's already open).
  async function saveAndOpen(n) {
    await record();
    const r = await openBookFile({ cs: n.cs, name: n.book.title, openChecksums, dirs, openRecent, openFiles }).catch((e) => ({ ok: false, msg: e?.message || String(e) }));
    if (r.ok) onClose(); else setOpenMsg(`Saved — but ${r.msg}`);
  }

  return (
    <Dialog
      title="Book Finished 🎉"
      onClose={onClose}
      width={520}
      buttons={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="toggle-on" onClick={save}>Save &amp; mark finished</button>
        </>
      }
    >
      <div className="field-section">{tab.doc.fileName}</div>
      <table className="history-table" style={{ marginBottom: 12 }}>
        <tbody>
          <tr><td>Book read (coverage)</td><td>{coverage.toFixed(1)}% ({readCount} / {tab.doc.words.length} words)</td></tr>
          <tr><td>Total active reading time</td><td>{fmtTime(activeSecs)}</td></tr>
          <tr><td>Effective reading speed</td><td>{effWpm} WPM</td></tr>
          <tr><td>Times finished before</td><td>{completions.length}</td></tr>
        </tbody>
      </table>

      <div className="field-row">
        <label>Your rating</label>
        <Stars value={rating} onChange={setRating} />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Notes / review</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          style={{ width: '100%', resize: 'vertical' }}
          placeholder="What did you think? Key takeaways, favorite parts…"
        />
      </div>

      {/* Trackyread link check */}
      <div className="field-section">Trackyread</div>
      {lib === null ? (
        <p className="settings-note" style={{ marginTop: 0 }}>Checking your reading tracker…</p>
      ) : lib.boundBook ? (
        <p className="settings-note bf-linked" style={{ marginTop: 0 }}>
          🔗 Linked to “{lib.boundBook.title}” — it’ll be marked finished in Trackyread.
        </p>
      ) : (
        <div className="bf-link">
          <p className="settings-note" style={{ marginTop: 0 }}>This book isn’t linked to your Trackyread library — link it so it counts?</p>
          <label className="bf-opt">
            <input type="radio" name="bf-link" checked={choice.mode === 'new'} onChange={() => setChoice({ mode: 'new', bookId: null })} />
            <span>➕ Add “<b>{cleanName}</b>” to Trackyread as finished</span>
          </label>
          <input className="bf-search" placeholder="…or search your library to link an existing book" value={search} onChange={(e) => setSearch(e.target.value)} />
          {candidates.map((b) => (
            <label key={b.id} className="bf-opt">
              <input type="radio" name="bf-link" checked={choice.mode === 'existing' && choice.bookId === b.id} onChange={() => setChoice({ mode: 'existing', bookId: b.id })} />
              <span>🔗 {b.title}{b.author ? <em> · {b.author}</em> : ''}</span>
            </label>
          ))}
          {search.trim() && candidates.length === 0 && <p className="settings-note" style={{ margin: '2px 0' }}>No matching books.</p>}
          <label className="bf-opt">
            <input type="radio" name="bf-link" checked={choice.mode === 'skip'} onChange={() => setChoice({ mode: 'skip', bookId: null })} />
            <span>Don’t link now</span>
          </label>
        </div>
      )}

      {(upNext === null || upNext.length > 0) && <div className="field-section">Up next</div>}
      {upNext === null
        ? <p className="settings-note" style={{ marginTop: 0 }}>Looking for the next book in your queues…</p>
        : upNext.map((n) => (
          <div key={n.label} className="bf-next">
            {n.book
              ? <button className="toggle-on" onClick={() => saveAndOpen(n)}>Save &amp; open “{n.book.title}”</button>
              : <span className="settings-note">Nothing in {n.label} can be opened on this device.</span>}
            <span className="settings-note"> {n.book ? `next in ${n.label}` : ''}{n.skipped ? ` · skipped ${n.skipped} whose file isn’t on this device` : ''}</span>
          </div>
        ))}
      {openMsg && <p className="settings-note">{openMsg}</p>}

      {coverage < 90 && (
        <p className="settings-note">
          Note: you’ve read {coverage.toFixed(1)}% of the book by coverage. Sections you skipped
          aren’t counted as read.
        </p>
      )}
    </Dialog>
  );
}
