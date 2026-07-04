import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import {
  getLibraryBooks, saveLibraryBook, deleteLibraryBook, getLibraryRef,
  getJourneyAi, saveJourneyAi, exportLibraryData, importLibraryData, librarySize, clearLibrary,
  getBinding, setBinding, allDocMeta, allFiles, getFsHandle, setFsHandle,
} from '../state/storage.js';
import { askClaude, anthropicConfigured } from '../features/anthropic.js';
import {
  getInstruction, LIGHT_INSTRUCTION, HEAVY_PLACEHOLDER, buildDataset, buildDigest,
  buildCoworkRequest, buildApiMessages, parseAiOutput, applyAiOutput, contentHash,
} from '../features/journeyAi.js';
import {
  normalizeSeed, filterBooks, sortBooks, libraryStats, exportJourneyMarkdown,
  readStatus, setReadStatus, recommender, READ_STATUSES, STATUS_LABEL,
  distinctValues, pubYear, finishMs, deriveId, bookRating,
} from '../features/journeyLibrary.js';
import {
  cumulativeFinishes, finishHeatmap, paceByYear, genreTrend, recommenderBreakdown, queueWithEstimates, estHours,
} from '../features/journeyAnalytics.js';
import { normTitle } from '../document/tocWizard.js';
import { getSyncProvider } from '../features/sync/syncProviders.js';
import { syncLibraryWithProvider, backupLibraryToProvider } from '../features/sync/syncManager.js';
import { AXES, READER_ARCHETYPES, readerProfile, matchArchetype, currentArchetype, archetypeTrend } from '../features/readerArchetype.js';
import { constellationLayout, CONSTELLATION_R } from '../features/bookConstellation.js';

