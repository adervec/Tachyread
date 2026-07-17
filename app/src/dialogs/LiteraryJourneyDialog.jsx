import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { fmtDateTime } from '../features/dateFmt.js';
import {
  getLibraryBooks, saveLibraryBook, deleteLibraryBook, getLibraryRef, saveLibraryRef,
  getJourneyAi, saveJourneyAi, exportLibraryData, importLibraryData, librarySize, clearLibrary,
  getBinding, setBinding, getSectionBindings, setSectionBinding, allDocMeta, allFiles, getFsHandle, setFsHandle,
  loadFile, loadReadState, loadDocPayload,
  getCrossNotes, saveCrossNote, deleteCrossNote, addCrossNotes,
} from '../state/storage.js';
import { extractTextMeta } from '../features/textMeta.js';
import { createReadingTracker } from '../engine/readingTracker.js';
import { sectionSpan } from '../document/toc.js';
import { askClaude, anthropicConfigured } from '../features/anthropic.js';
import {
  getInstruction, LIGHT_INSTRUCTION, HEAVY_PLACEHOLDER, KNOWLEDGE_GRAPH_INSTRUCTION, CLASSIFY_INSTRUCTION, buildDataset, buildDigest, buildProgress, AI_NOTE_TYPES,
  buildCoworkRequest, buildApiMessages, parseAiOutput, applyAiOutput, contentHash,
} from '../features/journeyAi.js';
import {
  normalizeSeed, filterBooks, sortBooks, libraryStats, exportJourneyMarkdown,
  readStatus, setReadStatus, recommender, STATUS_LABEL,
  distinctValues, pubYear, finishMs, deriveId, bookRating,
  bookTags, allTags, finishCount, logReread, CONTENT_TYPES, contentType,
} from '../features/journeyLibrary.js';
import {
  cumulativeFinishes, finishHeatmap, paceByYear, genreTrend, recommenderBreakdown, queueWithEstimates, estHours,
  yearGoal, seriesProgress, yearInBooks, weeklySummaries,
} from '../features/journeyAnalytics.js';
import { findDuplicates, finishedDateIssues } from '../features/journeyCleanup.js';
import { normTitle } from '../document/tocWizard.js';
import { groupForChecksum, masterOf, makeGroup } from '../features/bookGroups.js';
import { readingTimeSummary, estimateTotalSecs, audiobookSecs, fmtDur, bookWordCount } from '../features/readingTime.js';
import { olFetch, bookCoverUrl } from '../features/openLibrary.js';
import { HistoryView } from './HistoryDialog.jsx';
import AllNotesView from './AllNotesView.jsx';
import ProgressDetailDialog from './ProgressDetailDialog.jsx';
import { getSyncProvider } from '../features/sync/syncProviders.js';
import { syncLibraryWithProvider } from '../features/sync/syncManager.js';
import { AXES, READER_ARCHETYPES, readerProfile, matchArchetype, currentArchetype, archetypeTrend, archetypeAxes } from '../features/readerArchetype.js';
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
const clean = (v) => String(v || '').trim();

// Map the Library editor's status pill back onto the book's completion/inProgress/shelf fields.
const applyStatus = (book, status) => setReadStatus(book, status, todayISO());

function Stat({ v, l, sub }) {
  return <div className="rh-stat"><b className="rh-stat-v">{v}</b><span className="rh-stat-l">{l}</span>{sub && <em className="rh-stat-sub">{sub}</em>}</div>;
}

// Yearly reading-goal card: progress bar with a "today" pace marker, on-track/behind badge, and an
// inline target editor. The goal map is a synced tracker ref, so it follows the library across devices.
function GoalCard({ books, goals, onSetGoal }) {
  const now = useMemo(() => Date.now(), []); // eslint-disable-line react-hooks/purity
  const year = new Date(now).getUTCFullYear();
  const target = Number(goals?.[year]) || 0;
  const g = useMemo(() => yearGoal(books, target, now), [books, target, now]);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const pct = g.target ? Math.min(100, (g.finished / g.target) * 100) : 0;
  return (
    <div className="lj-goal">
      {g.target > 0 ? (
        <>
          <div className="lj-goal-head">
            <b>{g.year} goal</b>
            <span>{g.finished} of {g.target} books</span>
            <span className={`lj-goal-badge ${g.finished >= g.target ? 'won' : g.onTrack ? 'on' : 'off'}`}>
              {g.finished >= g.target ? '🏆 goal hit!' : g.onTrack ? '✓ on track' : '⚠ behind pace'}
            </span>
            <span className="lj-spacer" />
            <button className="link-btn" onClick={() => { setVal(String(g.target)); setEditing(true); }}>edit</button>
          </div>
          <div className="lj-goal-bar" title={`${g.finished}/${g.target} · the tick marks where today sits in the year`}>
            <i style={{ width: `${pct}%` }} />
            <em style={{ left: `${g.yearFrac * 100}%` }} />
          </div>
          <p className="settings-note lj-goal-note">
            {g.finished >= g.target
              ? `Done with ${g.daysLeft} days to spare — raise the bar?`
              : `${g.remaining} to go · need ~${g.needPerMonth ?? '—'}/month · current pace projects ${g.projected ?? '—'} by year-end`}
          </p>
        </>
      ) : (
        <button onClick={() => { setVal('12'); setEditing(true); }}>🎯 Set a {year} reading goal…</button>
      )}
      {editing && (
        <div className="lj-inline">
          <label className="settings-note" style={{ margin: 0 }}>Books in {year}:</label>
          <input className="lj-goal-num" type="number" min="1" max="1000" value={val} onChange={(e) => setVal(e.target.value)} />
          <button className="toggle-on" onClick={() => { onSetGoal(year, Math.max(0, Math.round(Number(val) || 0))); setEditing(false); }}>Set goal</button>
          {g.target > 0 && <button onClick={() => { onSetGoal(year, 0); setEditing(false); }}>Remove</button>}
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export default function LiteraryJourneyDialog({ global, onPatch, initialTab, focusBookId, linkChecksum, linkFileName, onClose }) {
  const [books, setBooks] = useState(null);
  const [refs, setRefs] = useState({ authors: null, genres: null, subgenres: null });
  const [ai, setAi] = useState(null);
  const [size, setSize] = useState(null);
  const [bindMap, setBindMap] = useState(null);
  const [secBind, setSecBind] = useState({}); // { checksum: { bookId: {title,start,end} } } — anthology components
  const [crossNotes, setCrossNotes] = useState([]); // notes spanning multiple books / a series
  const [goals, setGoals] = useState(null); // { [year]: target } — the yearly reading goals
  const [docMeta, setDocMeta] = useState([]);
  const [fileStats, setFileStats] = useState({}); // checksum → { firstRead, activeSecs, words, coverage } for auto-fill
  const [dayAgg, setDayAgg] = useState([]); // [{date, wordsRead, activeSecs}] across all files — weekly summaries
  const [tab, setTab] = useState(initialTab || 'dashboard');
  const [progressFor, setProgressFor] = useState(null); // checksum whose stored progress detail is open
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
  const [flt, setFlt] = useState({ readState: 'all', fnf: 'all', difficulty: [], recMin: 0, genre: 'all', search: '', recBy: 'all', tag: 'all', ctype: 'all' });
  const [sort, setSort] = useState({ key: 'rec', dir: 1 }); // table-header sorting; dir 1 = the key's natural order
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [cleanup, setCleanup] = useState(null); // scan preview: { dups, datable, undatable, contradictory }
  const [cleanMsg, setCleanMsg] = useState('');
  // "This Book in Trackyread" entry points: focus an already-linked book, or run the link flow.
  // linkName mirrors the prop but can also be set by the embedded Files table's "link…" action.
  const [linkCs, setLinkCs] = useState(linkChecksum || null);
  const [linkName, setLinkName] = useState(linkFileName || '');
  useEffect(() => { if (focusBookId) { setTab('library'); setSelected(focusBookId); } }, [focusBookId]);

  async function reload() {
    const [bs, a, g, sg, goalsRec, aiRec, sz, bind, secs, xNotes, docs, files] = await Promise.all([
      getLibraryBooks(), getLibraryRef('authors'), getLibraryRef('genres'), getLibraryRef('subgenres'), getLibraryRef('goals'),
      getJourneyAi(), librarySize(), getBinding(), getSectionBindings(), getCrossNotes(), allDocMeta(), allFiles().catch(() => []),
    ]);
    setCrossNotes(xNotes);
    setBooks(bs); setRefs({ authors: a, genres: g, subgenres: sg }); setAi(aiRec); setSize(sz);
    setGoals(goalsRec || {});
    setBindMap(bind); setSecBind(secs); setDocMeta(docs);
    // Per-document reading facts so a bound book can auto-fill its start date + reading time.
    const stats = {};
    const byDay = new Map(); // date → {date, wordsRead, activeSecs} across all files (weekly summaries)
    for (const f of files) {
      const cs = f.checksum || f.contentChecksum;
      if (!cs) continue;
      const daily = (f.dailyHistory || []).filter((d) => (d.wordsRead || 0) > 0 || (d.activeTimeSecs || 0) > 0).sort((x, y) => (x.date < y.date ? -1 : 1));
      for (const d of daily) {
        const cur = byDay.get(d.date) || { date: d.date, wordsRead: 0, activeSecs: 0 };
        cur.wordsRead += d.wordsRead || 0;
        cur.activeSecs += d.activeTimeSecs || 0;
        byDay.set(d.date, cur);
      }
      stats[cs] = {
        fileName: f.fileName || '',
        firstRead: daily[0]?.date || null,
        lastRead: daily.length ? daily[daily.length - 1].date : null,
        activeSecs: f.persistentActiveTimeSecs || 0,
        words: f.totalWords || 0,
        coverage: f.totalWords ? Math.min(1, (f.persistentWordsRead || 0) / f.totalWords) : 0,
      };
    }
    setFileStats(stats);
    setDayAgg([...byDay.values()]);
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (books && !didInit.current) { didInit.current = true; if (books.length === 0 && !initialTab) setTab('data'); } }, [books, initialTab]);

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

  // Link-flow (from the "This Book in Trackyread" menu item): best library match for the file name.
  const linkSuggestion = useMemo(() => {
    if (!linkCs || !books) return null;
    const tokens = new Set(normTitle(linkName || '').split(' ').filter((w) => w.length > 2));
    if (!tokens.size) return null;
    let best = null, bestScore = 0;
    for (const b of books) {
      const score = normTitle(`${b.title || ''} ${b.author || ''}`).split(' ').filter((w) => tokens.has(w)).length;
      if (score > bestScore) { best = b; bestScore = score; }
    }
    return bestScore >= 1 ? best : null;
  }, [linkCs, books, linkName]);
  async function linkTo(bookId) {
    await bind(linkCs, bookId);
    setSelected(bookId); setLinkCs(null);
  }
  async function linkAsNewBook() {
    const title = String(linkName || 'Untitled').replace(/\.[a-z0-9]+$/i, '');
    const book = { id: deriveId({ title }), title };
    await saveLibraryBook(book);
    await bind(linkCs, book.id);
    setSelected(book.id); setLinkCs(null); await reload();
  }

  const syncResultMsg = (r) => (r.skipped
    ? 'Already in sync — nothing needed to move. ✅'
    : `Synced — ${r.pulled ? 'pulled updates' : 'nothing to pull'}${r.pushed ? ` · pushed ${r.books} books (${Math.round(r.bytes / 1024)} KB)` : ' · nothing to push'}.`);

  async function syncTracker() {
    setSyncBusy(true); setSyncMsg('Syncing tracker…');
    try {
      const r = await syncLibraryWithProvider(sync.provider, sync);
      onPatch?.({ sync: { ...sync, lastLibrarySync: Date.now() } });
      if (!r.skipped) { reconciled.current = false; await reload(); }
      setSyncMsg(syncResultMsg(r));
    } catch (e) { setSyncMsg('Sync failed: ' + (e?.message || e)); }
    setSyncBusy(false);
  }

  // Auto-pull on open: when a live provider connection already exists, run the diff-aware sync
  // silently. Steady-state cost is one stat call — no payload moves unless something changed.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || !providerOk) return;
    autoSynced.current = true;
    (async () => {
      try {
        if (!(await provider.isConnected?.())) return;
        const r = await syncLibraryWithProvider(sync.provider, sync, { silent: true });
        onPatch?.({ sync: { ...sync, lastLibrarySync: Date.now() } });
        if (r.pulled) { reconciled.current = false; await reload(); }
        setSyncMsg(syncResultMsg(r));
      } catch { /* best effort */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerOk]);

  // Best-effort silent sync on close — only when a live connection already exists (no OAuth popup),
  // and diff-aware, so closing an untouched tracker moves nothing.
  async function handleClose() {
    try {
      if (sync.auto && provider && (await provider.isConnected?.())) {
        await syncLibraryWithProvider(sync.provider, sync, { silent: true });
        onPatch?.({ sync: { ...sync, lastLibrarySync: Date.now() } });
      }
    } catch { /* best effort */ }
    onClose?.();
  }

  const stats = useMemo(() => (books ? libraryStats(books) : null), [books]);
  const genreOptions = useMemo(() => (books ? distinctValues(books, 'genre') : []), [books]);
  const recOptions = useMemo(() => (books ? [...new Set(books.map(recommender))].sort((a, b) => a.localeCompare(b)) : []), [books]);
  const tagOptions = useMemo(() => (books ? allTags(books) : []), [books]);
  const showCovers = !!global?.ljCovers; // Library-list cover thumbnails (hotlinks Open Library — opt-in)
  const filtered = useMemo(() => {
    if (!books) return [];
    const base = filterBooks(books, flt);
    const num = (v) => (v == null || v === '' ? -Infinity : Number(v));
    const cmp = {
      rec: (a, b) => num(b.recScore) - num(a.recScore),
      title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
      author: (a, b) => String(a.author || '').localeCompare(String(b.author || '')),
      genre: (a, b) => String(a.genre || '').localeCompare(String(b.genre || '')),
      type: (a, b) => contentType(a).localeCompare(contentType(b)),
      status: (a, b) => readStatus(a).localeCompare(readStatus(b)),
      diff: (a, b) => num(b.difficultyLevel) - num(a.difficultyLevel),
      pages: (a, b) => num(b.pages) - num(a.pages),
      pub: (a, b) => (pubYear(b) ?? -Infinity) - (pubYear(a) ?? -Infinity),
      finished: (a, b) => (finishMs(b) ?? -Infinity) - (finishMs(a) ?? -Infinity),
    }[sort.key] || (() => 0);
    const sorted = [...base].sort(cmp);
    return sort.dir < 0 ? sorted.reverse() : sorted;
  }, [books, flt, sort]);
  const shown = filtered.slice(0, limit);
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const sortMark = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▾' : ' ▴') : '');
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
    if (kind === 'md') { download('trackyread.md', exportJourneyMarkdown(books, { title: 'Trackyread' }), 'text/markdown'); return; }
    const bundle = await exportLibraryData();
    download('tachyread-library.json', JSON.stringify(bundle));
  }

  async function exportView(kind) {
    if (kind === 'md') { download('trackyread-filtered.md', exportJourneyMarkdown(filtered, { title: 'Trackyread (filtered)' }), 'text/markdown'); return; }
    const bundle = await exportLibraryData({ books: filtered, includeDeleted: false, includeBinding: false, includeAi: false });
    download('tachyread-library-filtered.json', JSON.stringify(bundle));
  }

  async function saveBook(patch) { await saveLibraryBook(patch); await reload(); }
  async function setGoalTarget(year, target) {
    const next = { ...(goals || {}) };
    if (target > 0) next[year] = target; else delete next[year];
    await saveLibraryRef('goals', next);
    setGoals(next);
  }
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

  // ── Reconcile / cleanup ──────────────────────────────────────────────────────────────────────
  // Source a finish date for an undated-but-finished book from its LINKED document's last-read day.
  function bookIdToCheckum() {
    const m = {};
    for (const [cs, id] of Object.entries(bindMap || {})) m[id] = cs;
    return m;
  }
  function scanCleanup() {
    const csForBook = bookIdToCheckum();
    const dateFor = (b) => fileStats[csForBook[b.id]]?.lastRead || null;
    const { datable, undatable, contradictory } = finishedDateIssues(books, dateFor);
    const dups = findDuplicates(books);
    setCleanup({ dups, datable, undatable, contradictory });
    const nothing = !dups.length && !datable.length && !undatable.length && !contradictory.length;
    setCleanMsg(nothing ? 'No issues found — the tracker looks consistent. ✅' : '');
  }
  // Safe pass: stamp sourced finish dates, clear contradictory in-progress flags, merge duplicates
  // (repointing any document links from the dropped copy to the keeper). Never un-finishes a book.
  async function applySafeCleanup() {
    if (!cleanup) return;
    let n = 0;
    for (const it of cleanup.datable) { await saveLibraryBook(it.fix); n++; }
    for (const it of cleanup.contradictory) { await saveLibraryBook(it.fix); n++; }
    for (const g of cleanup.dups) {
      await saveLibraryBook(g.merged);
      for (const dropId of g.dropIds) {
        for (const [cs, id] of Object.entries(bindMap || {})) if (id === dropId) await setBinding(cs, g.keepId);
        await deleteLibraryBook(dropId);
      }
      n++;
    }
    setCleanMsg(`Applied ${n} fix${n === 1 ? '' : 'es'}${cleanup.undatable.length ? ` · ${cleanup.undatable.length} undated finish(es) left as-is` : ''}.`);
    setCleanup(null); await reload();
  }
  // Opt-in destructive pass: the finished books no date could be found for are un-finished (→ To read),
  // for when they were mis-flagged. Kept separate so a real off-app read is never silently cleared.
  async function clearUndatedFinishes() {
    if (!cleanup?.undatable.length) return;
    if (!window.confirm(`Un-finish ${cleanup.undatable.length} book(s) that have no finish date and no reading history to date them from? They move to “To read”. (Export first if unsure.)`)) return;
    for (const it of cleanup.undatable) await saveLibraryBook(it.fix);
    setCleanMsg(`Un-finished ${cleanup.undatable.length} undated book(s).`);
    setCleanup(null); await reload();
  }

  const empty = books && books.length === 0;
  const queueCount = useMemo(() => (books ? books.filter((b) => readStatus(b) === 'queue').length : 0), [books]);
  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'library', label: `Library${books ? ` (${books.length})` : ''}` },
    { id: 'queue', label: `Queue${queueCount ? ` (${queueCount})` : ''}` },
    { id: 'series', label: 'Series' },
    { id: 'groups', label: 'Groups' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'rhistory', label: 'Reading History' },
    { id: 'notes', label: 'Notes' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'authors', label: 'Authors' },
    { id: 'genres', label: 'Genres' },
    { id: 'archetype', label: 'Archetype' },
    { id: 'constellation', label: 'Tech Tree' },
    { id: 'ai', label: 'AI / Cowork' },
    { id: 'data', label: 'Import / Export' },
  ];

  return (
    <Dialog title="Trackyread" onClose={handleClose} width={880} buttons={<button onClick={handleClose}>Close</button>}>
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
              <GoalCard books={books} goals={goals} onSetGoal={setGoalTarget} />
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
                  <ul className="lj-recs">{ai.recommendations.slice(0, 8).map((r, i) => {
                    const rec = typeof r === 'string' ? { title: r } : r;
                    const label = `${rec.title || ''}${rec.author ? ' — ' + rec.author : ''}${rec.why ? ' · ' + rec.why : ''}`;
                    // Match the recommendation to a library book by title tokens, so "queue it" reuses
                    // the existing record instead of duplicating it.
                    const tokens = new Set(normTitle(rec.title || '').split(' ').filter(Boolean));
                    const match = tokens.size ? books.find((b) => {
                      const bt = normTitle(b.title || '').split(' ').filter(Boolean);
                      return bt.length > 0 && bt.every((w) => tokens.has(w)) && tokens.size <= bt.length + 1;
                    }) : null;
                    const st = match ? readStatus(match) : null;
                    return (
                      <li key={i}>
                        {label}{' '}
                        {st === 'queue' ? <span className="settings-note" style={{ margin: 0 }}>· on deck 📋</span>
                          : st === 'finished' ? <span className="settings-note" style={{ margin: 0 }}>· finished ✅</span>
                          : (
                            <button className="link-btn" title={match ? 'Add this library book to the queue' : 'Create it as a book and add it to the queue'}
                              onClick={async () => {
                                if (match) { await shelve(match, 'queue'); return; }
                                const book = setReadStatus({ id: deriveId({ title: rec.title, author: rec.author }), title: rec.title, author: rec.author || '', recBy: 'Claude', notes: rec.why || '' }, 'queue');
                                await saveLibraryBook(book); await reload();
                              }}>📋 Queue{match ? '' : ' (new)'}</button>
                          )}
                        {match && st !== 'queue' && <button className="link-btn" onClick={() => { setTab('library'); setSelected(match.id); }}>↗</button>}
                      </li>
                    );
                  })}</ul></>
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
              {linkCs && (
                <div className="lj-linkbar">
                  <span>🔗 Link <b>{linkName}</b> to a tracker book:</span>
                  {linkSuggestion && <button className="toggle-on" onClick={() => linkTo(linkSuggestion.id)}>Link “{linkSuggestion.title}”</button>}
                  <button onClick={linkAsNewBook}>＋ New book from this file</button>
                  <span className="settings-note" style={{ margin: 0 }}>…or open any book below and set its “Linked document”.</span>
                  <button onClick={() => setLinkCs(null)}>Dismiss</button>
                </div>
              )}
              <div className="lj-toolbar">
                <input className="lj-search" placeholder="Search title / author / series…" value={flt.search} onChange={(e) => { setFlt({ ...flt, search: e.target.value }); setLimit(60); }} />
                <select value={flt.readState} onChange={(e) => setFlt({ ...flt, readState: e.target.value })}>
                  <option value="all">All statuses</option><option value="finished">Finished</option><option value="reading">Reading</option><option value="queue">On deck</option><option value="toread">To read</option><option value="abandoned">Abandoned</option>
                </select>
                <select value={flt.fnf} onChange={(e) => setFlt({ ...flt, fnf: e.target.value })}>
                  <option value="all">Fiction + NF</option><option value="F">Fiction</option><option value="NF">Non-fiction</option>
                </select>
                <select value={flt.ctype} onChange={(e) => setFlt({ ...flt, ctype: e.target.value })} title="Content type">
                  <option value="all">All types</option>{Object.entries(CONTENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
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
                {tagOptions.length > 0 && (
                  <select value={flt.tag} onChange={(e) => setFlt({ ...flt, tag: e.target.value })} title="Filter by tag">
                    <option value="all">All tags</option>{tagOptions.map((t) => <option key={t} value={t}>🏷 {t}</option>)}
                  </select>
                )}
                <span className="lj-diffpick">Diff:{[1, 2, 3, 4, 5].map((d) => (
                  <label key={d}><input type="checkbox" checked={flt.difficulty.includes(d)} onChange={(e) => { const s = new Set(flt.difficulty); e.target.checked ? s.add(d) : s.delete(d); setFlt({ ...flt, difficulty: [...s] }); }} />{d}</label>
                ))}</span>
              </div>
              <div className="lj-toolbar2">
                <span className="settings-note">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
                <label className="inline-check" title="Show cover thumbnails in the list — loads them from covers.openlibrary.org for visible books with an ISBN or fetched cover">
                  <input type="checkbox" checked={showCovers} onChange={(e) => onPatch?.({ ljCovers: e.target.checked })} /> Covers
                </label>
                <span className="lj-spacer" />
                <button onClick={() => setAdding(true)}>+ Add book</button>
                <button onClick={() => exportView('json')}>Export view (JSON)</button>
                <button onClick={() => exportView('md')}>Export view (Markdown)</button>
              </div>

              {adding && <BookEditor book={{ id: '', title: '', author: '', genre: '', fnf: 'F', type: 'long' }} isNew onCancel={() => setAdding(false)} onSave={async (b) => { await saveBook({ ...b, id: deriveId(b) }); setAdding(false); }} />}
              {selBook && <BookEditor book={selBook} books={books} docMeta={docMeta} bindMap={bindMap} fileStats={fileStats} groups={global?.bookGroups} crossNotes={crossNotes} onSaveCross={async (n) => { await saveCrossNote(n); setCrossNotes(await getCrossNotes()); }} onDeleteCross={async (id) => { await deleteCrossNote(id); setCrossNotes(await getCrossNotes()); }} onBind={bind} onProgress={setProgressFor} onCancel={() => setSelected(null)} onSave={saveBook} onDelete={() => removeBook(selBook.id)} />}

              <div className="lj-tablewrap">
                <table className="lj-table">
                  <thead>
                    <tr>
                      {[['status', 'St'], ['title', 'Title'], ['author', 'Author'], ['genre', 'Genre'], ['type', 'Type'], ['diff', 'D'], ['rec', '★'], ['pages', 'Pages'], ['pub', 'Pub'], ['finished', 'Finished']].map(([k, l]) => (
                        <th key={k} className={sort.key === k ? 'on' : ''} onClick={() => sortBy(k)} title="Click to sort (click again to flip)">{l}{sortMark(k)}</th>
                      ))}
                      <th aria-label="Shelf actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((b) => {
                      const st = readStatus(b);
                      const rc = finishCount(b);
                      const tgs = bookTags(b);
                      const cov = showCovers ? bookCoverUrl(b, 'S') : null;
                      return (
                        <tr key={b.id} className={selected === b.id ? 'on' : ''} onClick={() => { setSelected(selected === b.id ? null : b.id); setAdding(false); }}>
                          <td><span className={`lj-status lj-${st}`} title={STATUS_LABEL[st]}>{STATUS_LABEL[st].split(' ')[0]}</span></td>
                          <td className="lj-td-title">
                            {showCovers && (cov
                              ? <img className="lj-row-cover" src={cov} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                              : <span className="lj-row-cover lj-row-cover-none" />)}
                            <b>{b.title}</b>
                            {(b.series || rc > 1 || tgs.length > 0 || recommender(b) !== 'Claude') && (
                              <em>{b.series ? `${b.series}${b.seriesNum ? ' #' + b.seriesNum : ''}` : ''}{rc > 1 ? ` ↻×${rc}` : ''}{tgs.length ? ` 🏷${tgs.slice(0, 2).join(', ')}` : ''}{recommender(b) !== 'Claude' ? ` ✦${recommender(b)}` : ''}</em>
                            )}
                          </td>
                          <td>{b.author || ''}</td>
                          <td>{b.genre || ''}</td>
                          <td>{contentType(b) !== 'long' ? (CONTENT_TYPES[contentType(b)] || '') : ''}</td>
                          <td>{b.difficultyLevel || ''}</td>
                          <td>{b.recScore || ''}</td>
                          <td>{b.pages || ''}</td>
                          <td>{pubYear(b) || ''}</td>
                          <td>{finishMs(b) ? new Date(finishMs(b)).toISOString().slice(0, 10) : ''}</td>
                          <td className="lj-row-acts" onClick={(e) => e.stopPropagation()}>
                            <button title="On deck (queue)" className={st === 'queue' ? 'on' : ''} onClick={() => shelve(b, st === 'queue' ? 'toread' : 'queue')}>📋</button>
                            <button title="Reading" className={st === 'reading' ? 'on' : ''} onClick={() => shelve(b, 'reading')}>📖</button>
                            <button title="Finished" className={st === 'finished' ? 'on' : ''} onClick={() => shelve(b, 'finished')}>✅</button>
                            <button title="Abandon" className={st === 'abandoned' ? 'on' : ''} onClick={() => shelve(b, st === 'abandoned' ? 'toread' : 'abandoned')}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length > limit && (
                <div className="lj-inline">
                  <button className="lj-more" onClick={() => setLimit(limit + 200)}>Load more ({filtered.length - limit} left)</button>
                  <button className="lj-more" onClick={() => setLimit(filtered.length)}>Load all {filtered.length}</button>
                </div>
              )}
            </div>
          )}

          {tab === 'queue' && <QueueView books={books} onShelve={shelve} onOpen={(id) => { setTab('library'); setSelected(id); }} />}
          {tab === 'series' && <SeriesView books={books} crossNotes={crossNotes} onDeleteCross={async (id) => { await deleteCrossNote(id); setCrossNotes(await getCrossNotes()); }} onShelve={shelve} onOpen={(id) => { setTab('library'); setSelected(id); }} />}
          {tab === 'groups' && (
            <GroupsView
              books={books} groups={global?.bookGroups || []} bindMap={bindMap || {}} secBind={secBind}
              docMeta={docMeta} fileStats={fileStats}
              onBind={bind} onSecBind={async (cs, id, span) => { await setSectionBinding(cs, id, span); setSecBind(await getSectionBindings()); }}
              onSaveBook={saveBook} onOpen={(id) => { setTab('library'); setSelected(id); }}
              onGroups={(next) => onPatch?.({ bookGroups: next })}
            />
          )}
          {tab === 'timeline' && <TimelineView books={books} />}
          {tab === 'rhistory' && (
            <HistoryView
              onOpenBook={(id) => { setTab('library'); setSelected(id); }}
              onLinkFile={(cs, name) => { setLinkCs(cs); setLinkName(name || ''); setSelected(null); setTab('library'); }}
            />
          )}
          {tab === 'notes' && (
            <AllNotesView
              books={books} crossNotes={crossNotes} fileStats={fileStats}
              onSaveBook={saveBook}
              onReloadCross={async () => setCrossNotes(await getCrossNotes())}
            />
          )}
          {tab === 'analytics' && <AnalyticsView books={books} dayAgg={dayAgg} ai={ai} />}
          {tab === 'authors' && <RefList kind="author" items={refs.authors} books={books} onOpen={(name) => { setFlt({ ...flt, search: name, genre: 'all' }); setLimit(60); setTab('library'); }} />}
          {tab === 'genres' && <RefList kind="genre" items={refs.genres} subitems={refs.subgenres} books={books} onOpen={(name) => { setFlt({ ...flt, genre: name, search: '' }); setLimit(60); setTab('library'); }} />}
          {tab === 'archetype' && <ArchetypeView books={books} />}
          {tab === 'constellation' && <ConstellationView books={books} ai={ai} />}
          {tab === 'ai' && <AiView books={books} ai={ai} global={global} bindMap={bindMap || {}} onBind={bind} onReload={reload} />}

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
                {sync.lastLibrarySync ? <span className="settings-note">Last: {fmtDateTime(sync.lastLibrarySync)}</span> : null}
              </div>
              {syncMsg && <p className="settings-note">{syncMsg}</p>}

              <div className="rh-section-h">Reconcile &amp; clean up</div>
              <p className="settings-note">Find finished books missing a date and duplicate records, then fix them in one pass. Nothing changes until you apply.</p>
              <div className="lj-inline">
                <button onClick={scanCleanup}>Scan for issues</button>
                {cleanMsg && <span className="settings-note">{cleanMsg}</span>}
              </div>
              {cleanup && (
                <div className="lj-cleanup">
                  {cleanup.datable.length > 0 && (
                    <details open><summary><b>{cleanup.datable.length}</b> finished, dated from reading history</summary>
                      <ul className="lj-clean-list">{cleanup.datable.map((it) => <li key={it.id}>{it.title} → <em>{it.date}</em></li>)}</ul>
                    </details>
                  )}
                  {cleanup.contradictory.length > 0 && (
                    <details><summary><b>{cleanup.contradictory.length}</b> marked both finished &amp; reading — clear “reading”</summary>
                      <ul className="lj-clean-list">{cleanup.contradictory.map((it) => <li key={it.id}>{it.title}</li>)}</ul>
                    </details>
                  )}
                  {cleanup.dups.length > 0 && (
                    <details open><summary><b>{cleanup.dups.length}</b> duplicate group(s) — merge into one record</summary>
                      <ul className="lj-clean-list">{cleanup.dups.map((g) => <li key={g.keepId}>{g.titles.join(' + ')} <em>({g.dropIds.length} folded in)</em></li>)}</ul>
                    </details>
                  )}
                  {cleanup.undatable.length > 0 && (
                    <details><summary><b>{cleanup.undatable.length}</b> finished with no date and no reading history</summary>
                      <p className="settings-note">These may be books you read elsewhere (keep them) or mis-flagged. Left untouched by the safe pass.</p>
                      <ul className="lj-clean-list">{cleanup.undatable.map((it) => <li key={it.id}>{it.title}{it.author ? ` — ${it.author}` : ''}</li>)}</ul>
                    </details>
                  )}
                  <div className="lj-inline">
                    <button className="toggle-on" disabled={!cleanup.datable.length && !cleanup.contradictory.length && !cleanup.dups.length} onClick={applySafeCleanup}>Apply safe fixes</button>
                    {cleanup.undatable.length > 0 && <button className="lj-danger" onClick={clearUndatedFinishes}>Un-finish the {cleanup.undatable.length} undated…</button>}
                    <button onClick={() => { setCleanup(null); setCleanMsg(''); }}>Dismiss</button>
                  </div>
                </div>
              )}

              <div className="rh-section-h">Storage</div>
              <p className="settings-note">{size ? `${size.books.toLocaleString()} books · ~${(size.bytes / 1024 / 1024).toFixed(2)} MB on this device.` : ''} The tracker is excluded from the local full backup — it moves via these exports and (once set up) its own cloud file.</p>
              <button className="lj-danger" onClick={wipe}>Delete tracker from this device…</button>
            </div>
          )}
        </>
      )}
      {progressFor && (
        <ProgressDetailDialog storedChecksum={progressFor} onClose={() => setProgressFor(null)} />
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

// Categorized notes the AI attached to this book (cowork/API output). Summaries of a book you
// haven't finished — and section summaries of sections you may not have reached — are SPOILER-
// protected: blurred until clicked. Reveals are per-open, not persisted.
function AiNotesBlock({ book }) {
  const [revealed, setRevealed] = useState(() => new Set());
  const notes = Array.isArray(book.aiNotes) ? book.aiNotes : [];
  if (!notes.length) return null;
  const finished = readStatus(book) === 'finished';
  const byType = {};
  for (const n of notes) (byType[n.type || 'other'] ||= []).push(n);
  return (
    <div className="lj-ainotes">
      <div className="field-section" style={{ marginTop: 8 }}>AI notes ({notes.length})</div>
      {Object.entries(byType).map(([type, list]) => (
        <div key={type} className="lj-ainote-group">
          <div className="lj-ainote-type">{AI_NOTE_TYPES[type] || 'Note'}</div>
          {list.map((n, i) => {
            const key = `${type}:${i}`;
            const spoilery = (type === 'summary' || type === 'section-summary') && !finished;
            const hidden = spoilery && !revealed.has(key);
            return (
              <div key={key} className={`lj-ainote${hidden ? ' lj-spoiler' : ''}`}
                title={hidden ? 'Spoiler-protected — this summarizes something you haven’t finished reading. Click to reveal.' : undefined}
                onClick={hidden ? () => setRevealed((r) => new Set(r).add(key)) : undefined}>
                {n.sectionTitle && <span className="lj-ainote-sec">§ {n.sectionTitle}</span>}
                {hidden ? <span className="lj-spoiler-label">🙈 Spoiler — unfinished {type === 'section-summary' ? 'section' : 'book'}. Click to reveal.</span> : null}
                <div className="lj-ainote-text">{n.text}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Notes spanning MULTIPLE books and/or a whole series — shown on every book they touch, with the
// same spoiler rule as AI notes (summary types blur until every spanned book is finished). The AI
// cowork output can add these too (crossNotes); user-created ones get a book picker + series tick.
function CrossNotesBlock({ book, books, crossNotes, onSaveCross, onDeleteCross }) {
  const [revealed, setRevealed] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [type, setType] = useState('comparison');
  const [span, setSpan] = useState(() => [book.id]);
  const [asSeries, setAsSeries] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { setSpan([book.id]); setAdding(false); setQ(''); setText(''); }, [book.id]);
  const relevant = crossNotes.filter((n) => (n.bookIds || []).includes(book.id) || (n.series && book.series && n.series === book.series));
  const titleOf = (id) => books.find((x) => x.id === id)?.title || id;
  const allSpanFinished = (n) => (n.bookIds || []).every((id) => { const x = books.find((y) => y.id === id); return x && readStatus(x) === 'finished'; });
  const matches = q.trim()
    ? books.filter((x) => !span.includes(x.id) && `${x.title || ''} ${x.author || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];
  async function save() {
    if (!text.trim()) return;
    await onSaveCross?.({ bookIds: span, series: asSeries && book.series ? book.series : null, type, text: text.trim() });
    setAdding(false); setText(''); setSpan([book.id]); setQ('');
  }
  return (
    <div className="lj-ainotes">
      <div className="field-section" style={{ marginTop: 8 }}>Shared notes — multi-book / series{relevant.length ? ` (${relevant.length})` : ''}</div>
      {relevant.map((n) => {
        const spoilery = (n.type === 'summary' || n.type === 'section-summary') && !allSpanFinished(n);
        const hidden = spoilery && !revealed.has(n.id);
        return (
          <div key={n.id} className={`lj-ainote lj-xnote${hidden ? ' lj-spoiler' : ''}`}
            onClick={hidden ? () => setRevealed((r) => new Set(r).add(n.id)) : undefined}>
            <span className="lj-xnote-span">
              {(n.bookIds || []).map((id) => <i key={id} className="lj-xnote-chip">{titleOf(id)}</i>)}
              {n.series && <i className="lj-xnote-chip lj-xnote-series">📚 {n.series}</i>}
              <em className="lj-xnote-type">{AI_NOTE_TYPES[n.type] || 'Note'}{n.source === 'ai' ? ' · AI' : ''}</em>
              <button className="close-x" title="Delete this shared note" onClick={(e) => { e.stopPropagation(); onDeleteCross?.(n.id); }}>×</button>
            </span>
            {hidden ? <span className="lj-spoiler-label">🙈 Spoiler — spans unfinished book(s). Click to reveal.</span> : null}
            <div className="lj-ainote-text">{n.text}</div>
          </div>
        );
      })}
      {!adding ? (
        <button onClick={() => setAdding(true)}>＋ Shared note…</button>
      ) : (
        <div className="lj-xnote-editor">
          <div className="lj-inline">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(AI_NOTE_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {book.series && (
              <label className="inline-check"><input type="checkbox" checked={asSeries} onChange={(e) => setAsSeries(e.target.checked)} /> Attach to series “{book.series}”</label>
            )}
          </div>
          <div className="lj-xnote-span" style={{ margin: '4px 0' }}>
            {span.map((id) => (
              <i key={id} className="lj-xnote-chip">{titleOf(id)}{span.length > 1 && <button className="close-x" onClick={() => setSpan((sp) => sp.filter((x) => x !== id))}>×</button>}</i>
            ))}
            <input placeholder="＋ add another book…" value={q} onChange={(e) => setQ(e.target.value)} />
            {matches.map((x) => <button key={x.id} className="link-btn" onClick={() => { setSpan((sp) => [...sp, x.id]); setQ(''); }}>{x.title}</button>)}
          </div>
          <textarea rows={3} placeholder="A note about these books together…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="lj-inline">
            <button className="toggle-on" disabled={!text.trim()} onClick={save}>Save shared note</button>
            <button onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline add/edit card for one book.
function BookEditor({ book, isNew = false, books = [], docMeta = [], bindMap = {}, fileStats = {}, groups = [], crossNotes = [], onSaveCross, onDeleteCross, onBind, onProgress, onSave, onCancel, onDelete }) {
  const [b, setB] = useState(book);
  useEffect(() => { setB(book); }, [book]);
  const status = readStatus(b);
  const set = (p) => setB({ ...b, ...p });
  // Open Library lookup: explicit click only (sends the title/author or ISBN there). Fills BLANK
  // fields into the form — nothing is saved until the user hits Save.
  const [olBusy, setOlBusy] = useState(false);
  const [olMsg, setOlMsg] = useState('');
  const [txtBusy, setTxtBusy] = useState(false);
  const cover = bookCoverUrl(b);
  async function fetchOl() {
    setOlBusy(true); setOlMsg('');
    try {
      const { doc, patch } = await olFetch(b);
      if (!doc) setOlMsg('No confident match on Open Library.');
      else {
        const got = Object.keys(patch);
        set(patch);
        setOlMsg(got.length ? `Filled: ${got.join(', ')} — review, then Save.` : 'Matched, but every field is already filled.');
      }
    } catch (e) { setOlMsg('Lookup failed: ' + (e?.message || e)); }
    setOlBusy(false);
  }
  const currentLink = !isNew && Object.entries(bindMap || {}).find(([, id]) => id === b.id)?.[0];
  // Fill blanks from the LINKED DOCUMENT itself: exact word count (→ pages estimate) from the file
  // record, and author / publish year / ISBN / title scraped from the text's front matter.
  async function pullFromText() {
    setTxtBusy(true); setOlMsg('');
    try {
      const payload = await loadDocPayload(currentLink).catch(() => null);
      const meta = extractTextMeta((payload?.fullText || '').slice(0, 9000));
      const words = fileStats[currentLink]?.words || 0;
      const p = {};
      if (!b.words && words) p.words = words;
      if (!b.pages && words) p.pages = Math.round(words / 275);
      if (!clean(b.author) && meta.author) p.author = meta.author;
      if (!clean(b.pubDate) && meta.year) p.pubDate = String(meta.year);
      if (!clean(b.isbn) && meta.isbn) p.isbn = meta.isbn;
      if (!clean(b.title) && meta.title) p.title = meta.title;
      const got = Object.keys(p);
      set(p);
      if (got.length) setOlMsg(`From the document: ${got.join(', ')} — review, then Save.`);
      else if (!payload?.fullText && !words) setOlMsg('The linked file’s text isn’t stored on this device — open it once, then retry.');
      else setOlMsg('Nothing new found in the document’s front matter.');
    } catch (e) { setOlMsg('Text scan failed: ' + (e?.message || e)); }
    setTxtBusy(false);
  }
  const linkedGroup = currentLink ? groupForChecksum(groups, currentLink) : null;
  const suggested = !isNew && !currentLink ? suggestDoc(b, docMeta) : null;
  // Reading facts from the linked document, for the "auto" fills below.
  const docStats = currentLink ? fileStats[currentLink] : null;
  const finishISO = finishMs(b) ? new Date(finishMs(b)).toISOString().slice(0, 10) : null;
  const eyeFrac = (Number(b.audiobookEyePct) || 0) / 100;
  const abSecs = b.audiobookFinish ? audiobookSecs(bookWordCount(b), eyeFrac) : 0;
  const totalSecs = estimateTotalSecs({ readSecs: b.readSecs, words: bookWordCount(b), audiobookFinish: b.audiobookFinish, eyeFrac });
  return (
    <div className="lj-editor">
      {cover && <img className="lj-cover" src={cover} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />}
      <div className="lj-editor-grid">
        <label>Title<input value={b.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Author<input value={b.author || ''} onChange={(e) => set({ author: e.target.value })} /></label>
        <label>Genre<input value={b.genre || ''} onChange={(e) => set({ genre: e.target.value })} /></label>
        <label>Subgenre<input value={b.subgenre || ''} onChange={(e) => set({ subgenre: e.target.value })} /></label>
        <label>Fiction?<select value={b.fnf || ''} onChange={(e) => set({ fnf: e.target.value })}><option value="F">Fiction</option><option value="NF">Non-fiction</option></select></label>
        <label>Content type<select value={contentType(b)} onChange={(e) => set({ type: e.target.value })}>{Object.entries(CONTENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Status<select value={status} onChange={(e) => setB(applyStatus(b, e.target.value))}><option value="toread">To read</option><option value="queue">On deck</option><option value="reading">Reading</option><option value="finished">Finished</option><option value="abandoned">Abandoned</option></select></label>
        <label>Finished<input type="date" value={(finishMs(b) ? new Date(finishMs(b)).toISOString().slice(0, 10) : '')} onChange={(e) => set({ finishTime: e.target.value })} /></label>
        <label>Rec. by<input value={b.recBy || ''} placeholder="Claude" onChange={(e) => set({ recBy: e.target.value })} /></label>
        <label>Rating<input type="number" min="0" max="5" value={bookRating(b) || ''} onChange={(e) => set({ rating: Number(e.target.value) })} /></label>
        <label>Difficulty<input type="number" min="1" max="5" value={b.difficultyLevel || ''} onChange={(e) => set({ difficultyLevel: Number(e.target.value) })} /></label>
        <label>Rec score<input type="number" min="0" max="10" value={b.recScore || ''} onChange={(e) => set({ recScore: Number(e.target.value) })} /></label>
        <label>Pages<input type="number" value={b.pages || ''} onChange={(e) => set({ pages: Number(e.target.value) })} /></label>
        <label>Words<input type="number" value={b.words || ''} placeholder={b.pages ? `~${bookWordCount({ pages: b.pages })}` : ''} onChange={(e) => set({ words: Number(e.target.value) })} /></label>
        <label>Published<input value={b.pubDate || ''} onChange={(e) => set({ pubDate: e.target.value })} /></label>
        <label>ISBN<input value={b.isbn || ''} onChange={(e) => set({ isbn: e.target.value })} /></label>
        <label>Tags<input value={Array.isArray(b.tags) ? b.tags.join(', ') : (b.tags || '')} placeholder="comma, separated" onChange={(e) => set({ tags: e.target.value })} /></label>
      </div>
      <div className="lj-inline">
        <button type="button" disabled={olBusy || (!b.title && !b.isbn)} onClick={fetchOl}
          title="Search Open Library by ISBN (or title + author) and fill the blank fields — sends that query to openlibrary.org">
          {olBusy ? 'Searching…' : '🔎 Fetch details (Open Library)'}
        </button>
        {currentLink && (
          <button type="button" disabled={txtBusy} onClick={pullFromText}
            title="Fill blank fields from the linked document itself: exact word count (and a pages estimate), plus author / publish year / ISBN scraped from its front matter. Nothing leaves the device.">
            {txtBusy ? 'Scanning…' : '📄 Fill from linked document'}
          </button>
        )}
        {status === 'finished' && (
          <button type="button" title="Finished it again? The current finish date moves into history and today becomes the finish" onClick={() => setB(logReread(b, todayISO()))}>↻ Log re-read</button>
        )}
        {finishCount(b) > 1 && <span className="settings-note" style={{ margin: 0 }}>Read ×{finishCount(b)} · previously {b.finishHistory.join(', ')}</span>}
        {olMsg && <span className="settings-note" style={{ margin: 0 }}>{olMsg}</span>}
      </div>
      <div className="lj-readtime">
        <div className="field-section" style={{ marginTop: 0 }}>Reading time</div>
        <div className="lj-editor-grid">
          <label>Started
            <span className="lj-inline">
              <input type="date" value={b.startTime || ''} onChange={(e) => set({ startTime: e.target.value })} />
              {docStats?.firstRead && b.startTime !== docStats.firstRead && <button type="button" className="link-btn" title="Use the first date you read the linked document" onClick={() => set({ startTime: docStats.firstRead })}>auto</button>}
            </span>
          </label>
          <label>Time reading (min)
            <span className="lj-inline">
              <input type="number" min="0" value={b.readSecs ? Math.round(b.readSecs / 60) : ''} onChange={(e) => set({ readSecs: Math.max(0, Number(e.target.value) || 0) * 60 })} />
              {docStats?.activeSecs > 0 && b.readSecs !== docStats.activeSecs && <button type="button" className="link-btn" title="Use the active reading time recorded for the linked document" onClick={() => set({ readSecs: docStats.activeSecs })}>auto</button>}
            </span>
          </label>
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={!!b.audiobookFinish} onChange={(e) => set({ audiobookFinish: e.target.checked, audiobookEyePct: e.target.checked ? (b.audiobookEyePct ?? Math.round((docStats?.coverage || 0) * 100)) : b.audiobookEyePct })} />
          Finished the rest by audiobook
        </label>
        {b.audiobookFinish && (
          <label className="lj-ab-pct">Read by eye first (%)
            <input type="number" min="0" max="100" value={b.audiobookEyePct ?? ''} onChange={(e) => set({ audiobookEyePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
            <span className="settings-note" style={{ margin: 0 }}>
              {bookWordCount(b) ? `~${fmtDur(abSecs)} of audiobook at 1× · estimated total ~${fmtDur(totalSecs)}` : 'Add a word or page count to estimate the audiobook time.'}
            </span>
          </label>
        )}
        <p className="settings-note" style={{ margin: '2px 0 0' }}>{readingTimeSummary(b, finishISO)}</p>
      </div>

      <label className="lj-editor-notes">Notes<textarea rows={3} value={b.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
      <AiNotesBlock book={b} />
      {!isNew && <CrossNotesBlock book={b} books={books} crossNotes={crossNotes} onSaveCross={onSaveCross} onDeleteCross={onDeleteCross} />}
      {!isNew && onBind && (
        <div className="lj-bind">
          <label>Linked document
            <select value={currentLink || ''} onChange={(e) => onBind(e.target.value, b.id)}>
              <option value="">— none —</option>
              {docMeta.map((d) => <option key={d.checksum} value={d.checksum}>{d.fileName}</option>)}
            </select>
          </label>
          {suggested && <button className="link-btn" onClick={() => onBind(suggested.checksum, b.id)}>Link “{suggested.fileName}”?</button>}
          {currentLink && onProgress && <button className="link-btn" title="Reading progress detail for the linked document — works even when the file isn't on this device (uses the synced reading state)" onClick={() => onProgress(currentLink)}>📈 Progress</button>}
          {linkedGroup && <span className="settings-note">📚 Also in book group <b>{linkedGroup.name}</b> (Settings → Book Groups).</span>}
          <span className="settings-note">Linking auto-marks this book finished when you complete that document.</span>
        </div>
      )}
      <div className="lj-editor-buttons">
        <button className="primary" disabled={!b.title} onClick={() => onSave({ ...b, tags: bookTags(b) })}>{isNew ? 'Add' : 'Save'}</button>
        <button onClick={onCancel}>Cancel</button>
        {!isNew && onDelete && <button className="lj-danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

// Authors / Genres reference tab — shows the imported reference records with a live count, plus a
// search. Falls back to book-derived genre counts when no reference data was imported.
function RefList({ kind, items, subitems, books, onOpen }) {
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
              {(() => {
                const mine = books.filter((b) => (b[nameKey] || '') === name);
                const fin = mine.filter((b) => readStatus(b) === 'finished').length;
                const pct = mine.length ? (fin / mine.length) * 100 : 0;
                return (
                  <button className="lj-refhead" onClick={() => setOpen(open === i ? null : i)}>
                    <b>{name}</b>{(it.count != null || mine.length > 0) && <em>{fin}/{mine.length || it.count} finished</em>}{it.lifespan && <em>{it.lifespan}</em>}{it.emerged && <em>{it.emerged}</em>}
                    <span className="lj-series-bar lj-ref-bar" title={`${fin} of ${mine.length} finished`}><i style={{ width: `${pct}%` }} /></span>
                    <span className="lj-ref-jump" role="link" title={`Show ${name} in the Library`} onClick={(e) => { e.stopPropagation(); onOpen?.(name); }}>↗</span>
                  </button>
                );
              })()}
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
const AXIS_SHORT = { fiction: 'Fic', nonfiction: 'NF', literary: 'Lit', genreFiction: 'Genre', ideas: 'Ideas', contemporary: 'New', challenge: 'Hard', volume: 'Vol', speculative: 'SFF', factual: 'Fact', poetic: 'Poet', series: 'Ser' };
const ARCHETYPE_COLOR = {
  classicist: '#c9a227', aesthete: '#b5651d', poet: '#d264a5', 'genre-devotee': '#3a86ff', worldbuilder: '#4361ee',
  'series-binger': '#00b4d8', storyteller: '#5e60ce', autodidact: '#2a9d8f', historian: '#8a5a44', scholar: '#118ab2',
  'deep-diver': '#7209b7', contemporary: '#ef476f', voracious: '#f77f00', completionist: '#06d6a0',
  eclectic: '#8d99ae', explorer: '#90be6d',
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

      <ArchetypeLegend currentId={cur.archetype?.id || allTime.archetype?.id} />
    </div>
  );
}

// What each archetype actually means — its blurb plus the axes that define it. Collapsed by default;
// the reader's current archetype is highlighted so they can see why they got it.
function ArchetypeLegend({ currentId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lj-arch-legend">
      <button className="lj-arch-legend-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} What the archetypes mean ({READER_ARCHETYPES.length})
      </button>
      {open && (
        <div className="lj-arch-legend-list">
          {READER_ARCHETYPES.map((a) => (
            <div key={a.id} className={`lj-arch-legend-row${a.id === currentId ? ' current' : ''}`}>
              <span className="lj-arch-legend-dot" style={{ background: ARCHETYPE_COLOR[a.id] }} />
              <div className="lj-arch-legend-body">
                <b style={{ color: ARCHETYPE_COLOR[a.id] }}>{a.name}{a.id === currentId ? ' — you' : ''}</b>
                <span className="settings-note">{a.blurb}</span>
                <span className="lj-arch-legend-axes">
                  {archetypeAxes(a, 4).map((x) => <span key={x.ax} className="lj-arch-legend-axis">{x.label}</span>)}
                </span>
              </div>
            </div>
          ))}
        </div>
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

// Typed relatedness links — a real knowledge graph. Colours + labels per relationship kind; the AI
// heavy "knowledge graph" task returns treeMeta.edges as [idA, idB, kind]. Unknown kinds fall back to
// a neutral "related".
const EDGE_KINDS = {
  influence: { color: '#c9a227', label: 'influence' },
  prereq: { color: '#3a86ff', label: 'prerequisite' },
  series: { color: '#06d6a0', label: 'series' },
  'same-author': { color: '#b5651d', label: 'same author' },
  theme: { color: '#7209b7', label: 'shared theme' },
  contrast: { color: '#ef476f', label: 'contrast / rebuttal' },
  responds: { color: '#2a9d8f', label: 'responds to' },
  similarity: { color: '#4cc9f0', label: 'similar work' },
  opposed: { color: '#d00000', label: 'opposed pair' },
  'same-universe': { color: '#ffb703', label: 'same universe' },
  link: { color: '#8d99ae', label: 'related' },
};
const edgeColor = (k) => (EDGE_KINDS[k] || EDGE_KINDS.link).color;
const BOOK_LINKS = [['isbnUrl', 'Find'], ['goodreadsUrl', 'Goodreads'], ['wikipediaUrl', 'Wikipedia'], ['platformUrl', 'Read']];

// The tree view remembers itself between opens (pan/zoom + every filter) — device-local view state.
const TREE_VIEW_KEY = 'tachyread-tree-view';
function loadTreeView() {
  try { return JSON.parse(localStorage.getItem(TREE_VIEW_KEY)) || {}; } catch { return {}; }
}

function ConstellationView({ books, ai }) {
  const saved = useMemo(() => loadTreeView(), []);
  const [genre, setGenre] = useState(saved.genre || 'all');
  const [status, setStatus] = useState(saved.status || 'all');
  const [search, setSearch] = useState('');
  const [labels, setLabels] = useState(saved.labels !== false); // quick toggle: star labels
  const [hideUntouched, setHideUntouched] = useState(!!saved.hideUntouched); // hide the to-read recommends
  const [kindOff, setKindOff] = useState(() => new Set(saved.kindOff || [])); // edge kinds toggled off
  const [view, setView] = useState(saved.view && saved.view.w ? saved.view : FULL_VIEW);
  const [openIds, setOpenIds] = useState([]); // several detail cards can be open at once
  const [chooser, setChooser] = useState(null); // { nodes } — click hit several stacked stars
  const drag = useRef(null);
  const movedRef = useRef(false); // distinguishes a pan from a click (a pan must NOT select a star)
  const layout = useMemo(() => constellationLayout(books, ai?.treeMeta), [books, ai]);
  const booksById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
  const nodeById = useMemo(() => Object.fromEntries(layout.nodes.map((n) => [n.id, n])), [layout]);
  const q = search.trim().toLowerCase();
  const shown = layout.nodes.filter((n) => (genre === 'all' || n.genre === genre)
    && (status === 'all' || n.status === status)
    && (!hideUntouched || n.status !== 'toread')
    && (!q || `${n.title || ''} ${n.author || ''}`.toLowerCase().includes(q)));
  const shownIds = new Set(shown.map((n) => n.id));
  const edgeKinds = useMemo(() => [...new Set(layout.edges.map((e) => e.kind))], [layout]);
  // Edges follow the node filter (both ends visible) and the per-kind toggles.
  const shownEdges = layout.edges.filter((e) => !kindOff.has(e.kind) && shownIds.has(e.a) && shownIds.has(e.b));

  // Persist the whole view state (pan/zoom + filters) so the tree reopens where you left it.
  useEffect(() => {
    try { localStorage.setItem(TREE_VIEW_KEY, JSON.stringify({ view, genre, status, labels, hideUntouched, kindOff: [...kindOff] })); } catch { /* full/blocked */ }
  }, [view, genre, status, labels, hideUntouched, kindOff]);

  // Auto-zoom to the filtered stars: when a filter narrows the set, fit the viewport to their
  // bounding box (debounced for the search box). Clearing filters leaves your view alone.
  const fitKey = `${genre}|${status}|${hideUntouched}|${q}`;
  const lastFit = useRef(fitKey); // seeded with the restored filters so mount doesn't refit
  useEffect(() => {
    if (lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    if (!shown.length || shown.length === layout.nodes.length) return;
    const t = setTimeout(() => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of shown) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      const pad = 70;
      const size = Math.max(180, maxX - minX + pad * 2, maxY - minY + pad * 2);
      const v = { x: (minX + maxX) / 2 - size / 2, y: (minY + maxY) / 2 - size / 2, w: size, h: size };
      applyView(v); setView(v);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Labels come in as you zoom: titles once you're past ~1.5×, authors too when deep in.
  const showTitles = labels && view.w < CONSTELLATION_R * 1.3;
  const showAuthors = view.w < CONSTELLATION_R * 0.6;
  const labelSize = view.w / 46; // in viewBox units → roughly constant on screen across zoom levels

  const openSet = new Set(openIds);
  const openNodes = openIds.map((id) => nodeById[id]).filter(Boolean);
  const neighborsOf = (id) => layout.edges.filter((e) => e.a === id || e.b === id)
    .map((e) => ({ node: nodeById[e.a === id ? e.b : e.a], kind: e.kind })).filter((x) => x.node);

  function openCard(node) { setChooser(null); setOpenIds((ids) => (ids.includes(node.id) ? ids : [...ids, node.id])); }
  function closeCard(id) { setOpenIds((ids) => ids.filter((x) => x !== id)); }
  // A click "hits" every shown star within a small (zoom-scaled) radius — so tightly stacked stars
  // resolve to a chooser instead of whichever circle happened to be on top.
  function starClick(node) {
    if (movedRef.current) return;
    const thresh = view.w * 0.02;
    const stack = shown.filter((m) => Math.hypot(m.x - node.x, m.y - node.y) <= thresh + Math.max(m.r, node.r));
    if (stack.length > 1) setChooser({ nodes: stack });
    else openCard(node);
  }

  // No pointer capture on purpose: capturing the SVG would retarget the click off the star and break
  // click-to-select (the SVG fills the area and onPointerLeave ends a stray drag). `movedRef` tells a
  // click from a pan so panning onto a star doesn't open its card.
  // PERFORMANCE: pans/zooms write the viewBox attribute directly (no React re-render of thousands of
  // stars per pointermove); the view STATE commits once, when the gesture ends.
  const svgRef = useRef(null);
  const liveView = useRef(view);
  liveView.current = drag.current ? liveView.current : view;
  const applyView = (v) => { liveView.current = v; svgRef.current?.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); };
  const wheelCommit = useRef(0);
  function onDown(e) { drag.current = { x: e.clientX, y: e.clientY, view: liveView.current }; movedRef.current = false; }
  function onMove(e) {
    if (!drag.current) return;
    movedRef.current = true;
    const scale = drag.current.view.w / (e.currentTarget.clientWidth || 1);
    applyView({ ...drag.current.view, x: drag.current.view.x - (e.clientX - drag.current.x) * scale, y: drag.current.view.y - (e.clientY - drag.current.y) * scale });
  }
  function onUp() { if (drag.current) { drag.current = null; setView(liveView.current); } }
  function zoom(f) {
    const v = liveView.current;
    applyView({ x: v.x + (v.w - v.w * f) / 2, y: v.y + (v.h - v.h * f) / 2, w: v.w * f, h: v.h * f });
    clearTimeout(wheelCommit.current);
    wheelCommit.current = setTimeout(() => setView(liveView.current), 160); // one re-render per burst
  }

  return (
    <div className="lj-constellation">
      <div className="lj-toolbar">
        <select value={genre} onChange={(e) => setGenre(e.target.value)}><option value="all">All genres</option>{layout.genres.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="finished">Finished</option><option value="reading">Reading</option><option value="queue">On deck</option><option value="toread">To read</option><option value="abandoned">Abandoned</option></select>
        <input className="lj-tree-search" placeholder="Search title / author…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className={labels ? 'toggle-on' : ''} title="Show star labels (titles appear as you zoom in)" onClick={() => setLabels((v) => !v)}>🏷 Labels</button>
        <button className={hideUntouched ? 'toggle-on' : ''} title="Hide everything you haven't touched yet — all the to-read recommendations" onClick={() => setHideUntouched((v) => !v)}>👣 Touched only</button>
        <span className="lj-spacer" />
        <button title="Zoom in" onClick={() => zoom(0.8)}>＋</button>
        <button title="Zoom out" onClick={() => zoom(1.25)}>－</button>
        <button onClick={() => { applyView(FULL_VIEW); setView(FULL_VIEW); }}>Reset</button>
      </div>
      <p className="settings-note">{shown.length} of {layout.nodes.length} books · size = rec score · distance from centre = difficulty · brightness = read status{layout.edges.length ? ` · ${layout.edges.length} knowledge-graph links` : ' · no links yet (build the knowledge graph from AI / Cowork)'}. Drag to pan, scroll to zoom, click a star for details (open several; tightly stacked stars show a chooser).</p>
      <div className="lj-sky-wrap">
        <svg ref={svgRef} className="lj-sky" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onWheel={(e) => zoom(e.deltaY > 0 ? 1.1 : 0.9)}>
          {shownEdges.map((e, i) => {
            const on = openSet.has(e.a) || openSet.has(e.b);
            return <line key={i} className={`lj-edge${on ? ' lj-edge-on' : ''}`} x1={e.ax} y1={e.ay} x2={e.bx} y2={e.by} stroke={edgeColor(e.kind)} strokeWidth={(on ? 2.2 : 1) * (view.w / FULL_VIEW.w)} opacity={openIds.length ? (on ? 0.95 : 0.15) : 0.5} />;
          })}
          {shown.map((n) => <circle key={n.id} data-id={n.id} className={`lj-star lj-${n.status}${openSet.has(n.id) ? ' sel' : ''}`} cx={n.x} cy={n.y} r={n.r} style={{ fill: genreHue(n.genre) }} onClick={() => starClick(n)} />)}
          {showTitles && shown.map((n) => (
            <text key={`t-${n.id}`} className="lj-star-label" x={n.x + n.r + labelSize * 0.35} y={n.y + labelSize * 0.34} fontSize={labelSize}>
              {n.title}{showAuthors && n.author ? ` · ${n.author}` : ''}
            </text>
          ))}
        </svg>
        {edgeKinds.length > 0 && (
          <div className="lj-edge-legend" title="Click a connection type to hide/show those links">{edgeKinds.map((k) => (
            <button key={k} className={`lj-legend-item lj-legend-btn${kindOff.has(k) ? ' off' : ''}`}
              onClick={() => setKindOff((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
              <i style={{ background: edgeColor(k) }} />{(EDGE_KINDS[k] || EDGE_KINDS.link).label}
            </button>
          ))}</div>
        )}
        {chooser && (
          <div className="lj-chooser">
            <div className="lj-chooser-head"><span>{chooser.nodes.length} stars here</span><button className="close-x" onClick={() => setChooser(null)}>×</button></div>
            {chooser.nodes.map((n) => (
              <button key={n.id} className="lj-chooser-item" onClick={() => openCard(n)}>
                <i className="lj-chooser-dot" style={{ background: genreHue(n.genre) }} />
                <span className="lj-chooser-title">{n.title}</span>
                <em>{n.author}{n.genre ? ` · ${n.genre}` : ''}</em>
              </button>
            ))}
          </div>
        )}
        {openNodes.length > 0 && (
          <div className="lj-starcards">
            {openNodes.map((node) => {
              const b = booksById[node.id];
              const nbrs = neighborsOf(node.id);
              const facts = b ? [
                b.pages ? `${b.pages} pp` : (b.words ? `${Math.round(b.words / 1000)}k words` : ''),
                pubYear(b) || '',
                b.fnf === 'NF' ? 'nonfiction' : (b.fnf === 'F' ? 'fiction' : ''),
                b.finishTime ? `read ${String(b.finishTime).slice(0, 4)}` : '',
                recommender(b) !== 'Claude' ? `✦ ${recommender(b)}` : '',
              ].filter(Boolean) : [];
              return (
                <div key={node.id} className="lj-starcard">
                  <button className="close-x" onClick={() => closeCard(node.id)}>×</button>
                  <b>{node.title}</b><br /><em>{node.author}</em>
                  <div className="settings-note">
                    {node.genre}{b?.subgenre ? ` › ${b.subgenre}` : ''}{b?.series ? ` · ${b.series}${b.seriesNum ? ' #' + b.seriesNum : ''}` : ''}
                    {' · '}difficulty {node.difficulty || '—'} · rec {node.recScore || '—'} · {STATUS_LABEL[node.status] || node.status}
                    {b?.rating ? ` · ${'★'.repeat(b.rating)}` : ''}
                  </div>
                  {facts.length > 0 && <div className="settings-note">{facts.join(' · ')}</div>}
                  {b?.description && <div className="lj-starcard-desc">{b.description}</div>}
                  {b?.notes && <div className="lj-starcard-notes">📝 {b.notes}</div>}
                  {b && (
                    <div className="lj-starcard-links">
                      {BOOK_LINKS.map(([k, label]) => b[k] ? <a key={k} href={b[k]} target="_blank" rel="noreferrer">{label}</a> : null)}
                    </div>
                  )}
                  {nbrs.length > 0 && (
                    <div className="lj-starcard-neighbors">
                      <div className="rh-section-h" style={{ marginTop: 6 }}>Connected ({nbrs.length})</div>
                      {nbrs.slice(0, 10).map(({ node: nb, kind }, i) => (
                        <button key={i} className="lj-neighbor" onClick={() => openCard(nb)}>
                          <i style={{ background: edgeColor(kind) }} /> <span>{nb.title}</span> <em>{(EDGE_KINDS[kind] || EDGE_KINDS.link).label}</em>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
  const [cat, setCat] = useState('all'); // separate queue per content category
  // Category pills with live counts — every content type that has anything on deck.
  const queuedAll = useMemo(() => books.filter((b) => readStatus(b) === 'queue'), [books]);
  const catCounts = useMemo(() => {
    const c = {};
    for (const b of queuedAll) c[contentType(b)] = (c[contentType(b)] || 0) + 1;
    return c;
  }, [queuedAll]);
  const catBooks = useMemo(() => (cat === 'all' ? books : books.filter((b) => contentType(b) === cat)), [books, cat]);
  const queue = useMemo(() => queueWithEstimates(catBooks, wpm), [catBooks, wpm]);
  const recs = useMemo(() => sortBooks(filterBooks(books, { readState: 'toread', search: q, recBy, ctype: cat }), 'rec').slice(0, 30), [books, q, recBy, cat]);
  const recOptions = useMemo(() => [...new Set(books.map(recommender))].sort((a, b) => a.localeCompare(b)), [books]);

  return (
    <div className="lj-queue">
      <div className="lj-queue-cats">
        <button className={`lj-qcat${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>All ({queuedAll.length})</button>
        {Object.entries(CONTENT_TYPES).map(([k, label]) => (
          <button key={k} className={`lj-qcat${cat === k ? ' on' : ''}`} onClick={() => setCat(k)}>{label} ({catCounts[k] || 0})</button>
        ))}
      </div>
      <div className="rh-section-h">On deck — {cat === 'all' ? 'everything' : CONTENT_TYPES[cat]} ({queue.count})</div>
      <div className="lj-inline">
        <span className="settings-note">≈ {queue.totalHours} h total at</span>
        <input type="number" className="lj-wpm" min="100" max="800" step="10" value={wpm} onChange={(e) => setWpm(Number(e.target.value) || 250)} />
        <span className="settings-note">wpm</span>
        {queue.wordsPerDay
          ? <span className="settings-note" title="From your recently finished books (paper entries included)"> · finish dates assume ~{queue.wordsPerDay.toLocaleString()} words/day</span>
          : <span className="settings-note"> · finish dates need a few recent finishes to estimate your pace</span>}
        <span className="lj-spacer" />
        <button title="Open a random pick — from the queue, or the to-read pile when the queue is empty" onClick={() => {
          const pool = queue.items.length ? queue.items.map((i) => i.book) : recs;
          if (pool.length) onOpen(pool[Math.floor(Math.random() * pool.length)].id);
        }}>🎲 Surprise me</button>
      </div>
      {queue.count === 0 ? <p className="settings-note">Nothing queued in this category yet. Pull items from the recommendations below, or tap 📋 on any Library row.</p> : (
        <ol className="lj-queue-list">
          {queue.items.map(({ book: b, hours, etc }, i) => (
            <li key={b.id} className="lj-queue-item">
              <span className="lj-queue-rank">{i + 1}</span>
              <span className="lj-queue-main"><b>{b.title}</b><em>{b.author}{b.genre ? ` · ${b.genre}` : ''}{b.recScore ? ` · ★${b.recScore}` : ''}{recommender(b) !== 'Claude' ? ` · ✦${recommender(b)}` : ''}</em></span>
              <span className="lj-queue-est">{hours != null ? `~${hours} h` : '—'}{etc ? <><br /><span className="lj-queue-etc" title="Projected finish if read in order at your recent pace">done ~{etc}</span></> : ''}</span>
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

// ── Series view ──────────────────────────────────────────────────────────────────────────────────
// Every multi-book series: volume chips coloured by read status, progress count, and the next unread
// volume with a one-tap queue. Active series (started, unfinished) sort first.
function SeriesView({ books, crossNotes = [], onDeleteCross, onShelve, onOpen }) {
  const series = useMemo(() => seriesProgress(books), [books]);
  if (!series.length) return <p className="settings-note">No multi-book series in your tracker yet — set the <b>Series</b> field (and #) on books to group them here.</p>;
  const active = series.filter((s) => s.active).length;
  const done = series.filter((s) => s.done).length;
  return (
    <div className="lj-series">
      <p className="settings-note">{series.length} series · {active} in progress · {done} completed. Click a volume to open it.</p>
      {series.map((s) => (
        <div key={s.series} className={`lj-series-row${s.done ? ' done' : ''}`}>
          <div className="lj-series-head">
            <b>{s.series}</b><em>{s.author}</em>
            <span className="lj-spacer" />
            <span className="lj-series-count">{s.finished}/{s.total}{s.done ? ' ✅' : ''}</span>
          </div>
          <div className="lj-series-vols">
            {s.books.map((b) => {
              const st = readStatus(b);
              return (
                <button key={b.id} className={`lj-vol lj-vol-${st}`}
                  title={`${b.seriesNum ? `#${b.seriesNum} · ` : ''}${b.title} — ${STATUS_LABEL[st]}`}
                  onClick={() => onOpen(b.id)}>
                  {b.seriesNum || '·'}
                </button>
              );
            })}
            <span className="lj-series-bar"><i style={{ width: `${(s.finished / s.total) * 100}%` }} /></span>
          </div>
          {s.next && !s.done && (
            <div className="lj-series-next">
              <span className="settings-note" style={{ margin: 0 }}>Next up:</span> <b>{s.next.title}</b>
              {readStatus(s.next) === 'queue'
                ? <span className="settings-note" style={{ margin: 0 }}>· on deck 📋</span>
                : <button onClick={() => onShelve(s.next, 'queue')}>📋 Queue it</button>}
            </div>
          )}
          {crossNotes.filter((n) => n.series === s.series).map((n) => (
            <div key={n.id} className="lj-ainote lj-xnote">
              <span className="lj-xnote-span"><em className="lj-xnote-type">{AI_NOTE_TYPES[n.type] || 'Note'}{n.source === 'ai' ? ' · AI' : ''} · series note</em>
                <button className="close-x" title="Delete this series note" onClick={() => onDeleteCross?.(n.id)}>×</button></span>
              <div className="lj-ainote-text">{n.text}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Groups & anthologies view ────────────────────────────────────────────────────────────────────
// Two managers in one tab: (1) book-group ↔ tracker-book links — every app book group with its
// linked library book, one-tap link/new/unlink; (2) anthologies/collections — a document's ToC
// sections each map to a COMPONENT tracker book (Hamlet inside "Complete Works"), with per-section
// read progress and a reconcile that marks fully-read components finished.
function GroupsView({ books, groups, bindMap, secBind, docMeta, fileStats, onBind, onSecBind, onSaveBook, onOpen, onGroups }) {
  const [msg, setMsg] = useState('');
  const [editGrp, setEditGrp] = useState(null); // group id being edited (rename/master/members/forget)
  const [anthCs, setAnthCs] = useState('');
  const [anth, setAnth] = useState(null); // { fileName, total, sections:[{title,level,start,end,frac}] }
  const [linkFor, setLinkFor] = useState(null); // section start being linked to an existing book
  const [q, setQ] = useState('');
  const nameOf = (cs) => docMeta.find((d) => d.checksum === cs)?.fileName || fileStats[cs]?.fileName || `${String(cs).slice(0, 8)}…`;

  // Best library match for a name (group name / section title) by title-token overlap.
  const suggestFor = (name) => {
    const tokens = new Set(normTitle(name || '').split(' ').filter((w) => w.length > 2));
    if (!tokens.size) return null;
    let best = null, bestScore = 0;
    for (const b of books) {
      const score = normTitle(`${b.title || ''} ${b.author || ''}`).split(' ').filter((w) => tokens.has(w)).length;
      if (score > bestScore) { best = b; bestScore = score; }
    }
    return bestScore >= 1 ? best : null;
  };

  async function pickDoc(cs) {
    setAnthCs(cs); setAnth(null); setLinkFor(null);
    if (!cs) return;
    const [fsRec, rs] = await Promise.all([loadFile(cs), loadReadState(cs).catch(() => null)]);
    const total = fsRec?.totalWords || 0;
    const entries = [...(fsRec?.tocEntries || [])].sort((a, b) => a.wordIndex - b.wordIndex);
    const tracker = createReadingTracker({ wordCount: total, maskB64: rs?.maskB64 || '' });
    const sections = entries.map((e, i) => {
      const span = sectionSpan(entries, i, total);
      return { title: e.title, level: e.level || 0, start: span.start, end: span.end, frac: total ? tracker.rangeStats(span.start, span.end).readFrac : 0 };
    });
    setAnth({ fileName: fsRec?.fileName || nameOf(cs), total, sections });
  }
  const mappedFor = (sec) => Object.entries(secBind[anthCs] || {}).find(([, sp]) => sp.start === sec.start || (sp.title && sp.title === sec.title)) || null;

  async function newBookForSection(sec) {
    const book = { id: deriveId({ title: sec.title }), title: sec.title };
    await onSaveBook(book);
    await onSecBind(anthCs, book.id, sec);
  }
  async function finishComponents() {
    let n = 0;
    for (const sec of anth?.sections || []) {
      const m = mappedFor(sec);
      if (!m || sec.frac < 0.99) continue;
      const book = books.find((b) => b.id === m[0]);
      if (!book || book.completion === true) continue;
      await onSaveBook({ ...book, completion: true, inProgress: false, finishTime: book.finishTime || fileStats[anthCs]?.lastRead || todayISO() });
      n++;
    }
    setMsg(n ? `Marked ${n} fully-read component(s) finished. ✅` : 'No fully-read unfinished components to mark.');
  }

  // Group management (rename / master / members / forget) — mutates global.bookGroups in place.
  const groupedSet = new Set(groups.flatMap((g) => g.members || []));
  const ungroupedFiles = Object.entries(fileStats).filter(([cs]) => !groupedSet.has(cs));
  const renameGrp = (id, name) => onGroups(groups.map((g) => (g.id === id ? { ...g, name } : g)));
  const setGrpMaster = (id, cs) => onGroups(groups.map((g) => (g.id === id ? { ...g, master: cs } : g)));
  const addGrpMember = (id, cs) => cs && onGroups(groups.map((g) => (g.id === id ? { ...g, members: [...new Set([...(g.members || []), cs])] } : g)));
  const removeGrpMember = (id, cs) => onGroups(groups
    .map((g) => {
      if (g.id !== id) return g;
      const members = (g.members || []).filter((m) => m !== cs);
      return { ...g, members, master: g.master === cs ? members[0] : g.master };
    })
    .filter((g) => (g.members || []).length >= 2));
  const forgetGrp = (id) => { onGroups(groups.filter((g) => g.id !== id)); setEditGrp(null); setMsg('Group forgotten on this device — its files keep their own progress.'); };
  // Create a group right here (same makeGroup as Settings → Book Groups).
  const [newSel, setNewSel] = useState(() => new Set());
  const [newName, setNewName] = useState('');
  function createGroup() {
    const g = makeGroup(newName, [...newSel], Date.now());
    if (!g) { setMsg('Pick at least two files to group as one book.'); return; }
    onGroups([...groups, g]);
    setNewSel(new Set()); setNewName('');
    setMsg(`Grouped ${g.members.length} files as “${g.name}”.`);
  }
  const qMatches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.trim().toLowerCase();
    return books.filter((b) => `${b.title || ''} ${b.author || ''}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, books]);

  // Bulk-link scan: every opened file with NO tracker link, split into fuzzy matches against
  // existing books vs. strangers — the strangers are typically AI-generated one-offs, so the bulk
  // action creates them as 'ai-gen' books and links them in one pass.
  const [bulk, setBulk] = useState(null); // { matched:[{cs,fileName,book}], fresh:[{cs,title}], sel:Set }
  function scanUnlinked() {
    const matched = [], fresh = [];
    for (const [cs, f] of Object.entries(fileStats)) {
      if (bindMap[cs] || !f.fileName) continue;
      const title = String(f.fileName).replace(/\.[a-z0-9]+$/i, '');
      const sugg = suggestFor(title);
      if (sugg) matched.push({ cs, fileName: f.fileName, book: sugg });
      else fresh.push({ cs, title });
    }
    setBulk({ matched, fresh, sel: new Set(fresh.map((x) => x.cs)) });
    if (!matched.length && !fresh.length) { setBulk(null); setMsg('Every opened file is already linked. ✅'); }
  }
  async function linkAllMatched() {
    for (const m of bulk.matched) await onBind(m.cs, m.book.id);
    setMsg(`Linked ${bulk.matched.length} file(s) to their matching books.`);
    setBulk(null);
  }
  async function createAiGenBooks() {
    let n = 0;
    for (const x of bulk.fresh) {
      if (!bulk.sel.has(x.cs)) continue;
      const book = { id: deriveId({ title: x.title }), title: x.title, type: 'ai-gen', tags: ['ai-gen'], recBy: 'Claude' };
      await onSaveBook(book);
      await onBind(x.cs, book.id);
      n++;
    }
    setMsg(`Created ${n} AI-generated book(s) and linked their files.`);
    setBulk(null);
  }

  return (
    <div className="lj-groupsview">
      <div className="rh-section-h">Book groups ↔ tracker books</div>
      {groups.length === 0 && <p className="settings-note">No book groups yet — group edition files under <b>Settings → Book Groups</b>, then link each group to its tracker book here.</p>}
      {groups.map((g) => {
        const master = masterOf(g);
        const linkedId = bindMap[master] || (g.members || []).map((m) => bindMap[m]).find(Boolean);
        const linked = linkedId ? books.find((b) => b.id === linkedId) : null;
        const sugg = !linked ? suggestFor(g.name) : null;
        const editing = editGrp === g.id;
        return (
          <div key={g.id || g.name} className="lj-grp-row">
            <span className="lj-grp-name">
              {editing
                ? <input value={g.name} onChange={(e) => renameGrp(g.id, e.target.value)} aria-label="Group name" />
                : <b>{g.name}</b>}
              <em>{(g.members || []).length} file(s) · master: {nameOf(master)}</em>
            </span>
            {linked ? (
              <span className="lj-grp-acts">
                <span className="rh-link-chip on">🔗 {linked.title}</span>
                <button onClick={() => onOpen(linked.id)}>↗ Open</button>
                <button title="Remove the link between this group's master file and the tracker book" onClick={() => onBind(null, linked.id)}>Unlink</button>
              </span>
            ) : (
              <span className="lj-grp-acts">
                <span className="rh-link-chip">○ not linked</span>
                {sugg && <button className="toggle-on" onClick={() => onBind(master, sugg.id)}>Link “{sugg.title}”</button>}
                <button title="Create a tracker book named after the group and link it" onClick={async () => { const book = { id: deriveId({ title: g.name }), title: g.name }; await onSaveBook(book); await onBind(master, book.id); }}>＋ New book</button>
              </span>
            )}
            <span className="lj-grp-acts">
              <button title="Rename, change the master, add/remove files, or forget this group" onClick={() => setEditGrp(editing ? null : g.id)}>{editing ? 'Done' : '✎ Edit'}</button>
            </span>
            {editing && (
              <div className="lj-grp-edit">
                {(g.members || []).map((cs) => (
                  <div key={cs} className="lj-grp-member">
                    <label title={cs === master ? 'Master (canonical) copy' : 'Make this the master copy'}>
                      <input type="radio" name={`ljm-${g.id}`} checked={cs === master} onChange={() => setGrpMaster(g.id, cs)} />
                      <span>{cs === master ? '★' : '☆'}</span>
                    </label>
                    <span className="lj-grp-member-name" title={cs}>{nameOf(cs)}</span>
                    <button title="Remove this file from the group" onClick={() => removeGrpMember(g.id, cs)}>×</button>
                  </div>
                ))}
                <div className="lj-inline" style={{ margin: '4px 0 0' }}>
                  {ungroupedFiles.length > 0 && (
                    <select value="" onChange={(e) => addGrpMember(g.id, e.target.value)} title="Add another edition/file to this group">
                      <option value="">＋ Add a file…</option>
                      {ungroupedFiles.map(([cs, f]) => <option key={cs} value={cs}>{f.fileName || cs.slice(0, 8)}</option>)}
                    </select>
                  )}
                  <button className="lj-danger" title="Delete the group (files keep their own progress)" onClick={() => forgetGrp(g.id)}>🗑 Forget group</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {ungroupedFiles.length >= 2 && (
        <details className="lj-newgrp">
          <summary>＋ New group — pick 2+ files that are the same book</summary>
          <div className="lj-newgrp-list">
            {ungroupedFiles.map(([cs, f]) => (
              <label key={cs} className="inline-check">
                <input type="checkbox" checked={newSel.has(cs)} onChange={(e) => setNewSel((prev) => { const n = new Set(prev); e.target.checked ? n.add(cs) : n.delete(cs); return n; })} />
                {f.fileName || cs.slice(0, 8)}
              </label>
            ))}
          </div>
          <div className="lj-inline">
            <input placeholder="Book name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="toggle-on" disabled={newSel.size < 2} onClick={createGroup}>Group {newSel.size >= 2 ? newSel.size : ''} as one book</button>
          </div>
        </details>
      )}
      {msg && !anth && <p className="settings-note">{msg}</p>}

      <div className="rh-section-h">Unlinked files — bulk link</div>
      <p className="settings-note">Find every opened file with no tracker book. Fuzzy matches link to their existing books; the rest (typically AI-generated one-offs) can be created as <b>AI-generated</b> books and linked in one pass.</p>
      <div className="lj-inline"><button onClick={scanUnlinked}>🔍 Scan opened files</button></div>
      {bulk && (
        <div className="lj-cleanup">
          {bulk.matched.length > 0 && (
            <details open><summary><b>{bulk.matched.length}</b> match existing books</summary>
              <ul className="lj-clean-list">{bulk.matched.map((m) => <li key={m.cs}>{m.fileName} → <b>{m.book.title}</b></li>)}</ul>
              <button className="toggle-on" onClick={linkAllMatched}>🔗 Link all {bulk.matched.length}</button>
            </details>
          )}
          {bulk.fresh.length > 0 && (
            <details open><summary><b>{bulk.fresh.length}</b> with no matching book — create as AI-generated</summary>
              <ul className="lj-clean-list">{bulk.fresh.map((x) => (
                <li key={x.cs}><label className="inline-check"><input type="checkbox" checked={bulk.sel.has(x.cs)} onChange={(e) => setBulk((b) => { const sel = new Set(b.sel); e.target.checked ? sel.add(x.cs) : sel.delete(x.cs); return { ...b, sel }; })} /> {x.title}</label></li>
              ))}</ul>
              <button className="toggle-on" disabled={![...bulk.sel].length} onClick={createAiGenBooks}>＋ Create {[...bulk.sel].length} as AI-generated + link</button>
            </details>
          )}
          <div className="lj-inline"><button onClick={() => setBulk(null)}>Dismiss</button></div>
        </div>
      )}

      <div className="rh-section-h">Anthologies &amp; collections — components map to sections</div>
      <p className="settings-note">Pick a stored document (the anthology file); each ToC section can bind to its own tracker book. Reading a section fully lets you mark that component finished.</p>
      <div className="lj-inline">
        <select value={anthCs} onChange={(e) => pickDoc(e.target.value)}>
          <option value="">Pick a document…</option>
          {docMeta.map((d) => <option key={d.checksum} value={d.checksum}>{d.fileName}</option>)}
        </select>
        {anth && anth.sections.some((s) => mappedFor(s)) && <button className="toggle-on" onClick={finishComponents}>✓ Mark fully-read components finished</button>}
        {msg && <span className="settings-note" style={{ margin: 0 }}>{msg}</span>}
      </div>
      {anth && anth.sections.length === 0 && <p className="settings-note">“{anth.fileName}” has no stored Table of Contents — open it and run the ToC wizard first.</p>}
      {anth && anth.sections.length > 0 && (
        <div className="lj-anth">
          {anth.sections.map((sec) => {
            const m = mappedFor(sec);
            const book = m ? books.find((b) => b.id === m[0]) : null;
            return (
              <div key={sec.start} className="lj-anth-row" style={{ paddingLeft: 8 + sec.level * 14 }}>
                <span className="lj-anth-title">{sec.title}</span>
                <span className="lj-series-bar" title={`${Math.round(sec.frac * 100)}% of this section read`}><i style={{ width: `${sec.frac * 100}%` }} /></span>
                <span className="lj-anth-pct">{Math.round(sec.frac * 100)}%</span>
                {m ? (
                  <span className="lj-grp-acts">
                    <span className="rh-link-chip on" title={book ? STATUS_LABEL[readStatus(book)] : ''}>🔗 {book?.title || m[0]}{book && readStatus(book) === 'finished' ? ' ✅' : ''}</span>
                    {book && <button onClick={() => onOpen(book.id)}>↗</button>}
                    <button title="Unlink this section" onClick={() => onSecBind(anthCs, m[0], null)}>✕</button>
                  </span>
                ) : (
                  <span className="lj-grp-acts">
                    <button title="Create a tracker book named after this section and bind it" onClick={() => newBookForSection(sec)}>＋ Book</button>
                    <button title="Bind an existing tracker book to this section" onClick={() => { setLinkFor(linkFor === sec.start ? null : sec.start); setQ(''); }}>🔗 Link…</button>
                  </span>
                )}
                {linkFor === sec.start && (
                  <span className="lj-anth-pick">
                    <input autoFocus placeholder="Search your library…" value={q} onChange={(e) => setQ(e.target.value)} />
                    {qMatches.map((b) => (
                      <button key={b.id} onClick={async () => { await onSecBind(anthCs, b.id, sec); setLinkFor(null); }}>{b.title}{b.author ? ` — ${b.author}` : ''}</button>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
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

// One year's wrap-up card — Goodreads-style "Year in Books" superlatives, per selectable year.
function YearWrap({ books, years }) {
  const [year, setYear] = useState(years[years.length - 1]);
  const w = useMemo(() => yearInBooks(books, year), [books, year]);
  if (!w) return null;
  return (
    <div className="lj-wrap">
      <div className="lj-wrap-head">
        <b>Your {year} in books</b>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
      </div>
      <div className="rh-stat-grid">
        <Stat v={w.books} l="finished" sub={`${w.fiction} fiction · ${w.nonfiction} non-fiction`} />
        <Stat v={w.pages ? w.pages.toLocaleString() : '—'} l="pages" sub={w.words ? `${(w.words / 1e6).toFixed(1)}M words` : null} />
        <Stat v={w.topGenre ? w.topGenre[0] : '—'} l="top genre" sub={w.topGenre ? `${w.topGenre[1]} book(s)` : null} />
        <Stat v={w.topAuthor ? w.topAuthor[0] : '—'} l="top author" sub={w.topAuthor ? `${w.topAuthor[1]} book(s)` : null} />
        {w.avgRating != null && <Stat v={`★${w.avgRating}`} l="avg rating" sub={w.avgDifficulty ? `avg difficulty ${w.avgDifficulty}` : null} />}
      </div>
      <div className="lj-wrap-superls">
        {w.longest && <span title={`${w.longest.pages} pages`}>📏 Longest: <b>{w.longest.title}</b></span>}
        {w.hardest && <span title={`Difficulty ${w.hardest.difficultyLevel}`}>🧗 Hardest: <b>{w.hardest.title}</b></span>}
        {w.favorite && <span title={`Rated ${bookRating(w.favorite)}★`}>❤️ Favorite: <b>{w.favorite.title}</b></span>}
      </div>
    </div>
  );
}

// Weekly summaries: algorithmic by default (weeklySummaries), replaced by a cowork-dressed version
// when the ai record has one for that week (ai.weeklies[weekMonday] — see AiView / applyAiOutput).
function WeeklySummaries({ books, dayAgg, ai }) {
  const weeks = useMemo(() => weeklySummaries(dayAgg || [], books, { weeks: 8 }), [dayAgg, books]);
  if (!weeks.length) return null;
  const dressed = ai?.weeklies || {};
  return (
    <>
      <div className="rh-section-h">Weekly summaries</div>
      <p className="settings-note">Completed weeks (Mon–Sun), generated from your reading history. The AI / Cowork tab can “dress up” any week — dressed weeks show ✨.</p>
      <div className="lj-weeklies">
        {weeks.map((w) => {
          const d = dressed[w.week];
          return (
            <div key={w.week} className="lj-weekly">
              <div className="lj-weekly-head">
                <b>{w.start} → {w.end}</b>
                {w.words > 0 && <em>{w.words.toLocaleString()} words · {w.daysActive} day{w.daysActive === 1 ? '' : 's'}{w.wpm ? ` · ${w.wpm} WPM` : ''}</em>}
                {w.finished.length > 0 && <em>✅ {w.finished.length}</em>}
                {d && <span className="lj-weekly-ai" title="Written by the cowork AI from this week's numbers">✨ AI</span>}
              </div>
              <div className="lj-weekly-text">{d?.text || w.text}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Analytics view ───────────────────────────────────────────────────────────────────────────────
function AnalyticsView({ books, dayAgg = [], ai = null }) {
  const pace = useMemo(() => paceByYear(books), [books]);
  const gt = useMemo(() => genreTrend(books, 6), [books]);
  const rb = useMemo(() => recommenderBreakdown(books), [books]);
  if (pace.length === 0 && rb.length <= 1 && !dayAgg.length) return <p className="settings-note">Not much to chart yet — mark some books finished (with dates) and attribute a few recommendations.</p>;
  const maxBooks = Math.max(1, ...pace.map((p) => p.books));
  const maxGT = Math.max(1, ...gt.rows.map((r) => r.total));
  const maxRec = Math.max(1, ...rb.map((r) => r.total));
  return (
    <div className="lj-analytics">
      <WeeklySummaries books={books} dayAgg={dayAgg} ai={ai} />
      {pace.length > 0 && <YearWrap books={books} years={pace.map((p) => p.year)} />}
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

function AiView({ books, ai, global, bindMap = {}, onBind, onReload }) {
  // Reading-progress bundle (daily/weekly totals, streak, in-flight books) attached to every export,
  // so cowork daily/weekly summary tasks have the data. Built fresh at call time from the file records.
  // The algorithmic weekly summaries ride along so a cowork task can return dressed-up `weeklies`.
  const datasetWithProgress = async (light) => {
    const progress = buildProgress(await allFiles().catch(() => []), { books, bindMap, days: 63 });
    progress.weeklySummaries = weeklySummaries(progress.days, books, { weeks: 8 });
    return buildDataset(books, { light, progress });
  };
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

  // Related-activity feed: every cowork-ish event (requests written, responses applied, API runs)
  // appends a line to ai.activity, shown at the bottom of this tab. Capped, newest last in storage.
  const actEntry = (kind, text) => ({ at: Date.now(), kind, text });
  async function logActivity(kind, text) {
    await saveJourneyAi({ ...(ai || {}), activity: [...(ai?.activity || []), actEntry(kind, text)].slice(-40) });
    onReload();
  }

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
    const { bookUpdates, aiPatch, crossNoteAdds, bindingAdds, weeklyAdds } = applyAiOutput(output, booksById);
    for (const b of bookUpdates) await saveLibraryBook(b);
    const crossAdded = crossNoteAdds?.length ? await addCrossNotes(crossNoteAdds) : 0;
    for (const bd of bindingAdds || []) await onBind?.(bd.checksum, bd.bookId);
    const wasHeavy = getInstruction(ai).mode === 'heavy';
    const nextAi = { ...(ai || {}), ...aiPatch, ledger: [...ledger, hash].slice(-50) };
    // A new analysis ARCHIVES the previous one instead of silently overwriting it (capped 20).
    if (aiPatch.analysis && ai?.analysis && ai.analysis !== aiPatch.analysis) {
      nextAi.analysisHistory = [{ text: ai.analysis, at: ai.updatedAt || Date.now() }, ...(ai.analysisHistory || [])].slice(0, 20);
    }
    // Dressed-up weekly summaries land keyed by their week's Monday (Analytics prefers these).
    if (weeklyAdds?.length) {
      nextAi.weeklies = { ...(ai?.weeklies || {}) };
      for (const w of weeklyAdds) nextAi.weeklies[w.week] = { text: w.text, at: Date.now() };
    }
    if (wasHeavy) nextAi.instruction = { mode: 'light', text: LIGHT_INSTRUCTION, updatedAt: Date.now() };
    const summary = `Applied — ${bookUpdates.length} book patch(es)${crossAdded ? `, ${crossAdded} shared note(s)` : ''}${bindingAdds?.length ? `, ${bindingAdds.length} file link(s)` : ''}${weeklyAdds?.length ? `, ${weeklyAdds.length} weekly summar${weeklyAdds.length === 1 ? 'y' : 'ies'}` : ''}${aiPatch.analysis ? ', analysis' : ''}${aiPatch.recommendations ? ', recommendations' : ''}${aiPatch.treeMeta ? ', tech tree' : ''}.`;
    nextAi.activity = [...(ai?.activity || []), actEntry('apply', summary)].slice(-40);
    await saveJourneyAi(nextAi);
    if (wasHeavy) { setMode('light'); setText(LIGHT_INSTRUCTION); }
    setMsg(`${summary}${wasHeavy ? ' Instruction reset to light.' : ''}`);
    onReload();
  }

  async function runApi() {
    setBusy(true); setMsg('Asking Claude…');
    try {
      const dataset = await datasetWithProgress(true); // API path is always the compact subset
      const { system, messages } = buildApiMessages(dataset, { mode, text });
      const reply = await askClaude(messages, { key: global.anthropicKey, model, system, maxTokens: 2048, source: 'trackyread-ai' });
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
      const dataset = await datasetWithProgress(mode === 'light');
      await writeToDir(dir, 'journey-cowork-request.json', JSON.stringify(buildCoworkRequest(dataset, { mode, text }), null, 2));
      await writeToDir(dir, 'journey-instructions.md', buildDigest(dataset, { mode, text }));
      await logActivity('request', `Wrote cowork request (${mode}) to “${dir.name}”`);
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
    try {
      await navigator.clipboard.writeText(buildDigest(await datasetWithProgress(mode === 'light'), { mode, text }));
      await logActivity('digest', `Copied ${mode} digest to clipboard`);
      setMsg('Digest copied — paste it into a Claude chat, then paste the JSON reply below.');
    } catch { setMsg('Clipboard blocked — use the cowork folder instead.'); }
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
          <div className="lj-inline">
            <span className="settings-note">Presets:</span>
            <button onClick={() => { setText(HEAVY_PLACEHOLDER); saveInstruction('heavy', HEAVY_PLACEHOLDER); }}>🌳 Tech tree</button>
            <button onClick={() => { setText(KNOWLEDGE_GRAPH_INSTRUCTION); saveInstruction('heavy', KNOWLEDGE_GRAPH_INSTRUCTION); }}>🕸 Knowledge graph</button>
            <button title="Audit every book's content-type (long-form / short-form / article / AI-generated / poetry / reference) and fix wrong or missing classifications" onClick={() => { setText(CLASSIFY_INSTRUCTION); saveInstruction('heavy', CLASSIFY_INSTRUCTION); }}>🗂 Classify content types</button>
          </div>
          <textarea className="lj-instr" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="lj-inline"><button onClick={() => saveInstruction('heavy', text)}>Save instruction</button><span className="settings-note">Full tech-tree / knowledge-graph rebuilds go through the cowork folder (the whole library). Resets to Light once applied.</span></div>
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

      {(ai?.analysisHistory || []).length > 0 && (
        <>
          <div className="rh-section-h">Previous AI analyses ({ai.analysisHistory.length})</div>
          <p className="settings-note">Each new analysis archives the one it replaced — review or delete them here (the current one lives on the Dashboard).</p>
          {ai.analysisHistory.map((h, i) => (
            <details key={`${h.at}-${i}`} className="lj-hist">
              <summary>
                <span>{fmtDateTime(h.at)}</span>
                <button className="grab-trash" title="Delete this archived analysis" onClick={async (e) => { e.preventDefault(); e.stopPropagation(); await saveJourneyAi({ ...ai, analysisHistory: ai.analysisHistory.filter((_, j) => j !== i) }); onReload(); }}>🗑</button>
              </summary>
              <p className="lj-analysis">{h.text}</p>
            </details>
          ))}
        </>
      )}

      {(ai?.activity || []).length > 0 && (
        <>
          <div className="rh-section-h">Activity</div>
          <div className="lj-actfeed">
            {[...ai.activity].reverse().map((a, i) => (
              <div key={`${a.at}-${i}`} className="lj-actrow">
                <span className={`lj-actkind lj-act-${a.kind || 'other'}`}>{{ apply: '✅', request: '📤', digest: '📋' }[a.kind] || '·'}</span>
                <span className="lj-acttext">{a.text}</span>
                <em>{fmtDateTime(a.at)}</em>
              </div>
            ))}
          </div>
        </>
      )}

      {msg && <p className="settings-note lj-aimsg">{msg}</p>}
    </div>
  );
}