// Trigger a client-side file download (same anchor trick DataDialog uses; showSaveFilePicker hangs
// headless so a plain anchor is the reliable path).
function download(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// Map the Library editor's status pill back onto the book's completion/inProgress/shelf fields.
const applyStatus = (book, status) => setReadStatus(book, status, todayISO());

function Stat({ v, l, sub }) {
  return <div className="rh-stat"><b className="rh-stat-v">{v}</b><span className="rh-stat-l">{l}</span>{sub && <em className="rh-stat-sub">{sub}</em>}</div>;
}

export default function LiteraryJourneyDialog({ global, onPatch, onClose }) {
  const [books, setBooks] = useState(null);
  const [refs, setRefs] = useState({ authors: null, genres: null, subgenres: null });
  const [ai, setAi] = useState(null);
  const [size, setSize] = useState(null);
  const [bindMap, setBindMap] = useState(null);
  const [docMeta, setDocMeta] = useState([]);
  const [tab, setTab] = useState('dashboard');
  const fileRef = useRef(null);
  const [importMode, setImportMode] = useState('merge');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const reconciled = useRef(false);
  const didInit = useRef(false);

  const sync = { provider: 'localFolder', ...(global?.sync || {}) };
  const provider = getSyncProvider(sync.provider);
  const providerOk = provider && provider.supported() && provider.available(sync) === true;

  // Library view controls
  const [flt, setFlt] = useState({ readState: 'all', fnf: 'all', difficulty: [], recMin: 0, genre: 'all', search: '', recBy: 'all' });
  const [sort, setSort] = useState('rec');
  const [limit, setLimit] = useState(60);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    const [bs, a, g, sg, aiRec, sz, bind, docs] = await Promise.all([
      getLibraryBooks(), getLibraryRef('authors'), getLibraryRef('genres'), getLibraryRef('subgenres'),
      getJourneyAi(), librarySize(), getBinding(), allDocMeta(),
    ]);
    setBooks(bs); setRefs({ authors: a, genres: g, subgenres: sg }); setAi(aiRec); setSize(sz);
    setBindMap(bind); setDocMeta(docs);
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (books && !didInit.current) { didInit.current = true; if (books.length === 0) setTab('data'); } }, [books]);

  // Reconcile-on-open: any tracker book linked to an app document that's now finished (a completion,
  // a "finished" shelf, or ≥99% read) gets marked finished. Runs once per open. ponytail: a snapshot
  // pass, not a live hook on the finish flow — the upgrade path is wiring BookFinishedDialog directly.
  useEffect(() => {
    if (reconciled.current || !books || !bindMap || Object.keys(bindMap).length === 0) return;
    reconciled.current = true;
    (async () => {
      const files = await allFiles();
      const shelves = global?.readingList?.shelves || {};
      const byChk = Object.fromEntries(files.map((f) => [f.checksum, f]));
      let changed = 0;
      for (const [checksum, bookId] of Object.entries(bindMap)) {
        const f = byChk[checksum];
        const done = shelves[checksum] === 'finished' || (f?.completions?.length > 0) || (f && f.totalWords > 0 && (f.persistentWordsRead || 0) / f.totalWords >= 0.99);
        if (!done) continue;
        const book = books.find((b) => b.id === bookId);
        if (!book || book.completion === true) continue;
        const finDate = f?.completions?.length ? (f.completions[f.completions.length - 1].date || todayISO()) : todayISO();
        await saveLibraryBook({ ...book, completion: true, inProgress: false, finishTime: book.finishTime || finDate });
        changed++;
      }
      if (changed) reload();
    })();
  }, [books, bindMap]);

  async function bind(checksum, bookId) {
    const prev = Object.entries(bindMap || {}).find(([, id]) => id === bookId)?.[0];
    if (prev && prev !== checksum) await setBinding(prev, null);
    if (checksum) await setBinding(checksum, bookId);
    setBindMap(await getBinding());
  }

  async function syncTracker() {
    setSyncBusy(true); setSyncMsg('Syncing tracker…');
    try {
      const r = await syncLibraryWithProvider(sync.provider, sync);
      onPatch?.({ sync: { ...sync, lastLibrarySync: Date.now() } });
      reconciled.current = false; await reload();
      setSyncMsg(`Synced — ${r.books} books (${Math.round(r.bytes / 1024)} KB).`);
    } catch (e) { setSyncMsg('Sync failed: ' + (e?.message || e)); }
    setSyncBusy(false);
  }

  // Best-effort silent push on close — only when a live connection already exists (no OAuth popup).
  async function handleClose() {
    try {
      if (sync.auto && provider && (await provider.isConnected?.())) {
        await backupLibraryToProvider(sync.provider, sync, { silent: true });
        onPatch?.({ sync: { ...sync, lastLibrarySync: Date.now() } });
      }
    } catch { /* best effort */ }
    onClose?.();
  }

  const stats = useMemo(() => (books ? libraryStats(books) : null), [books]);
  const genreOptions = useMemo(() => (books ? distinctValues(books, 'genre') : []), [books]);
  const recOptions = useMemo(() => (books ? [...new Set(books.map(recommender))].sort((a, b) => a.localeCompare(b)) : []), [books]);
  const filtered = useMemo(() => (books ? sortBooks(filterBooks(books, flt), sort) : []), [books, flt, sort]);
  const shown = filtered.slice(0, limit);
  const selBook = useMemo(() => books?.find((b) => b.id === selected) || null, [books, selected]);

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const env = normalizeSeed(raw);
      if (importMode === 'replace' && !window.confirm(`Replace the tracker with ${env.books.length} books from this file? Books you added on this device that aren’t in the file are removed.`)) return;
      const r = await importLibraryData(env, { mode: importMode });
      await reload();
      window.alert(`Imported ${env.books.length} books (${r.added} new, ${r.merged} updated).`);
    } catch (err) {
      window.alert('Import failed: ' + (err?.message || err));
    }
  }

  async function exportFull(kind) {
    if (kind === 'md') { download('reading-journey.md', exportJourneyMarkdown(books, { title: 'Reading Journey' }), 'text/markdown'); return; }
    const bundle = await exportLibraryData();
    download('tachyread-library.json', JSON.stringify(bundle));
  }

  async function exportView(kind) {
    if (kind === 'md') { download('reading-journey-filtered.md', exportJourneyMarkdown(filtered, { title: 'Reading Journey (filtered)' }), 'text/markdown'); return; }
    const bundle = await exportLibraryData({ books: filtered, includeDeleted: false, includeBinding: false, includeAi: false });
    download('tachyread-library-filtered.json', JSON.stringify(bundle));
  }

  async function saveBook(patch) { await saveLibraryBook(patch); await reload(); }
  // One-tap reshelving (queue / start reading / abandon / finish / back to to-read) from any list row.
  async function shelve(book, status) { await saveLibraryBook(setReadStatus(book, status, todayISO())); await reload(); }
  async function removeBook(id) {
    if (!window.confirm('Remove this book from your tracker?')) return;
    await deleteLibraryBook(id); setSelected(null); await reload();
  }
  async function wipe() {
    if (!window.confirm('Delete the ENTIRE reading tracker from this device? Export first if you want a copy.')) return;
    await clearLibrary(); await reload();
  }

  const empty = books && books.length === 0;
  const queueCount = useMemo(() => (books ? books.filter((b) => readStatus(b) === 'queue').length : 0), [books]);
  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'library', label: `Library${books ? ` (${books.length})` : ''}` },
    { id: 'queue', label: `Queue${queueCount ? ` (${queueCount})` : ''}` },
    { id: 'timeline', label: 'Timeline' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'authors', label: 'Authors' },
    { id: 'genres', label: 'Genres' },
    { id: 'archetype', label: 'Archetype' },
    { id: 'constellation', label: 'Tech Tree' },
    { id: 'ai', label: 'AI / Cowork' },
    { id: 'data', label: 'Import / Export' },
  ];

  return (
    <Dialog title="Literary Journey" onClose={handleClose} width={880} buttons={<button onClick={handleClose}>Close</button>}>
      {!books && <p>Loading…</p>}
      {books && (
        <>
          {empty && <p className="settings-note">Your reading tracker is empty — import your <code>library.json</code> under <b>Import / Export</b> (nothing is bundled with the app).</p>}
          <div className="rh-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`rh-tab${tab === t.id ? ' on' : ''}`} onClick={() => { setTab(t.id); setSelected(null); }}>{t.label}</button>
            ))}
          </div>

          {tab === 'dashboard' && stats && (
            <div className="lj-dash">
              <div className="rh-stat-grid">
                <Stat v={stats.total} l="books" />
                <Stat v={stats.finished} l="finished" sub={`${stats.reading} reading${stats.abandoned ? ` · ${stats.abandoned} abandoned` : ''}`} />
                <Stat v={stats.queue} l="on deck" sub={`${stats.toread.toLocaleString()} to read`} />
                <Stat v={stats.fiction} l="fiction" sub={`${stats.nonfiction} non-fiction`} />
                <Stat v={stats.words ? (stats.words / 1e6).toFixed(1) + 'M' : '0'} l="words read" />
                <Stat v={stats.pages ? stats.pages.toLocaleString() : '0'} l="pages read" />
              </div>

              <div className="rh-section-h">Difficulty of finished books</div>
              <div className="lj-diffbars">
                {[1, 2, 3, 4, 5].map((d) => {
                  const n = stats.byDifficulty[d] || 0;
                  const max = Math.max(1, ...Object.values(stats.byDifficulty));
                  return <div key={d} className="lj-diffbar" title={`${n} book(s)`}><span className="lj-diffbar-fill" style={{ height: `${(n / max) * 100}%` }} /><em>{d}</em></div>;
                })}
              </div>

              {ai?.analysis && (<><div className="rh-section-h">AI analysis</div><p className="lj-analysis">{ai.analysis}</p></>)}
              {ai?.recommendations?.length > 0 && (
                <><div className="rh-section-h">Recommended next</div>
                  <ul className="lj-recs">{ai.recommendations.slice(0, 8).map((r, i) => <li key={i}>{typeof r === 'string' ? r : `${r.title || ''}${r.author ? ' — ' + r.author : ''}${r.why ? ' · ' + r.why : ''}`}</li>)}</ul></>
              )}

              <div className="rh-section-h">Recently finished</div>
              {stats.recentFinishes.length === 0 && <p className="settings-note">No dated finishes yet.</p>}
              <ul className="lj-recent">
                {stats.recentFinishes.map((b) => (
                  <li key={b.id}><b>{b.title}</b> — {b.author} <em>{finishMs(b) ? new Date(finishMs(b)).toISOString().slice(0, 10) : ''}</em></li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'library' && (
            <div className="lj-lib">
              <div className="lj-toolbar">
                <input className="lj-search" placeholder="Search title / author / series…" value={flt.search} onChange={(e) => { setFlt({ ...flt, search: e.target.value }); setLimit(60); }} />
                <select value={flt.readState} onChange={(e) => setFlt({ ...flt, readState: e.target.value })}>
                  <option value="all">All statuses</option><option value="finished">Finished</option><option value="reading">Reading</option><option value="queue">On deck</option><option value="toread">To read</option><option value="abandoned">Abandoned</option>
                </select>
                <select value={flt.fnf} onChange={(e) => setFlt({ ...flt, fnf: e.target.value })}>
                  <option value="all">Fiction + NF</option><option value="F">Fiction</option><option value="NF">Non-fiction</option>
                </select>
                <select value={flt.genre} onChange={(e) => setFlt({ ...flt, genre: e.target.value })}>
                  <option value="all">All genres</option>{genreOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={flt.recBy} onChange={(e) => setFlt({ ...flt, recBy: e.target.value })} title="Recommended by">
                  <option value="all">Any recommender</option>{recOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={flt.recMin} onChange={(e) => setFlt({ ...flt, recMin: Number(e.target.value) })}>
                  <option value={0}>Any rec</option><option value={9}>Rec 9+</option><option value={8}>Rec 8+</option>
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="rec">Sort: Rec</option><option value="title">Title</option><option value="author">Author</option><option value="pages">Pages</option><option value="pub">Published</option><option value="finished">Recently finished</option>
                </select>
                <span className="lj-diffpick">Diff:{[1, 2, 3, 4, 5].map((d) => (
                  <label key={d}><input type="checkbox" checked={flt.difficulty.includes(d)} onChange={(e) => { const s = new Set(flt.difficulty); e.target.checked ? s.add(d) : s.delete(d); setFlt({ ...flt, difficulty: [...s] }); }} />{d}</label>
                ))}</span>
              </div>
              <div className="lj-toolbar2">
                <span className="settings-note">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
                <span className="lj-spacer" />
                <button onClick={() => setAdding(true)}>+ Add book</button>
                <button onClick={() => exportView('json')}>Export view (JSON)</button>
                <button onClick={() => exportView('md')}>Export view (Markdown)</button>
              </div>

              {adding && <BookEditor book={{ id: '', title: '', author: '', genre: '', fnf: 'F', type: 'long' }} isNew onCancel={() => setAdding(false)} onSave={async (b) => { await saveBook({ ...b, id: deriveId(b) }); setAdding(false); }} />}
              {selBook && <BookEditor book={selBook} docMeta={docMeta} bindMap={bindMap} onBind={bind} onCancel={() => setSelected(null)} onSave={saveBook} onDelete={() => removeBook(selBook.id)} />}

              <div className="lj-list">
                {shown.map((b) => {
                  const st = readStatus(b);
                  return (
                    <div key={b.id} className={`lj-row${selected === b.id ? ' on' : ''}`}>
                      <button className="lj-row-hit" onClick={() => { setSelected(selected === b.id ? null : b.id); setAdding(false); }}>
                        <span className={`lj-status lj-${st}`}>{STATUS_LABEL[st].split(' ')[0]}</span>
                        <span className="lj-row-main"><b>{b.title}</b><em>{b.author}{b.series ? ` · ${b.series}${b.seriesNum ? ' #' + b.seriesNum : ''}` : ''}</em></span>
                        <span className="lj-row-meta">{b.genre || ''}{b.difficultyLevel ? ` · D${b.difficultyLevel}` : ''}{b.recScore ? ` · ★${b.recScore}` : ''}{pubYear(b) ? ` · ${pubYear(b)}` : ''}{recommender(b) !== 'Claude' ? ` · ✦${recommender(b)}` : ''}</span>
                      </button>
                      <span className="lj-row-acts">
                        <button title="On deck (queue)" className={st === 'queue' ? 'on' : ''} onClick={() => shelve(b, st === 'queue' ? 'toread' : 'queue')}>📋</button>
                        <button title="Reading" className={st === 'reading' ? 'on' : ''} onClick={() => shelve(b, 'reading')}>📖</button>
                        <button title="Finished" className={st === 'finished' ? 'on' : ''} onClick={() => shelve(b, 'finished')}>✅</button>
                        <button title="Abandon" className={st === 'abandoned' ? 'on' : ''} onClick={() => shelve(b, st === 'abandoned' ? 'toread' : 'abandoned')}>✕</button>
                      </span>
                    </div>
                  );
                })}
              </div>
              {filtered.length > limit && <button className="lj-more" onClick={() => setLimit(limit + 60)}>Load more ({filtered.length - limit} left)</button>}
            </div>
          )}

          {tab === 'queue' && <QueueView books={books} onShelve={shelve} onOpen={(id) => { setTab('library'); setSelected(id); }} />}
          {tab === 'timeline' && <TimelineView books={books} />}
          {tab === 'analytics' && <AnalyticsView books={books} />}
          {tab === 'authors' && <RefList kind="author" items={refs.authors} books={books} />}
          {tab === 'genres' && <RefList kind="genre" items={refs.genres} subitems={refs.subgenres} books={books} />}
          {tab === 'archetype' && <ArchetypeView books={books} />}
          {tab === 'constellation' && <ConstellationView books={books} ai={ai} />}
          {tab === 'ai' && <AiView books={books} ai={ai} global={global} onReload={reload} />}

          {tab === 'data' && (
            <div className="lj-data">
              <div className="rh-section-h">Import a library</div>
              <p className="settings-note">Import your own <code>library.json</code> (or a tracker export). Nothing is shipped with the app.</p>
              <div className="lj-inline">
                <label><input type="radio" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> Merge (keep existing, update matches)</label>
                <label><input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace</label>
              </div>
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
              <button onClick={() => fileRef.current?.click()}>Choose file…</button>

              <div className="rh-section-h">Export everything</div>
              <div className="lj-inline">
                <button onClick={() => exportFull('json')}>Full tracker (JSON)</button>
                <button onClick={() => exportFull('md')}>Reading history (Markdown)</button>
              </div>
              <p className="settings-note">Filtered / partial exports live on the <b>Library</b> tab (“Export view”).</p>

              <div className="rh-section-h">Cloud sync (whole tracker)</div>
              <p className="settings-note">Syncs the entire tracker as its own file ({provider?.label || 'no target set'}) — separate from reading-progress sync. Set up / sign in to the target under <b>Settings → Data Management → Cloud sync</b>.</p>
              <div className="lj-inline">
                <button disabled={!providerOk || syncBusy} onClick={syncTracker}>Sync tracker now</button>
                {sync.lastLibrarySync ? <span className="settings-note">Last: {new Date(sync.lastLibrarySync).toLocaleString()}</span> : null}
              </div>
              {syncMsg && <p className="settings-note">{syncMsg}</p>}

              <div className="rh-section-h">Storage</div>
              <p className="settings-note">{size ? `${size.books.toLocaleString()} books · ~${(size.bytes / 1024 / 1024).toFixed(2)} MB on this device.` : ''} The tracker is excluded from the local full backup — it moves via these exports and (once set up) its own cloud file.</p>
              <button className="lj-danger" onClick={wipe}>Delete tracker from this device…</button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

// Fuzzy-suggest which opened document matches a book, by token overlap of title/author vs filename.
function suggestDoc(book, docMeta) {
  if (!docMeta?.length) return null;
  const target = new Set(normTitle(`${book.title || ''} ${book.author || ''}`).split(' ').filter((w) => w.length > 2));
  if (!target.size) return null;
  let best = null, bestScore = 0;
  for (const d of docMeta) {
    const score = normTitle(d.fileName || '').split(' ').filter((w) => target.has(w)).length;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore >= 1 ? best : null;
}

// Inline add/edit card for one book.
function BookEditor({ book, isNew = false, docMeta = [], bindMap = {}, onBind, onSave, onCancel, onDelete }) {
  const [b, setB] = useState(book);
  useEffect(() => { setB(book); }, [book]);
  const status = readStatus(b);
  const set = (p) => setB({ ...b, ...p });
  const currentLink = !isNew && Object.entries(bindMap || {}).find(([, id]) => id === b.id)?.[0];
  const suggested = !isNew && !currentLink ? suggestDoc(b, docMeta) : null;
  return (
    <div className="lj-editor">
      <div className="lj-editor-grid">
        <label>Title<input value={b.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Author<input value={b.author || ''} onChange={(e) => set({ author: e.target.value })} /></label>
        <label>Genre<input value={b.genre || ''} onChange={(e) => set({ genre: e.target.value })} /></label>
        <label>Subgenre<input value={b.subgenre || ''} onChange={(e) => set({ subgenre: e.target.value })} /></label>
        <label>Fiction?<select value={b.fnf || ''} onChange={(e) => set({ fnf: e.target.value })}><option value="F">Fiction</option><option value="NF">Non-fiction</option></select></label>
        <label>Status<select value={status} onChange={(e) => setB(applyStatus(b, e.target.value))}><option value="toread">To read</option><option value="queue">On deck</option><option value="reading">Reading</option><option value="finished">Finished</option><option value="abandoned">Abandoned</option></select></label>
        <label>Finished<input type="date" value={(finishMs(b) ? new Date(finishMs(b)).toISOString().slice(0, 10) : '')} onChange={(e) => set({ finishTime: e.target.value })} /></label>
        <label>Rec. by<input value={b.recBy || ''} placeholder="Claude" onChange={(e) => set({ recBy: e.target.value })} /></label>
        <label>Rating<input type="number" min="0" max="5" value={bookRating(b) || ''} onChange={(e) => set({ rating: Number(e.target.value) })} /></label>
        <label>Difficulty<input type="number" min="1" max="5" value={b.difficultyLevel || ''} onChange={(e) => set({ difficultyLevel: Number(e.target.value) })} /></label>
        <label>Rec score<input type="number" min="0" max="10" value={b.recScore || ''} onChange={(e) => set({ recScore: Number(e.target.value) })} /></label>
        <label>Pages<input type="number" value={b.pages || ''} onChange={(e) => set({ pages: Number(e.target.value) })} /></label>
        <label>Published<input value={b.pubDate || ''} onChange={(e) => set({ pubDate: e.target.value })} /></label>
      </div>
      <label className="lj-editor-notes">Notes<textarea rows={3} value={b.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
      {!isNew && onBind && (
        <div className="lj-bind">
          <label>Linked document
            <select value={currentLink || ''} onChange={(e) => onBind(e.target.value, b.id)}>
              <option value="">— none —</option>
              {docMeta.map((d) => <option key={d.checksum} value={d.checksum}>{d.fileName}</option>)}
            </select>
          </label>
          {suggested && <button className="link-btn" onClick={() => onBind(suggested.checksum, b.id)}>Link “{suggested.fileName}”?</button>}
          <span className="settings-note">Linking auto-marks this book finished when you complete that document.</span>
        </div>
      )}
      <div className="lj-editor-buttons">
        <button className="primary" disabled={!b.title} onClick={() => onSave(b)}>{isNew ? 'Add' : 'Save'}</button>
        <button onClick={onCancel}>Cancel</button>
        {!isNew && onDelete && <button className="lj-danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

// Authors / Genres reference tab — shows the imported reference records with a live count, plus a
// search. Falls back to book-derived genre counts when no reference data was imported.
function RefList({ kind, items, subitems, books }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const nameKey = kind === 'author' ? 'author' : 'genre';
  const derived = useMemo(() => {
    if (items?.length) return null;
    const counts = {};
    for (const b of books) { const k = b[nameKey]; if (k) counts[k] = (counts[k] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ [nameKey]: name, count }));
  }, [items, books, nameKey]);
  const list = (items || derived || []).filter((it) => !q || String(it[nameKey] || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="lj-ref">
      <input className="lj-search" placeholder={`Search ${kind}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="settings-note">{list.length} {kind}{list.length === 1 ? '' : 's'}{!items && ' (derived from your books)'}</p>
      <div className="lj-reflist">
        {list.slice(0, 300).map((it, i) => {
          const name = it[nameKey] || '—';
          return (
            <div key={name + i} className="lj-refitem">
              <button className="lj-refhead" onClick={() => setOpen(open === i ? null : i)}>
                <b>{name}</b>{it.count != null && <em>{it.count} book(s)</em>}{it.lifespan && <em>{it.lifespan}</em>}{it.emerged && <em>{it.emerged}</em>}
              </button>
              {open === i && (
                <div className="lj-refbody">
                  {Object.entries(it).filter(([k, v]) => v && k !== nameKey && typeof v !== 'object').map(([k, v]) => (
                    <div key={k}><b>{k}:</b> {String(v)}</div>
                  ))}
                  {kind === 'genre' && subitems?.length > 0 && (
                    <div className="lj-subgenres">Subgenres: {subitems.filter((s) => s.genre === name).map((s) => s.subgenre).join(', ') || '—'}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Archetype view ───────────────────────────────────────────────────────────────────────────────
const AXIS_SHORT = { fiction: 'Fic', nonfiction: 'NF', literary: 'Lit', genreFiction: 'Genre', ideas: 'Ideas', contemporary: 'New', challenge: 'Hard', volume: 'Vol' };
const ARCHETYPE_COLOR = {
  classicist: '#c9a227', aesthete: '#b5651d', 'genre-devotee': '#3a86ff', storyteller: '#5e60ce',
  autodidact: '#2a9d8f', scholar: '#118ab2', 'deep-diver': '#7209b7', contemporary: '#ef476f',
  voracious: '#f77f00', completionist: '#06d6a0', eclectic: '#8d99ae', explorer: '#90be6d',
};

function Radar({ vector }) {
  const cx = 110, cy = 105, R = 78, N = AXES.length;
  const pt = (i, mag) => { const a = (i / N) * 2 * Math.PI - Math.PI / 2; return [cx + Math.cos(a) * R * mag, cy + Math.sin(a) * R * mag]; };
  return (
    <svg className="lj-radar" viewBox="0 0 220 210">
      {[0.25, 0.5, 0.75, 1].map((g) => <polygon key={g} className="lj-radar-grid" points={AXES.map((_, i) => pt(i, g).join(',')).join(' ')} />)}
      {AXES.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} className="lj-radar-spoke" x1={cx} y1={cy} x2={x} y2={y} />; })}
      <polygon className="lj-radar-area" points={vector.map((v, i) => pt(i, Math.max(0.02, v)).join(',')).join(' ')} />
      {AXES.map((ax, i) => { const [x, y] = pt(i, 1.17); return <text key={ax} className="lj-radar-label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">{AXIS_SHORT[ax]}</text>; })}
    </svg>
  );
}

function ArchetypeView({ books }) {
  const [windowDays, setWindowDays] = useState(365);
  const now = useMemo(() => Date.now(), []);
  const finished = useMemo(() => books.filter((b) => readStatus(b) === 'finished'), [books]);
  const dated = useMemo(() => finished.filter((b) => finishMs(b) != null), [finished]);
  const winBooks = useMemo(() => dated.filter((b) => finishMs(b) > now - windowDays * 864e5), [dated, windowDays, now]);
  const winProfile = useMemo(() => readerProfile(winBooks), [winBooks]);
  const cur = useMemo(() => matchArchetype(winProfile), [winProfile]);
  const allTime = useMemo(() => currentArchetype(finished), [finished]);
  const trend = useMemo(() => archetypeTrend(dated, windowDays, now), [dated, windowDays, now]);
  const present = [...new Set(trend.map((p) => p.archetypeId).filter(Boolean))];
  const winLabel = windowDays >= 365 ? `${(windowDays / 365).toFixed(windowDays % 365 ? 1 : 0)} yr` : `${Math.round(windowDays / 30)} mo`;

  if (finished.length < 3) return <p className="settings-note">Mark at least 3 books finished to reveal your Reader Archetype.</p>;
  return (
    <div className="lj-arch">
      <div className="lj-arch-top">
        <div className="lj-arch-head">
          <div className="rh-section-h">All-time</div>
          {allTime.archetype ? <><b className="lj-arch-name" style={{ color: ARCHETYPE_COLOR[allTime.archetype.id] }}>{allTime.archetype.name}</b><p className="settings-note">{allTime.archetype.blurb}{allTime.secondary ? ` · leaning ${allTime.secondary.name}` : ''}</p></> : <p className="settings-note">Not enough data.</p>}
          <div className="rh-section-h">Now (last {winLabel})</div>
          {cur.archetype ? <b className="lj-arch-name" style={{ color: ARCHETYPE_COLOR[cur.archetype.id] }}>{cur.archetype.name}</b> : <p className="settings-note">Fewer than 3 dated finishes in this window.</p>}
          <p className="settings-note">{winBooks.length} book(s) in window</p>
        </div>
        <Radar vector={winProfile.count ? winProfile.vector : allTime.vector} />
      </div>

      <div className="rh-section-h">How it changed (trailing {winLabel} window)</div>
      <label className="lj-winslider">Window: {winLabel}
        <input type="range" min={30} max={1825} step={30} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} />
      </label>
      {trend.length === 0 ? <p className="settings-note">Add finish dates to your books to reconstruct the timeline.</p> : (
        <>
          <div className="lj-trend">
            {trend.map((p, i) => <span key={i} className="lj-trend-cell" title={`${p.date}: ${p.archetypeName || 'insufficient data'} (${p.count} book${p.count === 1 ? '' : 's'})`} style={{ background: p.archetypeId ? ARCHETYPE_COLOR[p.archetypeId] : 'var(--divider)' }} />)}
          </div>
          <div className="lj-trend-axis"><span>{trend[0].date}</span><span>{trend[trend.length - 1].date}</span></div>
          <div className="lj-legend">{present.map((id) => { const a = READER_ARCHETYPES.find((x) => x.id === id); return <span key={id} className="lj-legend-item"><i style={{ background: ARCHETYPE_COLOR[id] }} />{a?.name}</span>; })}</div>
          {dated.length < finished.length && <p className="settings-note">{finished.length - dated.length} finished book(s) have no date and don’t appear in the timeline.</p>}
        </>
      )}
    </div>
  );
}

// ── Constellation / tech-tree view ───────────────────────────────────────────────────────────────
function genreHue(g) {
  let h = 0; const s = String(g || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 62%)`;
}
const FULL_VIEW = { x: -CONSTELLATION_R - 40, y: -CONSTELLATION_R - 40, w: (CONSTELLATION_R + 40) * 2, h: (CONSTELLATION_R + 40) * 2 };

function ConstellationView({ books, ai }) {
  const [genre, setGenre] = useState('all');
  const [status, setStatus] = useState('all');
  const [view, setView] = useState(FULL_VIEW);
  const [sel, setSel] = useState(null);
  const drag = useRef(null);
  const layout = useMemo(() => constellationLayout(books, ai?.treeMeta), [books, ai]);
  const shown = layout.nodes.filter((n) => (genre === 'all' || n.genre === genre) && (status === 'all' || n.status === status));

  function onDown(e) { drag.current = { x: e.clientX, y: e.clientY, view }; e.currentTarget.setPointerCapture?.(e.pointerId); }
  function onMove(e) {
    if (!drag.current) return;
    const scale = view.w / (e.currentTarget.clientWidth || 1);
    setView({ ...drag.current.view, x: drag.current.view.x - (e.clientX - drag.current.x) * scale, y: drag.current.view.y - (e.clientY - drag.current.y) * scale });
  }
  function onUp() { drag.current = null; }
  function zoom(f) { setView((v) => ({ x: v.x + (v.w - v.w * f) / 2, y: v.y + (v.h - v.h * f) / 2, w: v.w * f, h: v.h * f })); }

  return (
    <div className="lj-constellation">
      <div className="lj-toolbar">
        <select value={genre} onChange={(e) => setGenre(e.target.value)}><option value="all">All genres</option>{layout.genres.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="finished">Finished</option><option value="reading">Reading</option><option value="queue">On deck</option><option value="toread">To read</option><option value="abandoned">Abandoned</option></select>
        <span className="lj-spacer" />
        <button title="Zoom in" onClick={() => zoom(0.8)}>＋</button>
        <button title="Zoom out" onClick={() => zoom(1.25)}>－</button>
        <button onClick={() => setView(FULL_VIEW)}>Reset</button>
      </div>
      <p className="settings-note">{shown.length} of {layout.nodes.length} books · size = rec score · distance from centre = difficulty · brightness = read status{ai?.treeMeta?.edges?.length ? ` · ${ai.treeMeta.edges.length} AI lineage links` : ''}. Drag to pan, scroll to zoom.</p>
      <div className="lj-sky-wrap">
        <svg className="lj-sky" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onWheel={(e) => zoom(e.deltaY > 0 ? 1.1 : 0.9)}>
          {layout.edges.map((e, i) => <line key={i} className="lj-edge" x1={e.ax} y1={e.ay} x2={e.bx} y2={e.by} />)}
          {shown.map((n) => <circle key={n.id} className={`lj-star lj-${n.status}${sel?.id === n.id ? ' sel' : ''}`} cx={n.x} cy={n.y} r={n.r} style={{ fill: genreHue(n.genre) }} onClick={() => setSel(n)} />)}
        </svg>
        {sel && (
          <div className="lj-starcard">
            <button className="close-x" onClick={() => setSel(null)}>×</button>
            <b>{sel.title}</b><br /><em>{sel.author}</em>
            <div className="settings-note">{sel.genre} · difficulty {sel.difficulty || '—'} · rec {sel.recScore || '—'} · {sel.status}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Queue / shortlist view ───────────────────────────────────────────────────────────────────────
// The on-deck list (books shelved 'queue') with time estimates, plus a compact browser to pull books
// out of the vast to-read recommendation pile into the queue. Reshelving is one tap.
function QueueView({ books, onShelve, onOpen }) {
  const [wpm, setWpm] = useState(250);
  const [q, setQ] = useState('');
  const [recBy, setRecBy] = useState('all');
  const queue = useMemo(() => queueWithEstimates(books, wpm), [books, wpm]);
  const recs = useMemo(() => sortBooks(filterBooks(books, { readState: 'toread', search: q, recBy }), 'rec').slice(0, 30), [books, q, recBy]);
  const recOptions = useMemo(() => [...new Set(books.map(recommender))].sort((a, b) => a.localeCompare(b)), [books]);

  return (
    <div className="lj-queue">
      <div className="rh-section-h">On deck ({queue.count})</div>
      <div className="lj-inline">
        <span className="settings-note">≈ {queue.totalHours} h total at</span>
        <input type="number" className="lj-wpm" min="100" max="800" step="10" value={wpm} onChange={(e) => setWpm(Number(e.target.value) || 250)} />
        <span className="settings-note">wpm</span>
      </div>
      {queue.count === 0 ? <p className="settings-note">Nothing queued yet. Pull books from your recommendations below, or tap 📋 on any Library row.</p> : (
        <ol className="lj-queue-list">
          {queue.items.map(({ book: b, hours }, i) => (
            <li key={b.id} className="lj-queue-item">
              <span className="lj-queue-rank">{i + 1}</span>
              <span className="lj-queue-main"><b>{b.title}</b><em>{b.author}{b.genre ? ` · ${b.genre}` : ''}{b.recScore ? ` · ★${b.recScore}` : ''}{recommender(b) !== 'Claude' ? ` · ✦${recommender(b)}` : ''}</em></span>
              <span className="lj-queue-est">{hours != null ? `~${hours} h` : '—'}</span>
              <span className="lj-queue-acts">
                <button onClick={() => onShelve(b, 'reading')}>Start</button>
                <button title="Remove from queue" onClick={() => onShelve(b, 'toread')}>✕</button>
                <button title="Open in Library" onClick={() => onOpen(b.id)}>↗</button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="rh-section-h">Add from recommendations</div>
      <div className="lj-toolbar">
        <input className="lj-search" placeholder="Search to-read…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={recBy} onChange={(e) => setRecBy(e.target.value)}><option value="all">Any recommender</option>{recOptions.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <span className="settings-note">top {recs.length} unread by rec score</span>
      </div>
      <div className="lj-list">
        {recs.map((b) => (
          <div key={b.id} className="lj-row">
            <button className="lj-row-hit" onClick={() => onShelve(b, 'queue')} title="Add to queue">
              <span className="lj-status lj-toread">＋</span>
              <span className="lj-row-main"><b>{b.title}</b><em>{b.author}{recommender(b) !== 'Claude' ? ` · ✦${recommender(b)}` : ''}</em></span>
              <span className="lj-row-meta">{b.genre || ''}{b.difficultyLevel ? ` · D${b.difficultyLevel}` : ''}{b.recScore ? ` · ★${b.recScore}` : ''}{estHours(b, wpm) != null ? ` · ~${estHours(b, wpm)}h` : ''}</span>
            </button>
            <span className="lj-row-acts"><button title="Add to queue" onClick={() => onShelve(b, 'queue')}>📋</button></span>
          </div>
        ))}
        {recs.length === 0 && <p className="settings-note">No matching to-read books.</p>}
      </div>
    </div>
  );
}

// ── Timeline + replay view ───────────────────────────────────────────────────────────────────────
// Past→present: an animated replay that walks chronologically through the finishes (growth curve +
// the book being "read" at each step) plus a month heatmap. Pure geometry over cumulativeFinishes.
function TimelineView({ books }) {
  const cum = useMemo(() => cumulativeFinishes(books), [books]);
  const hm = useMemo(() => finishHeatmap(books), [books]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setIdx(cum.length); setPlaying(false); }, [cum.length]); // default to present
  useEffect(() => {
    if (!playing) return undefined;
    if (idx >= cum.length) { setPlaying(false); return undefined; }
    const t = setInterval(() => setIdx((i) => Math.min(cum.length, i + 1)), 250);
    return () => clearInterval(t);
  }, [playing, idx, cum.length]);

  if (cum.length === 0) return <p className="settings-note">No dated finishes yet — add finish dates to your finished books to build the timeline.</p>;

  const pos = Math.min(cum.length, Math.max(1, idx));
  const shown = cum.slice(0, pos);
  const cur = cum[pos - 1];
  const W = 640, H = 150, pad = 6;
  const t0 = cum[0].t, span = Math.max(1, cum[cum.length - 1].t - t0), maxN = cum[cum.length - 1].n;
  const px = (t) => pad + ((t - t0) / span) * (W - 2 * pad);
  const py = (n) => H - pad - (n / maxN) * (H - 2 * pad);
  const path = shown.map((r, i) => `${i === 0 ? 'M' : 'L'}${px(r.t).toFixed(1)},${py(r.n).toFixed(1)}`).join(' ');
  const play = () => { if (idx >= cum.length) setIdx(0); setPlaying((p) => !p); };
  const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return (
    <div className="lj-timeline">
      <div className="rh-section-h">Reading replay</div>
      <div className="lj-replay-card">
        <div className="lj-replay-now">
          <span className="lj-replay-count">{cur.n}</span>
          <span className="settings-note">books finished by {cur.date}</span>
          <div className="lj-replay-book"><b>{cur.title}</b><em>{cur.author} · {cur.genre}</em></div>
          <div className="settings-note">{(cur.words / 1e6).toFixed(2)}M words · {cur.pages.toLocaleString()} pages cumulatively</div>
        </div>
        <svg className="lj-growth" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path className="lj-growth-line" d={path} />
          <circle className="lj-growth-dot" cx={px(cur.t)} cy={py(cur.n)} r="4" />
        </svg>
      </div>
      <div className="lj-replay-ctl">
        <button onClick={play}>{playing ? '⏸ Pause' : (idx >= cum.length ? '↻ Replay' : '▶ Play')}</button>
        <input type="range" min="1" max={cum.length} value={pos} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
        <span className="settings-note">{pos} / {cum.length}</span>
      </div>

      <div className="rh-section-h">Finishes by month</div>
      <div className="lj-heat">
        <div className="lj-heat-row lj-heat-head"><span className="lj-heat-yr" />{MON.map((m, i) => <span key={i} className="lj-heat-mlabel">{m}</span>)}</div>
        {hm.years.map((y) => (
          <div key={y} className="lj-heat-row">
            <span className="lj-heat-yr">{y}</span>
            {hm.cells[y].map((c, mi) => {
              const lvl = hm.max ? c / hm.max : 0;
              return <span key={mi} className="lj-heat-cell" title={`${y}-${String(mi + 1).padStart(2, '0')}: ${c} finished`} style={{ background: c ? `color-mix(in srgb, var(--toggle-active-bg) ${Math.round(20 + lvl * 80)}%, transparent)` : 'var(--divider)' }} />;
            })}
          </div>
        ))}
      </div>
      <p className="settings-note">{hm.total} dated finishes across {hm.years.length} year{hm.years.length === 1 ? '' : 's'}.</p>
    </div>
  );
}

// ── Analytics view ───────────────────────────────────────────────────────────────────────────────
function AnalyticsView({ books }) {
  const pace = useMemo(() => paceByYear(books), [books]);
  const gt = useMemo(() => genreTrend(books, 6), [books]);
  const rb = useMemo(() => recommenderBreakdown(books), [books]);
  if (pace.length === 0 && rb.length <= 1) return <p className="settings-note">Not much to chart yet — mark some books finished (with dates) and attribute a few recommendations.</p>;
  const maxBooks = Math.max(1, ...pace.map((p) => p.books));
  const maxGT = Math.max(1, ...gt.rows.map((r) => r.total));
  const maxRec = Math.max(1, ...rb.map((r) => r.total));
  return (
    <div className="lj-analytics">
      <div className="rh-section-h">Pace by year</div>
      {pace.length === 0 ? <p className="settings-note">No dated finishes.</p> : (
        <div className="lj-bars">
          {pace.map((p) => (
            <div key={p.year} className="lj-bar" title={`${p.year}: ${p.books} books · ${p.pages.toLocaleString()} pages${p.avgDifficulty ? ` · avg difficulty ${p.avgDifficulty}` : ''}${p.avgRating ? ` · avg ★${p.avgRating}` : ''}`}>
              <span className="lj-bar-fill" style={{ height: `${(p.books / maxBooks) * 100}%` }}><i>{p.books}</i></span>
              <em>{String(p.year).slice(2)}</em>
            </div>
          ))}
        </div>
      )}

      <div className="rh-section-h">Genre mix over time</div>
      {gt.rows.length === 0 ? <p className="settings-note">No dated finishes.</p> : (
        <>
          <div className="lj-stack">
            {gt.rows.map((r) => (
              <div key={r.year} className="lj-stack-col" title={`${r.year}: ${r.total} books`}>
                <div className="lj-stack-bar" style={{ height: `${(r.total / maxGT) * 100}%` }}>
                  {gt.genres.map((g) => (r.counts[g] ? <span key={g} className="lj-stack-seg" style={{ flex: r.counts[g], background: genreHue(g) }} title={`${g}: ${r.counts[g]}`} /> : null))}
                </div>
                <em>{String(r.year).slice(2)}</em>
              </div>
            ))}
          </div>
          <div className="lj-legend">{gt.genres.map((g) => <span key={g} className="lj-legend-item"><i style={{ background: genreHue(g) }} />{g}</span>)}</div>
        </>
      )}

      <div className="rh-section-h">Recommenders</div>
      <div className="lj-recgrid">
        {rb.map((r) => (
          <div key={r.name} className="lj-recrow">
            <span className="lj-rec-name"><b>{r.name}</b> <em>{r.total} book{r.total === 1 ? '' : 's'}</em></span>
            <span className="lj-rec-bar" style={{ width: `${(r.total / maxRec) * 100}%` }}>
              {['finished', 'reading', 'queue', 'toread', 'abandoned'].map((k) => (r[k] ? <i key={k} className={`lj-seg lj-seg-${k}`} style={{ flex: r[k] }} title={`${r[k]} ${k}`} /> : null))}
            </span>
            <span className="lj-rec-rate">{r.finishRate != null ? `${r.finishRate}%` : '—'}</span>
          </div>
        ))}
      </div>
      <p className="settings-note">Bars are sized by pile; segments show finished/reading/on-deck/to-read/abandoned. Finish rate is over resolved (finished + abandoned). Unattributed seed picks count as “Claude”.</p>
    </div>
  );
}

// ── AI / Cowork view ─────────────────────────────────────────────────────────────────────────────
async function writeToDir(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
}
async function readFromDir(dir, name) {
  try { const fh = await dir.getFileHandle(name); return await (await fh.getFile()).text(); } catch { return null; }
}

function AiView({ books, ai, global, onReload }) {
  const instr = getInstruction(ai);
  const [mode, setMode] = useState(instr.mode);
  const [text, setText] = useState(instr.text);
  const [dir, setDir] = useState(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const keyOk = anthropicConfigured(global?.anthropicKey);
  const model = global?.anthropicModel || 'claude-sonnet-5';
  const booksById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);

  useEffect(() => { getFsHandle('journeyCoworkDir').then(setDir).catch(() => {}); }, []);

  async function saveInstruction(m, t) {
    await saveJourneyAi({ ...(ai || {}), instruction: { mode: m, text: t, updatedAt: Date.now() } });
    onReload();
  }
  function onModeChange(m) {
    const t = m === 'heavy' ? (mode === 'heavy' ? text : HEAVY_PLACEHOLDER) : LIGHT_INSTRUCTION;
    setMode(m); setText(t); saveInstruction(m, t);
  }

  // Persist an AI output: apply whitelisted book patches + the ai patch, dedupe via the ledger, and —
  // per the user's design — reset a HEAVY instruction back to light once its result has been applied.
  async function applyOutput(output, sourceText) {
    const hash = contentHash(sourceText || JSON.stringify(output));
    const ledger = ai?.ledger || [];
    if (ledger.includes(hash)) { setMsg('That output was already applied.'); return; }
    const { bookUpdates, aiPatch } = applyAiOutput(output, booksById);
    for (const b of bookUpdates) await saveLibraryBook(b);
    const wasHeavy = getInstruction(ai).mode === 'heavy';
    const nextAi = { ...(ai || {}), ...aiPatch, ledger: [...ledger, hash].slice(-50) };
    if (wasHeavy) nextAi.instruction = { mode: 'light', text: LIGHT_INSTRUCTION, updatedAt: Date.now() };
    await saveJourneyAi(nextAi);
    if (wasHeavy) { setMode('light'); setText(LIGHT_INSTRUCTION); }
    setMsg(`Applied — ${bookUpdates.length} book patch(es)${aiPatch.analysis ? ', analysis' : ''}${aiPatch.recommendations ? ', recommendations' : ''}${aiPatch.treeMeta ? ', tech tree' : ''}.${wasHeavy ? ' Instruction reset to light.' : ''}`);
    onReload();
  }

  async function runApi() {
    setBusy(true); setMsg('Asking Claude…');
    try {
      const dataset = buildDataset(books, { light: true }); // API path is always the compact subset
      const { system, messages } = buildApiMessages(dataset, { mode, text });
      const reply = await askClaude(messages, { key: global.anthropicKey, model, system, maxTokens: 2048 });
      await applyOutput(parseAiOutput(reply), reply);
    } catch (e) { setMsg('API failed: ' + (e?.message || e)); }
    setBusy(false);
  }

  async function chooseFolder() {
    try { const h = await window.showDirectoryPicker({ id: 'tachyread-journey-cowork', mode: 'readwrite' }); await setFsHandle('journeyCoworkDir', h); setDir(h); }
    catch { /* cancelled */ }
  }
  async function writeRequest() {
    if (!dir) return; setBusy(true); setMsg('Writing request…');
    try {
      const dataset = buildDataset(books, { light: mode === 'light' });
      await writeToDir(dir, 'journey-cowork-request.json', JSON.stringify(buildCoworkRequest(dataset, { mode, text }), null, 2));
      await writeToDir(dir, 'journey-instructions.md', buildDigest(dataset, { mode, text }));
      setMsg('Wrote journey-cowork-request.json + journey-instructions.md. Drop the reply as journey-cowork-response.json, then Read response.');
    } catch (e) { setMsg('Write failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function readResponse() {
    if (!dir) return; setBusy(true); setMsg('Reading response…');
    try {
      const t = await readFromDir(dir, 'journey-cowork-response.json');
      if (!t) { setMsg('No journey-cowork-response.json in the folder yet.'); }
      else await applyOutput(parseAiOutput(t), t);
    } catch (e) { setMsg('Read failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function copyDigest() {
    try { await navigator.clipboard.writeText(buildDigest(buildDataset(books, { light: mode === 'light' }), { mode, text })); setMsg('Digest copied — paste it into a Claude chat, then paste the JSON reply below.'); }
    catch { setMsg('Clipboard blocked — use the cowork folder instead.'); }
  }
  async function applyPasted() {
    setBusy(true);
    try { await applyOutput(parseAiOutput(pasted), pasted); setPasted(''); }
    catch (e) { setMsg('Could not parse that reply: ' + (e?.message || e)); }
    setBusy(false);
  }

  return (
    <div className="lj-ai">
      <div className="rh-section-h">Update task</div>
      <div className="lj-inline">
        <label><input type="radio" checked={mode === 'light'} onChange={() => onModeChange('light')} /> Light (default — refresh recs + analysis)</label>
        <label><input type="radio" checked={mode === 'heavy'} onChange={() => onModeChange('heavy')} /> Heavy (custom — e.g. rebuild tech tree)</label>
      </div>
      {mode === 'heavy' ? (
        <>
          <textarea className="lj-instr" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="lj-inline"><button onClick={() => saveInstruction('heavy', text)}>Save instruction</button><span className="settings-note">Resets to Light automatically once a heavy result is applied.</span></div>
        </>
      ) : <p className="settings-note">{LIGHT_INSTRUCTION}</p>}

      <div className="rh-section-h">Direct API (Anthropic key)</div>
      {keyOk ? (
        <div className="lj-inline"><button disabled={busy} onClick={runApi}>Run {mode} update via API ({model})</button>
          {mode === 'heavy' && <span className="settings-note">API sees a compact subset — full tech-tree rebuilds go through the cowork folder.</span>}</div>
      ) : <p className="settings-note">Add an Anthropic API key in <b>Settings → Application Settings</b> to enable this. (The cowork folder below needs no key.)</p>}

      <div className="rh-section-h">Cowork folder</div>
      <div className="lj-inline">
        <button onClick={chooseFolder}>{dir ? `Folder: ${dir.name}` : 'Choose cowork folder…'}</button>
        {dir && <><button disabled={busy} onClick={writeRequest}>Write request</button><button disabled={busy} onClick={readResponse}>Read response</button></>}
      </div>
      <p className="settings-note">Writes the dataset + instruction into a folder a Claude cowork agent watches; it drops <code>journey-cowork-response.json</code> back for you to apply.</p>

      <div className="rh-section-h">Copy / paste</div>
      <div className="lj-inline"><button onClick={copyDigest}>Copy digest to clipboard</button></div>
      <textarea className="lj-instr" rows={3} placeholder="Paste Claude's JSON reply here…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
      <div className="lj-inline"><button disabled={busy || !pasted.trim()} onClick={applyPasted}>Apply pasted output</button></div>

      {msg && <p className="settings-note lj-aimsg">{msg}</p>}
    </div>
  );
}
