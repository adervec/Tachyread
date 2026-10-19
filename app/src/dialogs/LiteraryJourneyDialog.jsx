import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionState } from '../state/useSessionState.js';
import { todaySummary, localDate } from '../features/todaySummary.js';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { scanMiscategorized, applyRecat, recatSummary } from '../features/journeyRecat.js';
import { forgettingScan, driftingScan } from '../features/journeyForgetting.js';
import { bookCovers, bookCoverSrc, addCover, removeCover, setMaster, coverId, coverSpecToSvg, proceduralCover, coverPromptFor, parseCoverSpec } from '../features/bookCovers.js';
import { fmtDateTime } from '../features/dateFmt.js';
import {
  getLibraryBooks, saveLibraryBook, deleteLibraryBook, getLibraryRef, saveLibraryRef,
  getJourneyAi, saveJourneyAi, exportLibraryData, importLibraryData, librarySize, clearLibrary,
  getBinding, setBinding, getSectionBindings, setSectionBinding, allDocMeta, allFiles, getFsHandle, setFsHandle,
  loadFile, loadReadState, loadDocPayload,
  getCrossNotes, saveCrossNote, deleteCrossNote,
} from '../state/storage.js';
import { extractTextMeta } from '../features/textMeta.js';
import { createReadingTracker } from '../engine/readingTracker.js';
import { sectionSpan } from '../document/toc.js';
import { askClaude, anthropicConfigured } from '../features/anthropic.js';
import {
  buildDataset, buildDigest, buildProgress, AI_NOTE_TYPES,
  buildCoworkRequest, buildCoworkManifest, buildApiMessages, parseAiOutput, contentHash,
} from '../features/journeyAi.js';
import {
  normalizeSeed, filterBooks, libraryStats, exportJourneyMarkdown,
  readStatus, setReadStatus, recommender, STATUS_LABEL,
  distinctValues, pubYear, finishMs, deriveId, bookRating,
  bookTags, allTags, finishCount, logReread, CONTENT_TYPES, contentType,
} from '../features/journeyLibrary.js';
import {
  cumulativeFinishes, finishHeatmap, paceByYear, genreTrend, recommenderBreakdown, estHours,
  yearGoal, yearWordsGoal, seriesProgress, yearInBooks, weeklySummaries,
} from '../features/journeyAnalytics.js';
import { findDuplicates, finishedDateIssues, findQuickAddPairs, mergeQuickInto, bookDiff } from '../features/journeyCleanup.js';
import { normTitle } from '../document/tocWizard.js';
import { planBulkLinks, matchScore, newBookFor } from '../features/bulkLink.js';
import { getSearchDirs, addSearchDir, removeSearchDir, pickerSupported, foundPaths, indexFolders, rememberPaths } from '../features/fileLocator.js';
import { openBookFile, fileWhere } from '../features/openBook.js';
import { textMatcher, inRange, inDates, anySet } from '../features/tableFilter.js';
import { TextF, RangeF, DateF } from '../components/ColFilter.jsx';
import { newQueue, addToQueue, addToDeck, deleteQueue, liveQueues, dedupeQueues, moveQueue, splitFinished, moveInTodo, queuesOverview, removeFromQueue, setQueueIds, swapQueueId, mergeQueues, splitQueue, QUEUE_SPLITS, queueBooks, queueStats, QUEUE_SORTS, sortQueueIds, deckMigration, recentPace, CAND_COLS, CAND_STATES, candidateRows, filterCandidates, bookRow } from '../features/readingQueues.js';
import { groupForChecksum, masterOf, makeGroup, groupFiles } from '../features/bookGroups.js';
import { readingTimeSummary, estimateTotalSecs, audiobookSecs, fmtDur, bookWordCount } from '../features/readingTime.js';
import { olFetch, bookCoverUrl } from '../features/openLibrary.js';
import { HistoryView } from './HistoryDialog.jsx';
import AllNotesView from './AllNotesView.jsx';
import ProgressDetailDialog from './ProgressDetailDialog.jsx';
import { getSyncProvider } from '../features/sync/syncProviders.js';
import { syncLibraryWithProvider, syncWithProvider } from '../features/sync/syncManager.js';
import {
  SYNC_ACTION_GROUPS, actionById, combineCoworkInstruction, SCHEDULE_OPTS,
  syncRole, recordRun, mergedHistory, calendarCells, fmtAgo, dayKey,
} from '../features/coworkActions.js';
import { COWORK_OPS, OP_GROUPS, NEVER_CHANGED, sanitizeOutput, planRows, opsInstruction, queuesForDataset } from '../features/coworkOps.js';
import { writeSnapshot, commitRows, undoLastApply } from '../features/coworkApply.js';
import { getDeviceId } from '../state/storage.js';
import { deviceKind } from '../state/device.js';
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

// Unified vs split view of the headline numbers: bucket books into long-form / short-form+articles /
// AI-generated so throwaway content can be read OUT of the "real" totals at a glance.
const TYPE_BUCKETS = [['long', '📚 Long-form'], ['short', '📄 Short-form & articles'], ['ai-gen', '🤖 AI-generated']];
const bucketOf = (b) => {
  const t = contentType(b);
  return t === 'ai-gen' ? 'ai-gen' : t === 'short' || t === 'article' ? 'short' : 'long';
};
function TypeSplit({ books }) {
  const rows = TYPE_BUCKETS.map(([key, label]) => {
    const mine = books.filter((b) => bucketOf(b) === key);
    const fin = mine.filter((b) => readStatus(b) === 'finished');
    return {
      key, label,
      total: mine.length,
      finished: fin.length,
      words: fin.reduce((s, b) => s + (Number(b.words) || 0), 0),
      pages: fin.reduce((s, b) => s + (Number(b.pages) || 0), 0),
    };
  }).filter((r) => r.total > 0);
  if (!rows.length) return null;
  return (
    <div className="lj-tablewrap">
      <table className="lj-table lj-split-table">
        <thead><tr><th>Content</th><th>Books</th><th>Finished</th><th>Words read</th><th>Pages read</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{r.total.toLocaleString()}</td>
              <td>{r.finished.toLocaleString()}</td>
              <td>{r.words ? `${(r.words / 1e6).toFixed(2)}M` : '—'}</td>
              <td>{r.pages ? r.pages.toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

const fmtVal = (v) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v));

// The dashboard's "Today" card: words / time / speed so far against your usual day and what the
// words goal needs, the streak, what you read today (with each book's progress), anything finished
// today, and what's next in your queues. Everything comes from data the dialog already has.
const fmtMin = (secs) => (secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m` : secs >= 60 ? `${Math.round(secs / 60)}m` : `${Math.round(secs)}s`);
function TodayCard({ books, goals, dayAgg, fileStats, bindMap, linkedIds, openChecksums = [], onOpenBook, onOpenFile, onQueues }) {
  const now = useMemo(() => Date.now(), []); // eslint-disable-line react-hooks/purity
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const t = useMemo(() => todaySummary({ dayAgg, fileStats, bookOf: (cs) => byId.get(bindMap[cs]) || null, books, now }), [dayAgg, fileStats, bindMap, byId, books, now]);
  const pace = useMemo(() => recentPace(dayAgg.filter((d) => d.date !== t.today), { now: now - 86400000 }), [dayAgg, t.today, now]);
  const wordsTarget = Number(goals?.[`${new Date(now).getUTCFullYear()}-words`]) || 0;
  const wg = useMemo(() => (wordsTarget ? yearWordsGoal(dayAgg, books, linkedIds, wordsTarget, now) : null), [wordsTarget, dayAgg, books, linkedIds, now]);
  // What's next in each queue (first few queues).
  const [nexts, setNexts] = useState([]);
  useEffect(() => {
    let live = true;
    getLibraryRef('queues').then((qs) => {
      if (!live) return;
      // Skip what you're already reading today — "up next" means the one after it.
      const readToday = new Set(t.files.map((f) => f.book?.id).filter(Boolean));
      setNexts(liveQueues(qs || []).map((q) => { const todo = splitFinished(queueBooks(q, books)).todo; return { q, book: todo.find((b) => !readToday.has(b.id)) || todo[0] || null }; }).filter((x) => x.book).slice(0, 4));
    }).catch(() => {});
    return () => { live = false; };
  }, [books, t.files]);
  // Today's need = what's left of the year's goal per day, plus today's own share already read.
  const need = wg && wg.remaining > 0 ? Math.round((wg.remaining + t.words) / Math.max(1, wg.daysLeft + 1)) : null;
  const usual = pace.wordsPerDay;
  const bar = (v, of) => (of ? Math.min(1, v / of) : 0);
  const csOf = {};
  for (const [c, id] of Object.entries(bindMap)) if (!csOf[id]) csOf[id] = c;
  return (
    <div className="lj-today">
      <div className="lj-today-head">
        <b>Today</b>
        <span className="settings-note" style={{ margin: 0 }}>{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <span className="lj-spacer" />
        <span className={`lj-today-streak${t.streak.readToday ? ' on' : ''}`} title="Consecutive days with some reading">
          🔥 {t.streak.days} day{t.streak.days === 1 ? '' : 's'}{!t.streak.readToday && t.streak.days ? ' — read today to keep it' : ''}
        </span>
      </div>
      <div className="lj-qstats">
        <div className="ab-stat"><b>{t.words.toLocaleString()}</b><span>words today{t.aloudWords ? ` (${t.aloudWords.toLocaleString()} aloud)` : ''}</span></div>
        <div className="ab-stat"><b>{fmtMin(t.secs)}</b><span>active reading</span></div>
        <div className="ab-stat"><b>{t.wpm ?? '—'}</b><span>wpm today{pace.wpm ? ` · usually ~${pace.wpm}` : ''}</span></div>
        <div className="ab-stat" title="Your recent words per day (last ~6 weeks, recent days weighted most)">
          <b>{usual ? `${Math.round((t.words / usual) * 100)}%` : '—'}</b><span>{usual ? `of your usual ~${usual.toLocaleString()}/day` : 'of a usual day (no history yet)'}</span>
          {usual ? <Bar pct={bar(t.words, usual)} label="Today against your usual day" /> : null}
        </div>
        {need != null && (
          <div className="ab-stat" title="What's left of this year's words goal, spread over the days left (today included)">
            <b>{t.words >= need ? '✓' : (need - t.words).toLocaleString()}</b><span>{t.words >= need ? `words goal: today's ~${need.toLocaleString()} done` : `words to go for today's goal share (~${need.toLocaleString()})`}</span>
            <Bar cls={t.words >= need ? 'fin' : ''} pct={bar(t.words, need)} label="Today against the words goal's daily share" />
          </div>
        )}
      </div>
      {t.files.length > 0 ? (
        <div className="lj-today-list">
          {t.files.slice(0, 8).map((f) => (
            <div key={f.cs} className="lj-today-row">
              <button className="link-btn" onClick={() => (f.book ? onOpenBook(f.book.id) : onOpenFile(f.cs))} title={f.book ? 'Open in Library' : 'Open the file'}>{f.book?.title || f.name}</button>
              <span className="lj-qdim">{f.words.toLocaleString()} words · {fmtMin(f.secs)}</span>
              <Bar pct={f.coverage} label={`${Math.round(f.coverage * 100)}% of the book read`} /><span className="lj-cand-pct">{Math.round(f.coverage * 100)}%</span>
              {!openChecksums.includes(f.cs) && <button onClick={() => onOpenFile(f.cs)} title="Continue reading">▶</button>}
            </div>
          ))}
        </div>
      ) : <p className="settings-note">Nothing read yet today.</p>}
      {t.finished.length > 0 && <p className="settings-note lj-today-fin">🎉 Finished today: {t.finished.map((b) => b.title).join(', ')}</p>}
      {nexts.length > 0 && (
        <div className="lj-today-next">
          <span className="settings-note" style={{ margin: 0 }}>Up next:</span>
          {nexts.map(({ q, book }) => (
            <span key={q.id} className="lj-today-chip">
              <button className="link-btn" onClick={onQueues} title={`Queue “${q.name}”`}>{q.name}</button> → <button className="link-btn" onClick={() => onOpenBook(book.id)}>{book.title}</button>
              {csOf[book.id] && <button onClick={() => onOpenFile(csOf[book.id])} title="Open it">▶</button>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Yearly WORDS goal, beside the books one (stored in the same synced goals ref as "<year>-words").
// Counts reading the app recorded this year plus off-app finishes (books with no linked document).
const fmtWords = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
function WordsGoalCard({ books, goals, dayAgg, linkedIds, onSetGoal }) {
  const now = useMemo(() => Date.now(), []); // eslint-disable-line react-hooks/purity
  const year = new Date(now).getUTCFullYear();
  const key = `${year}-words`;
  const target = Number(goals?.[key]) || 0;
  const g = useMemo(() => yearWordsGoal(dayAgg, books, linkedIds, target, now), [dayAgg, books, linkedIds, target, now]);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const pct = g.target ? Math.min(100, (g.read / g.target) * 100) : 0;
  return (
    <div className="lj-goal">
      {g.target > 0 ? (
        <>
          <div className="lj-goal-head">
            <b>{g.year} words goal</b>
            <span title={`${g.appWords.toLocaleString()} read in the app + ${g.offApp.toLocaleString()} from books finished elsewhere`}>{g.read.toLocaleString()} of {g.target.toLocaleString()} words</span>
            <span className={`lj-goal-badge ${g.read >= g.target ? 'won' : g.onTrack ? 'on' : 'off'}`}>
              {g.read >= g.target ? '🏆 goal hit!' : g.onTrack ? '✓ on track' : '⚠ behind pace'}
            </span>
            <span className="lj-spacer" />
            <button className="link-btn" onClick={() => { setVal(String(g.target)); setEditing(true); }}>edit</button>
          </div>
          <div className="lj-goal-bar" title={`${fmtWords(g.read)}/${fmtWords(g.target)} · the tick marks where today sits in the year`}>
            <i style={{ width: `${pct}%` }} />
            <em style={{ left: `${g.yearFrac * 100}%` }} />
          </div>
          <p className="settings-note lj-goal-note">
            {g.read >= g.target
              ? `Done with ${g.daysLeft} days to spare — raise the bar?`
              : `${fmtWords(g.remaining)} to go · need ~${(g.needPerDay ?? 0).toLocaleString()} words/day · current pace projects ${g.projected != null ? fmtWords(g.projected) : '—'} by year-end`}
            {' '}· {fmtWords(g.appWords)} read in the app{g.offApp ? ` + ${fmtWords(g.offApp)} finished elsewhere` : ''}
          </p>
        </>
      ) : (
        <button onClick={() => { setVal('3000000'); setEditing(true); }}>🎯 Set a {year} words goal…</button>
      )}
      {editing && (
        <div className="lj-inline">
          <label className="settings-note" style={{ margin: 0 }}>Words in {year}:</label>
          <input className="lj-goal-num lj-goal-words" type="number" min="1000" step="100000" value={val} onChange={(e) => setVal(e.target.value)} aria-label={`Words goal for ${year}`} />
          <span className="settings-note" style={{ margin: 0 }}>{Number(val) > 0 ? `≈ ${fmtWords(Number(val))} · ~${Math.round(Number(val) / 90000)} novels` : ''}</span>
          <button className="toggle-on" onClick={() => { onSetGoal(key, Math.max(0, Math.round(Number(val) || 0))); setEditing(false); }}>Set goal</button>
          {g.target > 0 && <button onClick={() => { onSetGoal(key, 0); setEditing(false); }}>Remove</button>}
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export default function LiteraryJourneyDialog({ global, onPatch, initialTab, focusBookId, focusQueueId, linkChecksum, linkFileName, openChecksums = [], onClose }) {
  const { openRecent } = useApp();
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
  const [flt, setFlt] = useSessionState('tr-lj-flt', { readState: 'all', fnf: 'all', difficulty: [], recMin: 0, genre: 'all', search: '', recBy: 'all', tag: 'all', ctype: 'all' });
  // Per-column filters live in the table header (status/title/author/genre/type/file-link).
  // Library table column filters: every column — regex on text, min/max on numbers, from/to on dates.
  const NO_COLF = { title: '', author: '', genre: 'all', type: 'all', status: 'all', file: 'all', started: ['', ''], pct: ['', ''], diff: ['', ''], rec: ['', ''], pages: ['', ''], pub: ['', ''], finished: ['', ''] };
  const [colF, setColF] = useSessionState('tr-lj-colf', NO_COLF);
  const [sort, setSort] = useSessionState('tr-lj-sort', { key: 'rec', dir: 1 }); // table-header sorting; dir 1 = the key's natural order
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [cleanup, setCleanup] = useState(null); // scan preview: { dups, datable, undatable, contradictory }
  // Miscategorised-content scan: suggestions plus the ids the user has ticked to apply.
  const [recat, setRecat] = useState(null);
  const [recatPick, setRecatPick] = useState(() => new Set());
  const [recatMsg, setRecatMsg] = useState('');
  const [fadingAll, setFadingAll] = useState(false);
  const [driftAll, setDriftAll] = useState(false);
  // Books slipping out of memory (finished, decayed below "fresh"). now() is stable per open so the
  // list doesn't reshuffle under the user; reopening the tab re-evaluates.
  const fading = useMemo(() => (books ? forgettingScan(books) : []), [books]);
  const [cleanMsg, setCleanMsg] = useState('');
  const [recon, setRecon] = useState(null);        // quick-add ↔ recommendation plans (preview)
  const [reconPick, setReconPick] = useState(() => new Set());
  const [reconMsg, setReconMsg] = useState('');
  const [reconUndo, setReconUndo] = useState(null); // what the last reconcile changed, to put back
  // "This Book in Trackyread" entry points: focus an already-linked book, or run the link flow.
  // linkName mirrors the prop but can also be set by the embedded Files table's "link…" action.
  const [linkCs, setLinkCs] = useState(linkChecksum || null);
  const [linkName, setLinkName] = useState(linkFileName || '');
  useEffect(() => { if (focusBookId) { setTab('library'); setSelected(focusBookId); } }, [focusBookId]);
  useEffect(() => { if (focusQueueId) setTab('queue'); }, [focusQueueId]); // tab menu → "Go to queue"

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
        const cur = byDay.get(d.date) || { date: d.date, wordsRead: 0, activeSecs: 0, aloudWords: 0, aloudSecs: 0 };
        cur.wordsRead += d.wordsRead || 0;
        cur.activeSecs += d.activeTimeSecs || 0;
        cur.aloudWords += d.aloudWords || 0; // the part read aloud — kept out of pace estimates
        cur.aloudSecs += d.aloudSecs || 0;
        byDay.set(d.date, cur);
      }
      const td = daily.find((x) => x.date === localDate(Date.now())); // tracker days are local dates
      stats[cs] = {
        today: td ? { words: td.wordsRead || 0, secs: td.activeTimeSecs || 0 } : undefined, // the dashboard's Today card
        fileName: f.fileName || '',
        firstRead: daily[0]?.date || null,
        lastRead: daily.length ? daily[daily.length - 1].date : null,
        activeSecs: f.persistentActiveTimeSecs || 0,
        words: f.totalWords || 0,
        coverage: f.totalWords ? Math.min(1, (f.persistentWordsRead || 0) / f.totalWords) : 0,
        pacedWords: f.persistentPacedWords ?? (f.persistentWordsRead || 0), // for WPM: ticked-as-read words excluded
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
  // Links also change from the Reading History tab (its per-file unlink), so pick those up here
  // rather than letting the Groups view show a link that is already gone.
  useEffect(() => {
    const load = () => getBinding().then(setBindMap).catch(() => {});
    window.addEventListener('tachyread-bindings-changed', load);
    return () => window.removeEventListener('tachyread-bindings-changed', load);
  }, []);

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
  const ljView = global?.ljView === 'tiles' ? 'tiles' : 'table'; // Library list: table vs cover-tile grid
  // Reverse binding (book id → file checksum) + per-book reading facts for the table's File/Started/%.
  const csForBook = useMemo(() => {
    const m = {};
    for (const [cs, id] of Object.entries(bindMap || {})) m[id] = cs;
    return m;
  }, [bindMap]);
  const fileFacts = (b) => fileStats[csForBook[b.id]] || null;
  // Unfinished reads you've drifted away from — anchored on when each book's file was last read.
  const drifting = useMemo(() => {
    if (!books) return [];
    const lastReadOf = {};
    for (const b of books) { const lr = fileStats[csForBook[b.id]]?.lastRead; if (lr) lastReadOf[b.id] = lr; }
    return driftingScan(books, lastReadOf);
  }, [books, fileStats, csForBook]);
  const filtered = useMemo(() => {
    if (!books) return [];
    let base = filterBooks(books, flt);
    // Column filters (header row): text includes on title/author, exact on the rest.
    const tq = textMatcher(colF.title).test, aq = textMatcher(colF.author).test;
    base = base.filter((b) => {
      if (colF.status !== 'all' && readStatus(b) !== colF.status) return false;
      if (tq && !tq(`${b.title || ''} ${b.series || ''}`)) return false;
      if (aq && !aq(b.author || '')) return false;
      const fs = fileStats[csForBook[b.id]];
      if (!inDates(fs?.firstRead, ...colF.started) || !inRange(fs ? (fs.coverage || 0) * 100 : null, ...colF.pct)) return false;
      if (!inRange(b.difficultyLevel, ...colF.diff) || !inRange(b.recScore, ...colF.rec) || !inRange(b.pages, ...colF.pages) || !inRange(pubYear(b), ...colF.pub)) return false;
      if (!inDates(finishMs(b) != null ? new Date(finishMs(b)).toISOString() : '', ...colF.finished)) return false;
      if (colF.genre !== 'all' && (b.genre || '') !== colF.genre) return false;
      if (colF.type !== 'all' && contentType(b) !== colF.type) return false;
      if (colF.file !== 'all' && !!csForBook[b.id] !== (colF.file === 'linked')) return false;
      return true;
    });
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
      file: (a, b) => (csForBook[b.id] ? 1 : 0) - (csForBook[a.id] ? 1 : 0),
      started: (a, b) => String(fileStats[csForBook[b.id]]?.firstRead || '').localeCompare(String(fileStats[csForBook[a.id]]?.firstRead || '')),
      pct: (a, b) => (fileStats[csForBook[b.id]]?.coverage || 0) - (fileStats[csForBook[a.id]]?.coverage || 0),
    }[sort.key] || (() => 0);
    const sorted = [...base].sort(cmp);
    return sort.dir < 0 ? sorted.reverse() : sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, flt, colF, sort, csForBook, fileStats]);
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
  const linkedIds = useMemo(() => new Set(Object.values(bindMap || {})), [bindMap]);
  async function setGoalTarget(year, target) {
    const next = { ...(goals || {}) };
    if (target > 0) next[year] = target; else delete next[year];
    await saveLibraryRef('goals', next);
    setGoals(next);
  }
  // One-tap reshelving (queue / start reading / abandon / finish / back to to-read) from any list row.
  async function shelve(book, status) {
    const next = setReadStatus(book, status, todayISO());
    await saveLibraryBook(next);
    // "On deck" anywhere in the tracker = the On deck queue on the Queues tab (the only kind of queue).
    if (status === 'queue') {
      const qs = (await getLibraryRef('queues')) || [];
      await saveLibraryRef('queues', addToDeck(qs, books.map((b) => (b.id === book.id ? next : b)), book.id));
    }
    await reload();
  }
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
    let qs = (await getLibraryRef('queues')) || [];
    const qs0 = qs;
    for (const g of cleanup.dups) {
      await saveLibraryBook(g.merged);
      for (const dropId of g.dropIds) {
        for (const [cs, id] of Object.entries(bindMap || {})) if (id === dropId) await setBinding(cs, g.keepId);
        qs = swapQueueId(qs, dropId, g.keepId).queues; // a queued copy stays queued as the keeper
        await deleteLibraryBook(dropId);
      }
      n++;
    }
    if (qs !== qs0) await saveLibraryRef('queues', qs);
    setCleanMsg(`Applied ${n} fix${n === 1 ? '' : 'es'}${cleanup.undatable.length ? ` · ${cleanup.undatable.length} undated finish(es) left as-is` : ''}.`);
    setCleanup(null); await reload();
  }
  // ── Quick-added copies of recommended books ───────────────────────────────────────────────────
  // A recommendation (good metadata) and the entry "Add to Trackyread" made when its file was opened
  // (the one you read and queued). Each plan says exactly what will happen; nothing changes until
  // applied; the retired entry is kept as a tombstone plus a snapshot on the kept one; ↶ undoes it.
  const nameOfCs = (cs) => fileStats[cs]?.fileName || docMeta.find((d) => d.checksum === cs)?.fileName || `${String(cs).slice(0, 8)}…`;
  // One pair's preview: what changes on the kept entry, where the file link and queue entry end up.
  function planFor({ quick, keep, authorHit = true, alternatives = [], manual = false }, qs, groups) {
    const csQ = Object.entries(bindMap || {}).filter(([, id]) => id === quick.id).map(([cs]) => cs);
    const csK = Object.entries(bindMap || {}).filter(([, id]) => id === keep.id).map(([cs]) => cs);
    const merged = mergeQuickInto(keep, quick);
    let fileNote = 'no linked file';
    if (csQ.length && !csK.length) fileNote = `${csQ.map(nameOfCs).join(', ')} becomes the kept entry’s linked file`;
    else if (csQ.length && csK.length) {
      const g = groupFiles(groups, [...csK, ...csQ], keep.title, csK[0], 0);
      fileNote = `both files stay linked (${[...csK, ...csQ].map(nameOfCs).join(' + ')}) and ${g.made ? `become one book group “${keep.title}”` : `join book group “${g.group.name}”`} — shared reading position`;
    }
    return { id: quick.id, quick, keep, merged, authorHit, alternatives, manual, diff: bookDiff(keep, merged), csQ, csK, fileNote, queueNote: swapQueueId(qs, quick.id, keep.id).note };
  }
  async function scanRecon() {
    const qs = (await getLibraryRef('queues')) || [];
    const groups = global?.bookGroups || [];
    const manual = (recon || []).filter((pl) => pl.manual); // pairs you picked yourself survive a rescan
    const found = findQuickAddPairs(books, bindMap || {}).filter((pr) => !manual.some((m) => m.id === pr.quick.id));
    // Pairs the cowork "Spot likely duplicates" operation suggested (🤖) — same preview, never ticked.
    const live = new Map(books.filter((b) => !b.deleted).map((b) => [b.id, b]));
    const taken = new Set([...manual, ...found.map((pr) => ({ id: pr.quick.id }))].map((x) => x.id));
    const fromAi = (ai?.dupeSuggestions || []).filter((d) => live.has(d.keepId) && live.has(d.foldId) && !taken.has(d.foldId) && taken.add(d.foldId))
      .map((d) => ({ ...planFor({ quick: live.get(d.foldId), keep: live.get(d.keepId) }, qs, groups), aiWhy: d.why || 'suggested by the cowork agent' }));
    const plans = [...manual, ...found.map((pr) => planFor(pr, qs, groups)), ...fromAi];
    setRecon(plans);
    setReconPick(new Set(plans.filter((pl) => pl.authorHit && !pl.alternatives.length && !pl.aiWhy).map((pl) => pl.id))); // the sure ones ticked; AI suggestions never pre-ticked
    setReconMsg(plans.length ? '' : 'No quick-added copies of recommended books found. ✅');
  }
  // Manual pairing, for when the scan misses or mismatches: pick the entry to KEEP and the one to fold
  // into it; it joins the list (ticked) with the same preview and the same apply / undo.
  const [manKeep, setManKeep] = useState('');
  const [manFold, setManFold] = useState('');
  const [reconOpen, setReconOpen] = useState(null); // plan id whose details row is expanded
  const bookByLabel = (label) => {
    const m = /\[([^\]]+)\]$/.exec(String(label).trim());
    return m ? books.find((b) => b.id === m[1] && !b.deleted) || null : null;
  };
  async function addManualPair() {
    const keep = bookByLabel(manKeep), quick = bookByLabel(manFold);
    if (!keep || !quick) { setReconMsg('Pick both entries from the suggestions (start typing a title).'); return; }
    if (keep.id === quick.id) { setReconMsg('Those are the same entry.'); return; }
    const qs = (await getLibraryRef('queues')) || [];
    const pl = planFor({ quick, keep, manual: true }, qs, global?.bookGroups || []);
    setRecon((r) => [pl, ...(r || []).filter((x) => x.id !== quick.id)]);
    setReconPick((s0) => new Set([...s0, quick.id]));
    setManKeep(''); setManFold('');
    setReconMsg(`Added “${quick.title}” → “${keep.title}” to the list below — check its row, then reconcile.`);
  }
  async function applyRecon() {
    const plans = (recon || []).filter((pl) => reconPick.has(pl.id));
    if (!plans.length) return;
    const qs0 = (await getLibraryRef('queues')) || [];
    const groups0 = global?.bookGroups || [];
    let qs = qs0, groups = groups0;
    const undo = { books: [], bindings: [], queues: qs0, groups: groups0 };
    const latest = new Map(); // one recommendation can absorb several quick copies
    const bm = { ...(bindMap || {}) }; // links as they stand mid-apply
    for (const pl of plans) {
      const keep = latest.get(pl.keep.id) || pl.keep;
      const csK = Object.entries(bm).filter(([, id]) => id === keep.id).map(([cs]) => cs);
      if (!undo.books.some((b) => b.id === keep.id)) undo.books.push(pl.keep);
      undo.books.push(pl.quick);
      const merged = mergeQuickInto(keep, pl.quick);
      await saveLibraryBook(merged);
      latest.set(keep.id, merged);
      if (pl.csQ.length && csK.length) {
        const fs = (cs) => fileStats[cs]?.coverage || 0;
        const all = [...new Set([...csK, ...pl.csQ])];
        groups = groupFiles(groups, all, keep.title, [...all].sort((a, b) => fs(b) - fs(a))[0], Date.now()).groups;
      }
      for (const cs of pl.csQ) { undo.bindings.push([cs, pl.quick.id]); await setBinding(cs, keep.id); bm[cs] = keep.id; }
      qs = swapQueueId(qs, pl.quick.id, keep.id).queues;
      await deleteLibraryBook(pl.quick.id);
    }
    await saveLibraryRef('queues', qs);
    if (groups !== groups0) onPatch?.({ bookGroups: groups });
    setReconUndo(undo);
    setReconMsg(`Reconciled ${plans.length} pair${plans.length === 1 ? '' : 's'} — each quick entry is folded into its recommendation (snapshot kept on it). ↶ Undo puts everything back.`);
    setRecon(null);
    setBindMap(await getBinding());
    await reload();
  }
  async function undoRecon() {
    const u = reconUndo;
    if (!u) return;
    for (const b of u.books) await saveLibraryBook({ ...b, deleted: false });
    for (const [cs, id] of u.bindings) await setBinding(cs, id);
    await saveLibraryRef('queues', u.queues);
    onPatch?.({ bookGroups: u.groups });
    setReconUndo(null);
    setReconMsg('Undone — both entries, their file links, queues and book groups are back as they were.');
    setBindMap(await getBinding());
    await reload();
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

  // ── Miscategorised content ───────────────────────────────────────────────────────────────────
  // Content types come from import guesses, so the Dashboard's long/short/AI splits are only as
  // honest as those guesses. Scan proposes; nothing changes until you tick and apply.
  function scanTypes() {
    const found = scanMiscategorized(books || []);
    setRecat(found);
    setRecatPick(new Set(found.map((s) => s.id))); // everything ticked — it's a review list, not a quiz
    setRecatMsg(found.length ? '' : 'Every record’s content type matches its evidence. ✅');
  }
  async function applyRecatPicks() {
    const accepted = (recat || []).filter((s) => recatPick.has(s.id));
    const updated = applyRecat(books || [], accepted);
    for (const b of updated) await saveLibraryBook(b);
    setRecatMsg(`Recategorised ${updated.length} record${updated.length === 1 ? '' : 's'}. Types you set are locked, so the scan won’t re-flag them.`);
    setRecat(null); setRecatPick(new Set());
    await reload();
  }

  const empty = books && books.length === 0;
  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'library', label: `Library${books ? ` (${books.length})` : ''}` },
    { id: 'queue', label: 'Queues' },
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
    <Dialog title="Trackyread" onClose={handleClose} width={tab === 'queue' ? 1500 : 880} buttons={<button onClick={handleClose}>Close</button>}>
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
              <TodayCard books={books} goals={goals} dayAgg={dayAgg} fileStats={fileStats} bindMap={bindMap || {}} linkedIds={linkedIds} openChecksums={openChecksums}
                onOpenBook={(id) => { setTab('library'); setSelected(id); }} onOpenFile={async (cs) => { if (await openRecent(cs)) handleClose(); }} onQueues={() => setTab('queue')} />
              <GoalCard books={books} goals={goals} onSetGoal={setGoalTarget} />
              <WordsGoalCard books={books} goals={goals} dayAgg={dayAgg} linkedIds={linkedIds} onSetGoal={setGoalTarget} />
              <div className="rh-stat-grid">
                <Stat v={stats.total} l="books" />
                <Stat v={stats.finished} l="finished" sub={`${stats.reading} reading${stats.abandoned ? ` · ${stats.abandoned} abandoned` : ''}`} />
                <Stat v={stats.queue} l="on deck" sub={`${stats.toread.toLocaleString()} to read`} />
                <Stat v={stats.fiction} l="fiction" sub={`${stats.nonfiction} non-fiction`} />
                <Stat v={stats.words ? (stats.words / 1e6).toFixed(1) + 'M' : '0'} l="words read" />
                <Stat v={stats.pages ? stats.pages.toLocaleString() : '0'} l="pages read" />
              </div>
              <label className="inline-check" title="Break the totals out by long-form vs short-form/articles vs AI-generated content">
                <input type="checkbox" checked={!!global?.ljSplitTypes} onChange={(e) => onPatch?.({ ljSplitTypes: e.target.checked })} /> Split by content type
              </label>
              {global?.ljSplitTypes && <TypeSplit books={books} />}

              <div className="rh-section-h">Difficulty of finished books</div>
              <div className="lj-diffbars">
                {[1, 2, 3, 4, 5].map((d) => {
                  const n = stats.byDifficulty[d] || 0;
                  const max = Math.max(1, ...Object.values(stats.byDifficulty));
                  return <div key={d} className="lj-diffbar" title={`${n} book(s)`}><span className="lj-diffbar-fill" style={{ height: `${(n / max) * 100}%` }} /><em>{d}</em></div>;
                })}
              </div>

              {ai?.analysis && (<><div className="rh-section-h">AI analysis{ai.updatedAt ? <span className="lj-analysis-time"> · {fmtDateTime(ai.updatedAt)}</span> : null}</div><p className="lj-analysis">{ai.analysis}</p></>)}
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

              {drifting.length > 0 && (
                <>
                  <div className="rh-section-h">🌫️ Drifting — unfinished reads going cold</div>
                  <p className="settings-note">
                    Books you’re partway through but haven’t opened in a while. The risk here isn’t forgetting
                    the gist — it’s losing your place and the thread. Resume before they go cold.
                  </p>
                  <ul className="lj-fading">
                    {drifting.slice(0, driftAll ? drifting.length : 6).map((d) => {
                      const cov = Math.round((fileStats[csForBook[d.id]]?.coverage || 0) * 100);
                      return (
                        <li key={d.id} className={`lj-fade-${d.tier === 'cold' ? 'faded' : 'fading'}`}>
                          <span className="lj-fade-bar" title={`${cov}% read so far`}>
                            <span className="lj-fade-fill" style={{ width: `${cov}%` }} />
                          </span>
                          <span className="lj-fade-pct">{cov}%</span>
                          <span className="lj-fade-title"><b>{d.title}</b>{d.author ? ` — ${d.author}` : ''}</span>
                          <span className="settings-note lj-fade-meta">
                            {d.tier === 'cold' ? 'gone cold' : 'drifting'} · {d.daysSince}d untouched
                          </span>
                          <button
                            className="link-btn"
                            title="Bring it back on deck to resume"
                            onClick={async () => { const b = books.find((x) => x.id === d.id); if (b) await shelve(b, 'queue'); }}
                          >📋 Resume</button>
                        </li>
                      );
                    })}
                  </ul>
                  {drifting.length > 6 && (
                    <button className="link-btn" onClick={() => setDriftAll((v) => !v)}>{driftAll ? 'Show fewer' : `Show all ${drifting.length}`}</button>
                  )}
                </>
              )}

              <div className="rh-section-h">🧠 Fading — finished books you may be forgetting</div>
              <p className="settings-note">
                Estimated from a forgetting curve: how much you’d likely still have of each finished book,
                decaying with time since you last read it and firming up with every re-read. Leads with the
                ones still worth a quick refresh before they slip further.
              </p>
              {fading.length === 0 ? (
                <p className="settings-note">Nothing fading — your finished books are either fresh or already re-read. ✅</p>
              ) : (
                <ul className="lj-fading">
                  {fading.slice(0, fadingAll ? fading.length : 8).map((f) => (
                    <li key={f.id} className={`lj-fade-${f.tier}`}>
                      <span className="lj-fade-bar" title={`~${Math.round(f.retention * 100)}% retained`}>
                        <span className="lj-fade-fill" style={{ width: `${Math.round(f.retention * 100)}%` }} />
                      </span>
                      <span className="lj-fade-pct">{Math.round(f.retention * 100)}%</span>
                      <span className="lj-fade-title"><b>{f.title}</b>{f.author ? ` — ${f.author}` : ''}</span>
                      <span className="settings-note lj-fade-meta">
                        {f.tier === 'faded' ? 'likely gone' : 'fading'} · {f.daysSince}d ago{f.reads > 1 ? ` · read ${f.reads}×` : ''}
                      </span>
                      <button
                        className="link-btn"
                        title="Add to the queue for a refresher read"
                        onClick={async () => { const b = books.find((x) => x.id === f.id); if (b) await shelve(b, 'queue'); }}
                      >📋 Refresh</button>
                    </li>
                  ))}
                </ul>
              )}
              {fading.length > 8 && (
                <button className="link-btn" onClick={() => setFadingAll((v) => !v)}>{fadingAll ? 'Show fewer' : `Show all ${fading.length}`}</button>
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
                <select value={flt.fnf} onChange={(e) => setFlt({ ...flt, fnf: e.target.value })}>
                  <option value="all">Fiction + NF</option><option value="F">Fiction</option><option value="NF">Non-fiction</option>
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
                {anySet(colF) && <button onClick={() => { setColF(NO_COLF); setLimit(100); }} title="Clear the filters under the table's column headers">Clear column filters</button>}
                <span className="lj-viewtoggle" role="tablist" aria-label="List view">
                  <button className={ljView !== 'tiles' ? 'on' : ''} onClick={() => onPatch?.({ ljView: 'table' })} title="Table view">▤ Table</button>
                  <button className={ljView === 'tiles' ? 'on' : ''} onClick={() => onPatch?.({ ljView: 'tiles' })} title="Cover tile grid">▦ Tiles</button>
                </span>
                {ljView !== 'tiles' && (
                  <label className="inline-check" title="Show cover thumbnails in the list — loads them from covers.openlibrary.org for visible books with an ISBN or fetched cover">
                    <input type="checkbox" checked={showCovers} onChange={(e) => onPatch?.({ ljCovers: e.target.checked })} /> Covers
                  </label>
                )}
                <CoverBatchButton books={filtered} legacyOf={(b) => bookCoverUrl(b)} apiKey={global?.anthropicKey} onSaveBook={saveBook} onReload={reload} />
                <span className="lj-spacer" />
                <button onClick={() => setAdding(true)}>+ Add book</button>
                <button onClick={() => exportView('json')}>Export view (JSON)</button>
                <button onClick={() => exportView('md')}>Export view (Markdown)</button>
              </div>

              {adding && <BookEditor book={{ id: '', title: '', author: '', genre: '', fnf: 'F', type: 'long' }} isNew apiKey={global?.anthropicKey} onCancel={() => setAdding(false)} onSave={async (b) => { await saveBook({ ...b, id: deriveId(b) }); setAdding(false); }} />}
              {selBook && <BookEditor book={selBook} books={books} docMeta={docMeta} bindMap={bindMap} fileStats={fileStats} groups={global?.bookGroups} crossNotes={crossNotes} apiKey={global?.anthropicKey} onSaveCross={async (n) => { await saveCrossNote(n); setCrossNotes(await getCrossNotes()); }} onDeleteCross={async (id) => { await deleteCrossNote(id); setCrossNotes(await getCrossNotes()); }} onBind={bind} onProgress={setProgressFor} onCancel={() => setSelected(null)} onSave={saveBook} onDelete={() => removeBook(selBook.id)} />}

              {ljView === 'tiles' ? (
                <div className="lj-tilegrid">
                  {shown.map((b) => {
                    const st = readStatus(b);
                    const src = bookCoverSrc(b) || bookCoverUrl(b, 'M') || proceduralCover({ title: b.title, author: b.author, genre: b.genre });
                    return (
                      <button key={b.id} className={`lj-tile${selected === b.id ? ' on' : ''}`} onClick={() => { setSelected(selected === b.id ? null : b.id); setAdding(false); }} title={`${b.title}${b.author ? ' — ' + b.author : ''}`}>
                        <img className="lj-tile-cover" src={src} alt="" loading="lazy" onError={(e) => { e.target.style.opacity = 0.2; }} />
                        <span className={`lj-tile-status lj-${st}`} title={STATUS_LABEL[st]}>{STATUS_LABEL[st].split(' ')[0]}</span>
                        <span className="lj-tile-title">{b.title}</span>
                        {b.author && <span className="lj-tile-author">{b.author}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
              <div className="lj-tablewrap">
                <table className="lj-table">
                  <thead>
                    <tr>
                      {[['status', 'St'], ['title', 'Title'], ['author', 'Author'], ['genre', 'Genre'], ['type', 'Type'], ['file', '📄'], ['started', 'Started'], ['pct', '%'], ['diff', 'D'], ['rec', '★'], ['pages', 'Pages'], ['pub', 'Pub'], ['finished', 'Finished']].map(([k, l]) => (
                        <th key={k} className={sort.key === k ? 'on' : ''} onClick={() => sortBy(k)} title="Click to sort (click again to flip)">{l}{sortMark(k)}</th>
                      ))}
                      <th aria-label="Shelf actions" />
                    </tr>
                    {/* Column filters live right under their headers. */}
                    <tr className="lj-filter-row">
                      <th>
                        <select value={colF.status} onChange={(e) => { setColF({ ...colF, status: e.target.value }); setLimit(100); }} title="Filter by status">
                          <option value="all">all</option><option value="finished">✅</option><option value="reading">📖</option><option value="queue">📋</option><option value="toread">🔖</option><option value="abandoned">✕</option>
                        </select>
                      </th>
                      <th><TextF value={colF.title} onChange={(v) => { setColF({ ...colF, title: v }); setLimit(100); }} label="title or series" /></th>
                      <th><TextF value={colF.author} onChange={(v) => { setColF({ ...colF, author: v }); setLimit(100); }} label="author" /></th>
                      <th>
                        <select value={colF.genre} onChange={(e) => { setColF({ ...colF, genre: e.target.value }); setLimit(100); }} title="Filter by genre">
                          <option value="all">all</option>{genreOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </th>
                      <th>
                        <select value={colF.type} onChange={(e) => { setColF({ ...colF, type: e.target.value }); setLimit(100); }} title="Filter by content type">
                          <option value="all">all</option>{Object.entries(CONTENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </th>
                      <th>
                        <select value={colF.file} onChange={(e) => { setColF({ ...colF, file: e.target.value }); setLimit(100); }} title="Filter by file link">
                          <option value="all">all</option><option value="linked">📄</option><option value="unlinked">—</option>
                        </select>
                      </th>
                      {[['started', 'Started', 'date'], ['pct', '% read'], ['diff', 'difficulty'], ['rec', 'rec score'], ['pages', 'pages'], ['pub', 'year published'], ['finished', 'Finished', 'date']].map(([k, label, kind]) => (
                        <th key={k}>{kind === 'date'
                          ? <DateF value={colF[k]} onChange={(v) => { setColF({ ...colF, [k]: v }); setLimit(100); }} label={label} />
                          : <RangeF value={colF[k]} onChange={(v) => { setColF({ ...colF, [k]: v }); setLimit(100); }} label={label} />}</th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((b) => {
                      const st = readStatus(b);
                      const rc = finishCount(b);
                      const tgs = bookTags(b);
                      const cov = showCovers ? (bookCoverSrc(b) || bookCoverUrl(b, 'S')) : null;
                      const cs = csForBook[b.id];
                      const ff = fileFacts(b);
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
                          <td onClick={(e) => e.stopPropagation()}>
                            {cs && (
                              <button
                                className="lj-file-open"
                                title={`Linked file: ${ff?.fileName || cs.slice(0, 8)} — open it in the reader`}
                                onClick={async () => { if (await openRecent(cs)) handleClose(); }}
                              >📄</button>
                            )}
                          </td>
                          <td>{ff?.firstRead || ''}</td>
                          <td>{ff && ff.coverage > 0 ? `${Math.round(ff.coverage * 100)}%` : ''}</td>
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
              )}
              {filtered.length > limit && (
                <div className="lj-inline">
                  <button className="lj-more" onClick={() => setLimit(limit + 200)}>Load more ({filtered.length - limit} left)</button>
                  <button className="lj-more" onClick={() => setLimit(filtered.length)}>Load all {filtered.length}</button>
                </div>
              )}
            </div>
          )}

          {tab === 'queue' && <QueueView key={focusQueueId || 'q'} initialSel={focusQueueId} books={books} fileStats={fileStats} bindMap={bindMap || {}} openChecksums={openChecksums} dayAgg={dayAgg} onOpen={(id) => { setTab('library'); setSelected(id); }} />}
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
          {tab === 'analytics' && <AnalyticsView books={books} dayAgg={dayAgg} ai={ai} splitTypes={!!global?.ljSplitTypes} onSplitTypes={(v) => onPatch?.({ ljSplitTypes: v })} />}
          {tab === 'authors' && <RefList kind="author" items={refs.authors} books={books} onOpen={(name) => { setColF({ ...colF, author: name, genre: 'all' }); setLimit(100); setTab('library'); }} />}
          {tab === 'genres' && <RefList kind="genre" items={refs.genres} subitems={refs.subgenres} books={books} onOpen={(name) => { setColF({ ...colF, genre: name, author: '' }); setLimit(100); setTab('library'); }} />}
          {tab === 'archetype' && <ArchetypeView books={books} />}
          {tab === 'constellation' && <ConstellationView books={books} ai={ai} />}
          {tab === 'ai' && <AiView books={books} ai={ai} global={global} bindMap={bindMap || {}} onReload={reload} />}

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

              <div className="rh-section-h">Reconcile quick-added copies</div>
              <p className="settings-note">
                Finds books that exist twice: a recommendation with good details (author, ISBN, cover…) and a
                second entry made by <i>Add to Trackyread</i> when you opened its file — titled from the file
                name, and usually the one you read and queued. Each pair shows exactly what will happen. The
                recommendation is kept and takes over the reading state, the file link and the queue place;
                the quick entry is retired but kept as a snapshot on it, and ↶ Undo restores everything.
              </p>
              <div className="lj-inline">
                <button onClick={scanRecon}>Scan for quick-added copies</button>
                {(ai?.dupeSuggestions || []).length > 0 && <span className="settings-note" style={{ margin: 0 }}>🤖 {ai.dupeSuggestions.length} pair{ai.dupeSuggestions.length === 1 ? '' : 's'} suggested by the cowork agent — included in the scan</span>}
                {reconUndo && <button onClick={undoRecon}>↶ Undo last reconcile</button>}
                {reconMsg && <span className="settings-note">{reconMsg}</span>}
              </div>
              <form className="lj-inline lj-recon-man" onSubmit={(e) => { e.preventDefault(); addManualPair(); }}>
                <span className="settings-note" style={{ margin: 0 }}>Pair two yourself — keep</span>
                <input list="lj-recon-books" value={manKeep} onChange={(e) => setManKeep(e.target.value)} placeholder="entry to keep (good details)…" aria-label="Entry to keep" />
                <span className="settings-note" style={{ margin: 0 }}>← fold in</span>
                <input list="lj-recon-books" value={manFold} onChange={(e) => setManFold(e.target.value)} placeholder="entry to retire…" aria-label="Entry to fold in and retire" />
                <button type="button" title="Swap which entry is kept" onClick={() => { setManKeep(manFold); setManFold(manKeep); }}>⇄</button>
                <button type="submit" disabled={!manKeep || !manFold}>＋ Add pair</button>
                <datalist id="lj-recon-books">
                  {books.filter((b) => !b.deleted).map((b) => <option key={b.id} value={`${b.title}${b.author ? ` — ${b.author}` : ''} [${b.id}]`} />)}
                </datalist>
              </form>
              {recon && recon.length > 0 && (
                <div className="lj-cleanup lj-recon">
                  <div className="lj-q-box lj-recon-box">
                    <table className="lj-cand lj-recon-table">
                      <colgroup><col className="c-tick" /><col className="c-keep" /><col className="c-fold" /><col className="c-file" /><col className="c-queue" /><col className="c-chg" /><col className="c-more" /></colgroup>
                      <thead><tr><th aria-label="Reconcile" /><th>Keep</th><th>Fold in &amp; retire</th><th>File link</th><th>Queue</th><th>Changes</th><th aria-label="Details" /></tr></thead>
                      <tbody>
                        {recon.map((pl) => {
                          const warn = [!pl.authorHit && 'matched on the title alone — the file name doesn’t mention the author', pl.alternatives.length && `also matches ${pl.alternatives.map((b) => b.title).join('; ')}`].filter(Boolean);
                          const open = reconOpen === pl.id;
                          return (
                            <Fragment key={pl.id}>
                              <tr className={warn.length ? 'warn' : ''}>
                                <td><input type="checkbox" checked={reconPick.has(pl.id)} aria-label={`Reconcile “${pl.quick.title}” into “${pl.keep.title}”`}
                                  onChange={() => setReconPick((s0) => { const s1 = new Set(s0); if (s1.has(pl.id)) s1.delete(pl.id); else s1.add(pl.id); return s1; })} /></td>
                                <td title={`${pl.keep.title} — ${pl.keep.author || ''}${pl.keep.isbn ? ` · ISBN ${pl.keep.isbn}` : ''}`}><b>{pl.keep.title}</b>{pl.keep.author ? <span className="lj-qdim"> — {pl.keep.author}</span> : ''}</td>
                                <td title={pl.quick.title}>{warn.length ? <span title={warn.join(' · ')}>⚠ </span> : ''}{pl.manual ? <span title="Paired by you">✋ </span> : ''}{pl.aiWhy ? <span title={`Suggested by the cowork agent: ${pl.aiWhy}`}>🤖 </span> : ''}{pl.quick.title} <span className="lj-qdim">({STATUS_LABEL[readStatus(pl.quick)].replace(/^\S+\s/, '')})</span></td>
                                <td title={pl.fileNote}>{pl.csQ.length ? (pl.csK.length ? '🔗 both linked + grouped' : `📎 ${pl.csQ.map(nameOfCs).join(', ')}`) : '—'}</td>
                                <td title={pl.queueNote}>{pl.queueNote}</td>
                                <td title={pl.diff.map((d) => `${d.key}: ${fmtVal(d.from)} → ${fmtVal(d.to)}`).join('\n')}>{pl.diff.length ? `${pl.diff.length} field${pl.diff.length === 1 ? '' : 's'}: ${pl.diff.map((d) => d.key).join(', ')}` : 'none'}</td>
                                <td><button className="lj-recon-more" onClick={() => setReconOpen(open ? null : pl.id)} aria-expanded={open} title="Details">{open ? '▾' : '▸'}</button></td>
                              </tr>
                              {open && (
                                <tr className="lj-recon-detail"><td /><td colSpan={6}>
                                  <ul className="lj-clean-list">
                                    <li>📎 {pl.fileNote}</li>
                                    <li>📋 Queue: {pl.queueNote}</li>
                                    <li>✏️ {pl.diff.length ? pl.diff.map((d) => <span key={d.key} className="lj-recon-diff"><code>{d.key}</code> {fmtVal(d.from)} → <b>{fmtVal(d.to)}</b></span>) : 'no field changes on the kept entry'}</li>
                                    <li>🗃 “{pl.quick.title}” is retired (kept as a tombstone + a snapshot in the kept entry’s history)</li>
                                    {warn.map((w) => <li key={w} className="lj-recon-warn">⚠ {w}. Check it’s the same book.</li>)}
                                    {pl.aiWhy && <li>🤖 Suggested by the cowork agent: {pl.aiWhy}</li>}
                                  </ul>
                                </td></tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="lj-inline">
                    <button className="toggle-on" disabled={!reconPick.size} onClick={applyRecon}>Reconcile {reconPick.size} ticked</button>
                    <button onClick={() => setReconPick(new Set(recon.map((pl) => pl.id)))}>Tick all</button>
                    <button onClick={() => setReconPick(new Set())}>Untick all</button>
                    <button onClick={() => { setRecon(null); setReconMsg(''); }}>Dismiss</button>
                    <span className="settings-note" style={{ margin: 0 }}>⚠ = less certain (left unticked) · ✋ = paired by you · 🤖 = suggested by the cowork agent (left unticked) · hover a cell or ▸ for the full details</span>
                  </div>
                </div>
              )}

              <div className="rh-section-h">Fix miscategorised content</div>
              <p className="settings-note">
                Content types mostly come from how a record was imported, so the Dashboard’s long / short /
                AI-generated splits inherit those guesses. This looks for records whose evidence — length,
                author, title, genre — disagrees with their label. Every row says why, nothing changes until
                you apply, and a type you set by hand is never re-flagged.
              </p>
              <div className="lj-inline">
                <button onClick={scanTypes}>Scan content types</button>
                {recatMsg && <span className="settings-note">{recatMsg}</span>}
              </div>
              {recat && recat.length > 0 && (
                <div className="lj-cleanup">
                  <p className="settings-note">
                    <b>{recat.length}</b> record{recat.length === 1 ? '' : 's'} look mislabelled:{' '}
                    {Object.entries(recatSummary(recat)).map(([t, n]) => `${n} → ${CONTENT_TYPES[t] || t}`).join(' · ')}
                  </p>
                  <div className="lj-inline">
                    <button onClick={() => setRecatPick(new Set(recat.map((x) => x.id)))}>Select all</button>
                    <button onClick={() => setRecatPick(new Set())}>Select none</button>
                  </div>
                  <table className="lj-recat">
                    <thead><tr><th /><th>Title</th><th>Now</th><th>Suggested</th><th>Why</th></tr></thead>
                    <tbody>
                      {recat.map((sg) => (
                        <tr key={sg.id} className={recatPick.has(sg.id) ? 'on' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={recatPick.has(sg.id)}
                              onChange={(e) => setRecatPick((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(sg.id); else next.delete(sg.id);
                                return next;
                              })}
                            />
                          </td>
                          <td>{sg.title}{sg.author ? <span className="settings-note"> — {sg.author}</span> : null}</td>
                          <td className="lj-recat-from">{CONTENT_TYPES[sg.from] || sg.from}</td>
                          <td className="lj-recat-to">{CONTENT_TYPES[sg.to] || sg.to}</td>
                          <td className="settings-note">{sg.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="lj-inline">
                    <button className="toggle-on" disabled={!recatPick.size} onClick={applyRecatPicks}>
                      Apply {recatPick.size} change{recatPick.size === 1 ? '' : 's'}
                    </button>
                    <button onClick={() => { setRecat(null); setRecatMsg(''); }}>Dismiss</button>
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

// Downscale an uploaded image to a small JPEG data URL so many covers don't bloat the synced library.
function downscaleImage(file, maxW = 420) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / (img.width || maxW));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { resolve(cv.toDataURL('image/jpeg', 0.82)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Multi-cover gallery for one book: attach several covers (upload / URL / Open Library / procedural /
// AI-designed) and pick which is the master shown on tiles. A legacy single cover (coverUrl/coverId)
// shows as the first entry and is folded into covers[] the moment anything is changed.
function CoverGallery({ b, onChange, legacy, apiKey, model }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [url, setUrl] = useState('');
  const stored = bookCovers(b);
  // What we show: real covers[], or (when empty) the legacy cover as an implicit, not-yet-saved entry.
  const list = stored.length ? stored : (legacy ? [{ id: '__legacy', src: legacy, source: 'link', legacy: true }] : []);
  const master = bookCoverSrc(b) || legacy || null;
  // Book with the legacy cover materialised into covers[], so mutations persist it alongside new
  // ones. The legacy entry is stamped as MASTER — it's the cover the user has been seeing, and
  // adding a second cover must not silently displace it (same rule as addCover for normal books).
  const legacyEntry = stored.length || !legacy ? null : { id: coverId(legacy), src: legacy, source: 'link' };
  const materialized = legacyEntry ? { ...b, covers: [legacyEntry], coverMaster: legacyEntry.id } : b;
  const push = (cover) => onChange(addCover(materialized, cover));

  async function onUpload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy('upload'); setMsg('');
    try {
      let m = materialized;
      for (const f of files) { const src = await downscaleImage(f); const patch = addCover(m, { src, source: 'upload' }); m = { ...m, ...patch }; }
      onChange({ covers: m.covers, coverMaster: m.coverMaster });
    } catch (err) { setMsg(String(err?.message || err)); }
    setBusy(null);
  }
  function addUrl() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) && !u.startsWith('data:')) { setMsg('Enter an http(s) or data: image URL.'); return; }
    push({ src: u, source: 'link' }); setUrl(''); setMsg('');
  }
  function addProcedural() {
    push({ src: proceduralCover({ title: b.title, author: b.author, genre: b.genre }), source: 'proc' });
    setMsg('');
  }
  async function addAi() {
    if (!apiKey) { setMsg('Add your Anthropic API key in Settings to have Claude design a cover.'); return; }
    setBusy('ai'); setMsg('Claude is designing a cover…');
    try {
      const reply = await askClaude([{ role: 'user', content: coverPromptFor(b) }], { key: apiKey, model: model || 'claude-sonnet-5', maxTokens: 320, source: 'cover-design' });
      const spec = parseCoverSpec(reply);
      if (!spec) { setMsg('Could not read a cover design from the reply — try again, or use Auto.'); }
      else { push({ src: coverSpecToSvg(spec, { title: b.title, author: b.author }), source: 'ai', spec }); setMsg('AI cover added.'); }
    } catch (err) { setMsg('AI cover failed: ' + (err?.message || err)); }
    setBusy(null);
  }
  function remove(id) {
    if (id === '__legacy') { onChange({ coverUrl: '', coverId: null }); return; }
    onChange(removeCover(b, id));
  }
  function makeMaster(id) {
    if (id === '__legacy') return; // legacy is already the shown one when covers[] is empty
    onChange(setMaster(materialized.covers ? materialized : b, id));
  }

  return (
    <div className="lj-covers">
      <div className="lj-cover-grid">
        {list.length === 0 && <span className="lj-cover lj-cover-none" title="No cover yet">📕</span>}
        {list.map((c) => {
          const isMaster = c.src === master;
          return (
            <div key={c.id} className={`lj-cover-cell${isMaster ? ' master' : ''}`}>
              <img className="lj-cover" src={c.src} alt="" loading="lazy" onError={(ev) => { ev.target.style.opacity = 0.2; }} />
              <button type="button" className={`lj-cover-star${isMaster ? ' on' : ''}`} title={isMaster ? 'Master cover (shown on tiles)' : 'Make this the master cover'} onClick={() => makeMaster(c.id)}>{isMaster ? '★' : '☆'}</button>
              <button type="button" className="lj-cover-del" title="Remove this cover" onClick={() => remove(c.id)}>×</button>
              <span className="lj-cover-src">{c.legacy ? 'link' : c.source}</span>
            </div>
          );
        })}
      </div>
      <div className="lj-cover-actions">
        <label className="lj-cover-btn" title="Upload one or more images (downscaled locally)">⬆ Upload<input type="file" accept="image/*" multiple hidden onChange={onUpload} /></label>
        <button type="button" className="lj-cover-btn" disabled={busy === 'ai'} onClick={addAi} title="Have Claude design a cover (needs your API key)">✨ AI cover</button>
        <button type="button" className="lj-cover-btn" onClick={addProcedural} title="Generate a stylised cover from the book's own details — no API needed">🎨 Auto</button>
      </div>
      <div className="lj-cover-url">
        <input placeholder="Image URL…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUrl())} />
        <button type="button" onClick={addUrl} disabled={!url.trim()}>＋ Add URL</button>
      </div>
      {msg && <p className="settings-note lj-cover-msg">{msg}</p>}
    </div>
  );
}

// Batch cover generation for the books CURRENTLY IN VIEW that lack a cover — "confabulate covers for a
// subset" is just: filter the library to the subset, then Auto (procedural, instant) or AI (Claude).
function CoverBatchButton({ books, legacyOf, apiKey, model, onSaveBook, onReload }) {
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');
  const coverless = (books || []).filter((b) => !bookCoverSrc(b) && !legacyOf(b));
  if (coverless.length === 0) return <span className="settings-note" title="Every book in view already has a cover">🖼 all covered</span>;

  async function auto() {
    setBusy(true);
    for (let i = 0; i < coverless.length; i++) {
      const b = coverless[i];
      setProg(`${i + 1}/${coverless.length}`);
      await onSaveBook({ ...b, ...addCover(b, { src: proceduralCover({ title: b.title, author: b.author, genre: b.genre }), source: 'proc' }) });
    }
    setProg(''); setBusy(false); onReload?.();
  }
  async function ai() {
    if (!apiKey) { setProg('needs API key'); return; }
    setBusy(true);
    const batch = coverless.slice(0, 20); // cap the spend; re-run for more
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      setProg(`Claude ${i + 1}/${batch.length}`);
      try {
        const reply = await askClaude([{ role: 'user', content: coverPromptFor(b) }], { key: apiKey, model: model || 'claude-sonnet-5', maxTokens: 320, source: 'cover-design' });
        const spec = parseCoverSpec(reply);
        const src = spec ? coverSpecToSvg(spec, { title: b.title, author: b.author }) : proceduralCover({ title: b.title, author: b.author, genre: b.genre });
        await onSaveBook({ ...b, ...addCover(b, { src, source: spec ? 'ai' : 'proc', ...(spec ? { spec } : {}) }) });
      } catch { /* skip this one, keep going */ }
    }
    setProg(''); setBusy(false); onReload?.();
  }

  return (
    <span className="lj-coverbatch">
      <button disabled={busy} onClick={auto} title={`Generate a stylised cover for ${coverless.length} book(s) in view without one — no API`}>🎨 Auto-cover {coverless.length}</button>
      <button disabled={busy} onClick={ai} title={apiKey ? 'Have Claude design covers for the coverless books in view (up to 20)' : 'Add an Anthropic API key in Settings to use this'}>✨ AI-cover</button>
      {prog && <span className="settings-note">{prog}</span>}
    </span>
  );
}

// Inline add/edit card for one book.
function BookEditor({ book, isNew = false, books = [], docMeta = [], bindMap = {}, fileStats = {}, groups = [], crossNotes = [], apiKey, aiModel, onSaveCross, onDeleteCross, onBind, onProgress, onSave, onCancel, onDelete }) {
  const [b, setB] = useState(book);
  // Re-sync only when a DIFFERENT record is being edited. Depending on `book`'s identity blanked the
  // form mid-typing: "+ Add book" passes a fresh `{ id: '', title: '', ... }` literal, so every
  // parent re-render (this dialog subscribes to app context, which ticks while you read) looked like
  // a new record and reset every field.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setB(book); }, [book.id]);
  const status = readStatus(b);
  const set = (p) => setB({ ...b, ...p });
  // Dirty tracking: which fields differ from the record as loaded. Changed fields highlight, and
  // Save only enables once something actually changed (always enabled for a brand-new book).
  const dirtyKeys = useMemo(() => {
    const norm = (v) => (Array.isArray(v) ? JSON.stringify(v) : v == null || v === '' ? '' : String(v));
    const keys = new Set([...Object.keys(book || {}), ...Object.keys(b || {})]);
    const out = new Set();
    for (const k of keys) if (norm(book?.[k]) !== norm(b?.[k])) out.add(k);
    return out;
  }, [b, book]);
  const dcls = (...ks) => (ks.some((k) => dirtyKeys.has(k)) ? 'lj-dirty' : undefined);
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
      {/* Covers: a gallery (upload / URL / Open Library / procedural / AI-designed) with a master pick,
          plus the Open Library fetch that fills blank details alongside a cover. */}
      <div className="lj-cover-ed">
        <CoverGallery b={b} onChange={set} legacy={cover} apiKey={apiKey} model={aiModel} />
        <div className={`lj-cover-ctl ${dcls('coverUrl', 'coverId') || ''}`}>
          <button type="button" disabled={olBusy || (!b.title && !b.isbn)} title="Fetch a cover + blank details from Open Library" onClick={fetchOl}>🔎 Open Library</button>
          {olMsg && <span className="settings-note">{olMsg}</span>}
        </div>
      </div>
      <div className="lj-editor-grid">
        <label className={dcls('title')}>Title<input value={b.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className={dcls('author')}>Author<input value={b.author || ''} onChange={(e) => set({ author: e.target.value })} /></label>
        <label className={dcls('genre')}>Genre<input value={b.genre || ''} onChange={(e) => set({ genre: e.target.value })} /></label>
        <label className={dcls('subgenre')}>Subgenre<input value={b.subgenre || ''} onChange={(e) => set({ subgenre: e.target.value })} /></label>
        <label className={dcls('fnf')}>Fiction?<select value={b.fnf || ''} onChange={(e) => set({ fnf: e.target.value })}><option value="F">Fiction</option><option value="NF">Non-fiction</option></select></label>
        <label className={dcls('type')}>Content type<select value={contentType(b)} onChange={(e) => set({ type: e.target.value })}>{Object.entries(CONTENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={dcls('completion', 'inProgress', 'shelf')}>Status<select value={status} onChange={(e) => setB(applyStatus(b, e.target.value))}><option value="toread">To read</option><option value="queue">On deck</option><option value="reading">Reading</option><option value="finished">Finished</option><option value="abandoned">Abandoned</option></select></label>
        <label className={dcls('finishTime')}>Finished<input type="date" value={(finishMs(b) ? new Date(finishMs(b)).toISOString().slice(0, 10) : '')} onChange={(e) => set({ finishTime: e.target.value })} /></label>
        <label className={dcls('recBy')}>Rec. by<input value={b.recBy || ''} placeholder="Claude" onChange={(e) => set({ recBy: e.target.value })} /></label>
        <label className={dcls('rating')}>Rating<input type="number" min="0" max="5" value={bookRating(b) || ''} onChange={(e) => set({ rating: Number(e.target.value) })} /></label>
        <label className={dcls('difficultyLevel')}>Difficulty<input type="number" min="1" max="5" value={b.difficultyLevel || ''} onChange={(e) => set({ difficultyLevel: Number(e.target.value) })} /></label>
        <label className={dcls('recScore')}>Rec score<input type="number" min="0" max="10" value={b.recScore || ''} onChange={(e) => set({ recScore: Number(e.target.value) })} /></label>
        <label className={dcls('pages')}>Pages<input type="number" value={b.pages || ''} onChange={(e) => set({ pages: Number(e.target.value) })} /></label>
        <label className={dcls('words')}>Words<input type="number" value={b.words || ''} placeholder={b.pages ? `~${bookWordCount({ pages: b.pages })}` : ''} onChange={(e) => set({ words: Number(e.target.value) })} /></label>
        <label className={dcls('pubDate')}>Published<input value={b.pubDate || ''} onChange={(e) => set({ pubDate: e.target.value })} /></label>
        <label className={dcls('isbn')}>ISBN<input value={b.isbn || ''} onChange={(e) => set({ isbn: e.target.value })} /></label>
        <label className={dcls('tags')}>Tags<input value={Array.isArray(b.tags) ? b.tags.join(', ') : (b.tags || '')} placeholder="comma, separated" onChange={(e) => set({ tags: e.target.value })} /></label>
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
          <label className={dcls('startTime')}>Started
            <span className="lj-inline">
              <input type="date" value={b.startTime || ''} onChange={(e) => set({ startTime: e.target.value })} />
              {docStats?.firstRead && b.startTime !== docStats.firstRead && <button type="button" className="link-btn" title="Use the first date you read the linked document" onClick={() => set({ startTime: docStats.firstRead })}>auto</button>}
            </span>
          </label>
          <label className={dcls('readSecs')}>Time reading (min)
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

      <label className={`lj-editor-notes ${dcls('notes') || ''}`}>Notes<textarea rows={3} value={b.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
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
        <button
          className="primary"
          disabled={!b.title || (!isNew && dirtyKeys.size === 0)}
          title={!isNew && dirtyKeys.size === 0 ? 'No changes yet — edit a field first' : undefined}
          onClick={() => onSave({ ...b, tags: bookTags(b) })}
        >
          {isNew ? 'Add' : dirtyKeys.size ? `Save ${dirtyKeys.size} change${dirtyKeys.size === 1 ? '' : 's'}` : 'Save'}
        </button>
        <button onClick={onCancel}>Cancel</button>
        {!isNew && onDelete && <button className="lj-danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

// Authors / Genres reference tab — a sortable table with per-row completion bars and best-effort
// Goodreads / Wikipedia search links. Falls back to book-derived counts when no reference data was
// imported; a row expands to show its imported reference fields.
function RefList({ kind, items, subitems, books, onOpen }) {
  const [q, setQ] = useSessionState(`tr-ref-${kind}-q`, '');
  const [rf, setRf] = useSessionState(`tr-ref-${kind}-rf`, { books: ['', ''], finished: ['', ''], pct: ['', ''] }); // column ranges
  const [open, setOpen] = useState(null);
  const [rsort, setRsort] = useState({ key: 'books', dir: 1 });
  const nameKey = kind === 'author' ? 'author' : 'genre';
  const derived = useMemo(() => {
    if (items?.length) return null;
    const counts = {};
    for (const b of books) { const k = b[nameKey]; if (k) counts[k] = (counts[k] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ [nameKey]: name, count }));
  }, [items, books, nameKey]);
  const rows = useMemo(() => {
    const base = (items || derived || [])
      .filter((it) => { const t = textMatcher(q).test; return !t || t(it[nameKey] || ''); })
      .map((it) => {
        const name = it[nameKey] || '—';
        const mine = books.filter((b) => (b[nameKey] || '') === name);
        const fin = mine.filter((b) => readStatus(b) === 'finished').length;
        const total = mine.length || it.count || 0;
        return { it, name, mine: mine.length, fin, total, pct: total ? (fin / total) * 100 : 0 };
      })
      .filter((r) => inRange(r.total, ...rf.books) && inRange(r.fin, ...rf.finished) && inRange(r.pct, ...rf.pct));
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      books: (a, b) => b.total - a.total,
      finished: (a, b) => b.fin - a.fin,
      pct: (a, b) => b.pct - a.pct,
    }[rsort.key] || (() => 0);
    const sorted = base.sort(cmp);
    return rsort.dir < 0 ? sorted.reverse() : sorted;
  }, [items, derived, q, books, nameKey, rsort, rf]);
  const rsortBy = (key) => setRsort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const rsortMark = (key) => (rsort.key === key ? (rsort.dir > 0 ? ' ▾' : ' ▴') : '');
  // Best-effort external lookups — plain search URLs, nothing is fetched until clicked.
  const grUrl = (name) => `https://www.goodreads.com/search?q=${encodeURIComponent(name)}`;
  const wikiUrl = (name) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(name)}`;
  return (
    <div className="lj-ref">
      <p className="settings-note">{rows.length} {kind}{rows.length === 1 ? '' : 's'}{!items && ' (derived from your books)'}{rows.length > 300 ? ' · showing the first 300 — filter to narrow' : ''} · click a name for its reference details
        {(q || anySet(rf)) && <> · <button className="link-btn" onClick={() => { setQ(''); setRf({ books: ['', ''], finished: ['', ''], pct: ['', ''] }); }}>clear filters</button></>}</p>
      <div className="lj-tablewrap">
        <table className="lj-table lj-ref-table">
          <thead>
            <tr>
              {[['name', kind === 'author' ? 'Author' : 'Genre'], ['books', 'Books'], ['finished', 'Finished'], ['pct', 'Completion']].map(([k, l]) => (
                <th key={k} className={rsort.key === k ? 'on' : ''} onClick={() => rsortBy(k)} title="Click to sort (click again to flip)">{l}{rsortMark(k)}</th>
              ))}
              <th>Links</th>
              <th aria-label="Show in library" />
            </tr>
            <tr className="lj-filter-row">
              <th><TextF value={q} onChange={setQ} label={kind === 'author' ? 'author name' : 'genre name'} /></th>
              <th><RangeF value={rf.books} onChange={(v) => setRf({ ...rf, books: v })} label="books" /></th>
              <th><RangeF value={rf.finished} onChange={(v) => setRf({ ...rf, finished: v })} label="finished" /></th>
              <th><RangeF value={rf.pct} onChange={(v) => setRf({ ...rf, pct: v })} label="completion %" /></th>
              <th colSpan={2} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map(({ it, name, fin, total, pct }, i) => (
              <Fragment key={name + i}>
                <tr onClick={() => setOpen(open === i ? null : i)}>
                  <td className="lj-td-title"><b>{name}</b>{it.lifespan ? <em> {it.lifespan}</em> : it.emerged ? <em> {it.emerged}</em> : null}</td>
                  <td>{total}</td>
                  <td>{fin}</td>
                  <td>
                    <div className="rh-td-prog" title={`${fin} of ${total} finished`}>
                      <span>{total ? Math.round(pct) : 0}%</span>
                      <span className="lj-series-bar lj-ref-bar"><i style={{ width: `${pct}%` }} /></span>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <a className="link-btn" href={grUrl(name)} target="_blank" rel="noreferrer noopener" title={`Search Goodreads for ${name}`}>GR</a>
                    {' '}
                    <a className="link-btn" href={wikiUrl(name)} target="_blank" rel="noreferrer noopener" title={`Search Wikipedia for ${name}`}>W</a>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="link-btn" title={`Show ${name} in the Library`} onClick={() => onOpen?.(name)}>↗</button>
                  </td>
                </tr>
                {open === i && (
                  <tr className="lj-ref-detail">
                    <td colSpan={6}>
                      <div className="lj-refbody">
                        {Object.entries(it).filter(([k, v]) => v && k !== nameKey && typeof v !== 'object').map(([k, v]) => (
                          <div key={k}><b>{k}:</b> {String(v)}</div>
                        ))}
                        {kind === 'genre' && subitems?.length > 0 && (
                          <div className="lj-subgenres">Subgenres: {subitems.filter((s) => s.genre === name).map((s) => s.subgenre).join(', ') || '—'}</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
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
// `dir: true` kinds are DIRECTIONAL (edge order [idA, idB] means A → B) and draw an arrowhead.
const EDGE_KINDS = {
  influence: { color: '#c9a227', label: 'influence', dir: true },
  prereq: { color: '#3a86ff', label: 'prerequisite', dir: true },
  series: { color: '#06d6a0', label: 'series' },
  'same-author': { color: '#b5651d', label: 'same author' },
  theme: { color: '#7209b7', label: 'shared theme' },
  contrast: { color: '#ef476f', label: 'contrast / rebuttal' },
  responds: { color: '#2a9d8f', label: 'responds to', dir: true },
  similarity: { color: '#4cc9f0', label: 'similar work' },
  opposed: { color: '#d00000', label: 'opposed pair' },
  'same-universe': { color: '#ffb703', label: 'same universe' },
  link: { color: '#8d99ae', label: 'related' },
};
const edgeColor = (k) => (EDGE_KINDS[k] || EDGE_KINDS.link).color;
const edgeDir = (k) => !!(EDGE_KINDS[k] || EDGE_KINDS.link).dir;
const DIR_KINDS = Object.keys(EDGE_KINDS).filter((k) => EDGE_KINDS[k].dir);
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
          {/* Arrowheads for directional kinds (influence / prerequisite / responds-to): A → B. */}
          <defs>
            {DIR_KINDS.map((k) => (
              <marker key={k} id={`lj-arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M 0 1 L 8 5 L 0 9 z" fill={edgeColor(k)} />
              </marker>
            ))}
          </defs>
          {shownEdges.map((e, i) => {
            const on = openSet.has(e.a) || openSet.has(e.b);
            const dir = edgeDir(e.kind);
            // Directional edges stop at the target star's rim so the arrowhead isn't buried in it.
            let { bx, by } = e;
            if (dir) {
              const dx = e.bx - e.ax, dy = e.by - e.ay;
              const len = Math.hypot(dx, dy) || 1;
              const trim = (e.br || 6) + 2;
              if (len > trim * 2) { bx = e.bx - (dx / len) * trim; by = e.by - (dy / len) * trim; }
            }
            return <line key={i} className={`lj-edge${on ? ' lj-edge-on' : ''}`} x1={e.ax} y1={e.ay} x2={bx} y2={by} stroke={edgeColor(e.kind)} strokeWidth={(on ? 2.2 : 1) * (view.w / FULL_VIEW.w)} opacity={openIds.length ? (on ? 0.95 : 0.15) : 0.5} markerEnd={dir ? `url(#lj-arr-${e.kind})` : undefined} />;
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

// ── Queues view ──────────────────────────────────────────────────────────────────────────────────
// Hand-picked, hand-ordered reading queues. Desktop: the selected queue on the left, the add-books
// table on the right, each in a fixed-height scroll box so adding/removing never shifts the page.
// Phone: stacked. ETAs and hours use your RECENT pace (recentPace), not an all-time average.
const pctTxt = (p) => `${Math.round((p || 0) * 100)}%`;
const Bar = ({ pct, cls = '', label }) => (
  <span className={`lj-pbar ${cls}`} role="img" aria-label={label || `${pctTxt(pct)} read`}><i style={{ width: pctTxt(Math.min(1, pct)) }} /></span>
);
function QueueView({ initialSel = null, books, onOpen, fileStats = {}, bindMap = {}, openChecksums = [], dayAgg = [] }) {
  const { openRecent, openFiles, closeDialog } = useApp();
  const pace = useMemo(() => recentPace(dayAgg), [dayAgg]);
  const [wpmIn, setWpm] = useState(null);
  const wpm = wpmIn || pace.wpm || 250;
  // Opening the actual document from the queue. The text itself never syncs between devices (far too
  // big), so a book read on another machine has no local copy — hence the designated search folders.
  const [dirs, setDirs] = useState([]);
  const [finding, setFinding] = useState(null); // book id being opened
  const [findMsg, setFindMsg] = useState('');
  useEffect(() => { getSearchDirs().then(setDirs).catch(() => {}); }, []);
  const csOf = useMemo(() => {
    const m = {};
    for (const [cs, id] of Object.entries(bindMap)) if (!m[id]) m[id] = cs;
    return m;
  }, [bindMap]);
  async function addDir() {
    try { setDirs(await addSearchDir(await window.showDirectoryPicker({ id: 'tachyread-library-dirs', mode: 'read' }))); setFindMsg(''); } catch (e) { if (e?.name !== 'AbortError') setFindMsg(`Could not add that folder: ${e?.message || e}`); }
  }
  // Local copy → already-open tab → the designated folders. Only the last step can be slow, and it
  // runs straight off this click so a folder whose permission lapsed can ask for it back.
  async function openTheFile(b) {
    const cs = csOf[b.id];
    if (!cs || finding) return;
    const name = fileStats[cs]?.fileName || b.title;
    setFinding(b.id); setFindMsg(dirs.length ? `Looking for “${name}”…` : '');
    try {
      const r = await openBookFile({ cs, name, openChecksums, dirs, openRecent, openFiles });
      if (r.ok) closeDialog?.(); else setFindMsg(r.msg);
    } catch (e) {
      setFindMsg(`Could not open “${name}”: ${e?.message || e}`);
    } finally { setFinding(null); }
  }
  const [queues, setQueues] = useState(null); // null = loading
  const [sel, setSel] = useState(initialSel);
  const [naming, setNaming] = useState(null); // new-queue name being typed, or null
  const [undo, setUndo] = useState(null);     // { queues, label } before the last bulk change
  const [paths, setPaths] = useState(() => foundPaths()); // checksum → 'Folder/sub/file' (indexFolders)
  // Stacked (queue full width, add-books below) suits the queue's detail columns; side by side
  // keeps both in view. Remembered per device.
  const [stacked, setStacked] = useState(() => { try { return localStorage.getItem('tachyread-q-layout') !== 'side'; } catch { return true; } });
  const toggleLayout = () => { setStacked(!stacked); try { localStorage.setItem('tachyread-q-layout', stacked ? 'side' : 'stacked'); } catch { /* private mode */ } };
  useEffect(() => {
    let live = true;
    const load = () => getLibraryRef('queues').then((v) => {
      let qs = Array.isArray(v) ? v : [];
      const mig = deckMigration(qs, books); // the old On deck list, folded in once
      const dd = dedupeQueues(mig || qs); // one queue per book — older data could hold it twice
      if (mig || dd) { qs = dd || mig; saveLibraryRef('queues', qs).catch(() => {}); }
      if (live) setQueues(qs);
    }).catch(() => { if (live) setQueues([]); });
    load();
    window.addEventListener('tachyread-library-changed', load); // a sync can bring queues in
    return () => { live = false; window.removeEventListener('tachyread-library-changed', load); };
  }, [books]);
  const saveQueues = (next) => { setQueues(next); saveLibraryRef('queues', next).catch((e) => setFindMsg(`Could not save queues: ${e?.message || e}`)); };
  const bulk = (fn, label) => { setUndo({ queues, label }); saveQueues(fn(queues)); };
  const shownQueues = liveQueues(queues);
  const overview = sel === 'overview';
  const selQueue = overview ? null : shownQueues.find((x) => x.id === sel) || shownQueues[0] || null;
  function createQueue() {
    const nq = newQueue(naming);
    saveQueues([...queues, nq]);
    setNaming(null);
    setSel(nq.id);
  }
  const pctOf = (b) => (readStatus(b) === 'finished' ? 1 : fileStats[csOf[b.id]]?.coverage || 0);
  if (!queues) return <p className="settings-note">Loading queues…</p>;

  return (
    <div className="lj-queue">
      <div className="lj-queue-pick" role="tablist" aria-label="Queues">
        {shownQueues.length > 0 && <button role="tab" aria-selected={overview} className={`lj-qcat${overview ? ' on' : ''}`} onClick={() => setSel('overview')} title="Every queue at a glance (view only)">📊 All queues</button>}
        {shownQueues.map((x, qi) => {
          const qb = queueBooks(x, books);
          const done = qb.filter((b) => readStatus(b) === 'finished').length;
          const on = selQueue?.id === x.id;
          return (
            <span key={x.id} className="lj-qpill">
              {on && <button className="lj-qnudge" disabled={qi === 0} onClick={() => saveQueues(moveQueue(queues, x.id, -1))} aria-label={`Move “${x.name}” left`} title="Move this queue left">‹</button>}
              <button role="tab" aria-selected={on} className={`lj-qcat lj-qchip${on ? ' on' : ''}`} onClick={() => setSel(x.id)}
                title={`${x.name}: ${done} of ${qb.length} finished`}>
                <span>{x.name} ({qb.length})</span>
                <Bar pct={qb.length ? done / qb.length : 0} label={`${done} of ${qb.length} finished`} />
              </button>
              {on && <button className="lj-qnudge" disabled={qi === shownQueues.length - 1} onClick={() => saveQueues(moveQueue(queues, x.id, 1))} aria-label={`Move “${x.name}” right`} title="Move this queue right">›</button>}
            </span>
          );
        })}
        {naming == null
          ? <button className="lj-qcat" onClick={() => setNaming('')} title="A hand-picked, hand-ordered list — a book can sit in several">＋ New queue</button>
          : (
            <form className="lj-q-new" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) createQueue(); }}>
              <input autoFocus value={naming} placeholder="Queue name, e.g. AI lore" aria-label="New queue name"
                onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
              <button type="submit" disabled={!naming.trim()}>Create</button>
              <button type="button" onClick={() => setNaming(null)}>Cancel</button>
            </form>
          )}
        {undo && <button className="lj-qcat" onClick={() => { saveQueues(undo.queues); setUndo(null); }} title="Put the queues back as they were">↶ Undo {undo.label}</button>}
      </div>
      {overview ? <QueuesDashboard queues={queues} books={books} wpm={wpm} pace={pace} fileStats={fileStats} csOf={csOf} onPick={setSel} onBulk={bulk} />
        : !selQueue ? <p className="settings-note">No queues yet — ＋ New queue to make one, then add books to it from the table that appears.</p> : (
        <div className={`lj-q-panes${stacked ? ' stacked' : ''}`}>
          <NamedQueue
            paths={paths} stacked={stacked} onLayout={toggleLayout}
            key={selQueue.id} // fresh rename/confirm-delete state per queue — an armed Delete must not carry over to the next one
            queue={selQueue} others={shownQueues.filter((x) => x.id !== selQueue.id)} books={books} wpm={wpm} setWpm={setWpm} pace={pace} fileStats={fileStats} csOf={csOf} pctOf={pctOf}
            openChecksums={openChecksums} dirs={dirs} finding={finding} openTheFile={openTheFile} findMsg={findMsg}
            onChange={(next) => saveQueues(queues.map((x) => (x.id === next.id ? next : x)))}
            onDelete={() => { bulk((qs) => deleteQueue(qs, selQueue.id), `delete “${selQueue.name}”`); setSel(null); }}
            onEdit={(fn) => saveQueues(fn(queues))}
            onBulk={bulk}
            onOpen={onOpen}
            folders={(
              <div className="lj-inline lj-findfolders">
                <span className="settings-note" style={{ margin: 0 }} title="A document's text never leaves the device it was opened on — only your reading record syncs. Name the folders your files live in and ▶ can find them on any device.">
                  📁 Where your documents live{dirs.length ? ':' : ' — none set yet, so ▶ only opens books this device has already read.'}
                </span>
                {dirs.map((d) => (
                  <span key={d.name} className="lj-dirchip">
                    📁 {d.name}
                    <button title={`Stop searching “${d.name}”`} onClick={async () => setDirs(await removeSearchDir(d))}>✕</button>
                  </span>
                ))}
                {pickerSupported()
                  ? <button onClick={addDir} title="Pick a folder to search when a queued book has no copy on this device">➕ Add folder…</button>
                  : <span className="settings-note" style={{ margin: 0 }}>Choosing folders needs a Chromium browser (Chrome, Edge, Brave).</span>}
              </div>
            )}
          />
          <QueueCandidates queue={selQueue} queues={queues} books={books} dirs={dirs} paths={paths} setPaths={setPaths} wpm={wpm} fileStats={fileStats} csOf={csOf} pctOf={pctOf} openChecksums={openChecksums}
            onAdd={(ids, label) => (ids.length > 1
              ? bulk((qs) => ids.reduce((acc, id) => addToQueue(acc, selQueue.id, id), qs), label)
              : saveQueues(addToQueue(queues, selQueue.id, ids[0])))}
            onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}

// Dashboard: every queue's progress and what's left, plus totals across all of them.
// Dashboard with whole-queue tools: tick queues to merge them; ✂ splits one (both undoable via ↶).
function QueuesDashboard({ queues, books, wpm, pace, fileStats, csOf, onPick, onBulk }) {
  const [picked, setPicked] = useState([]);
  const [mergeName, setMergeName] = useState('');
  const [splitAt, setSplitAt] = useState(null); // { id, n } while choosing a split position
  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const { rows, total } = useMemo(() => queuesOverview(queues, books, {
    wpm, wordsPerDay: pace.wordsPerDay, fileOf: (b) => fileStats[csOf[b.id]] || null, isLinked: (b) => !!csOf[b.id],
  }), [queues, books, wpm, pace, fileStats, csOf]);
  const maxLeft = Math.max(1, ...rows.map((r) => r.st.wordsLeft));
  return (
    <section className="lj-qdash" aria-label="All queues">
      <div className="lj-qstats">
        <div className="ab-stat"><b>{total.queues}</b><span>queues</span></div>
        <div className="ab-stat"><b>{total.done} / {total.count}</b><span>books finished</span><Bar pct={total.count ? total.done / total.count : 0} label={`${total.done} of ${total.count} finished`} /></div>
        <div className="ab-stat"><b>{total.wordsLeft.toLocaleString()}</b><span>words left of {total.wordsTotal.toLocaleString()}</span><Bar pct={total.wordsTotal ? 1 - total.wordsLeft / total.wordsTotal : 0} /></div>
        <div className="ab-stat"><b>{total.hoursLeft} h</b><span>left at {wpm} wpm</span></div>
        <div className="ab-stat" title="Everything left, read at your recent pace (last ~6 weeks, recent days weighted most)"><b>{total.eta || '—'}</b><span>{total.eta ? `all done at ~${pace.wordsPerDay.toLocaleString()} words/day` : 'needs some recent reading'}</span></div>
        <div className="ab-stat"><b>{total.hoursSpent} h</b><span>spent so far</span></div>
      </div>
      <div className="lj-inline lj-qdash-tools">
        {picked.length >= 2 ? (
          <form className="lj-q-new" onSubmit={(e) => {
            e.preventDefault();
            const order = rows.map((r) => r.queue.id).filter((id) => picked.includes(id));
            onBulk((qs) => mergeQueues(qs, order, mergeName), `merge ${order.length} queues`);
            setPicked([]); setMergeName('');
          }}>
            <span className="settings-note" style={{ margin: 0 }}>Merge {picked.length} queues into</span>
            <input value={mergeName} onChange={(e) => setMergeName(e.target.value)} aria-label="Name of the merged queue"
              placeholder={rows.find((r) => picked.includes(r.queue.id))?.queue.name} />
            <button type="submit" className="toggle-on" title="Books keep their order (left-most queue first); the other queues are removed — ↶ Undo puts them back">Merge</button>
            <button type="button" onClick={() => setPicked([])}>Cancel</button>
          </form>
        ) : <span className="settings-note" style={{ margin: 0 }}>Tick two or more queues to merge them · ✂ on a row splits it.</span>}
      </div>
      <div className="lj-q-box lj-qdash-box">
        <table className="lj-cand lj-qdash-table">
          <thead><tr><th aria-label="Select" /><th>Queue</th><th>Finished</th><th>Words read</th><th>Words left</th><th>Hours left</th><th>Done by*</th><th title="The same, counting only books that have a linked document">Linked files only</th><th>Up next</th></tr></thead>
          <tbody>
            {rows.map(({ queue: q, st, linked }) => (
              <tr key={q.id}>
                <td><input type="checkbox" checked={picked.includes(q.id)} onChange={() => togglePick(q.id)} aria-label={`Select “${q.name}” to merge`} /></td>
                <td>
                  <button className="link-btn" onClick={() => onPick(q.id)} title="Open this queue">{q.name}</button>
                  {splitAt?.id === q.id ? (
                    <span className="lj-qdash-split">
                      {' '}first <input type="number" min="1" max={Math.max(1, st.count - 1)} value={splitAt.n} onChange={(e) => setSplitAt({ id: q.id, n: e.target.value })} aria-label="Books that stay in this queue" /> stay
                      <button onClick={() => { onBulk((qs) => splitQueue(qs, q.id, books, 'at', Number(splitAt.n) || 1), `split “${q.name}”`); setSplitAt(null); }}>Split</button>
                      <button onClick={() => setSplitAt(null)}>✕</button>
                    </span>
                  ) : st.count > 1 && (
                    <select className="lj-q-move" value="" aria-label={`Split “${q.name}”`} title="Split this queue"
                      onChange={(e) => {
                        const how = e.target.value;
                        if (!how) return;
                        if (how === 'at') setSplitAt({ id: q.id, n: Math.ceil(st.count / 2) });
                        else onBulk((qs) => splitQueue(qs, q.id, books, how), `split “${q.name}”`);
                      }}>
                      <option value="">✂</option>
                      {Object.entries(QUEUE_SPLITS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  )}
                </td>
                <td><Bar cls="fin" pct={st.count ? st.done / st.count : 0} label={`${st.done} of ${st.count} finished`} /><span className="lj-cand-pct lj-qdash-n">{st.done}/{st.count}</span></td>
                <td><Bar pct={st.pctWords / 100} /><span className="lj-cand-pct">{st.pctWords}%</span></td>
                <td title={`${st.wordsLeft.toLocaleString()} words`}><span className="lj-qdash-left"><i style={{ width: `${(st.wordsLeft / maxLeft) * 100}%` }} /></span>{Math.round(st.wordsLeft / 1000)}k</td>
                <td>{st.hoursLeft} h</td>
                <td>{st.eta || '—'}</td>
                <td title={`${linked.count} of ${st.count} books have a linked document`}>{linked.count
                  ? <><Bar cls="fin" pct={linked.done / linked.count} label={`${linked.done} of ${linked.count} linked books finished`} /><span className="lj-qdash-linked">{linked.done}/{linked.count} · {linked.pctWords}% · {linked.hoursLeft} h</span></>
                  : <span className="settings-note">none linked</span>}</td>
                <td title={st.next?.title || ''}>{st.next?.title || (st.count ? '✓ all finished' : 'empty')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="settings-note lj-cand-foot">* if that queue alone were read in order at your recent pace. Click a queue’s name to open it.</p>
    </section>
  );
}

// One queue: its stats (progress, pace, time, ETA, where the files are) with bars, the ordered list
// with ▶ open / reorder / remove, and whole-queue reorders.
const WHERE = { open: ['📂', 'Open in a tab'], local: ['💾', 'Saved on this device'], folder: ['📁', 'Found in a search folder'], unsearched: ['❔', 'Not on this device — not searched for yet'], missing: ['✖', 'Not on this device or in the search folders'], unlinked: ['—', 'No document linked'] };
// The queue table's filterable text columns (Words has min/max instead).
const QCOLS = { title: 'Title', author: 'Author', genre: 'Genre', type: 'Type', folder: 'Folder', file: 'File' };
function NamedQueue({ queue, others = [], paths = {}, stacked = true, onLayout, books, wpm, setWpm, pace, fileStats, csOf, pctOf, openChecksums, dirs, finding, openTheFile, findMsg, onChange, onDelete, onEdit, onBulk, onOpen, folders }) {
  const qBooks = useMemo(() => queueBooks(queue, books), [queue, books]);
  const st = useMemo(() => queueStats(qBooks, {
    wpm, fileOf: (b) => fileStats[csOf[b.id]] || null, wordsPerDay: pace.wordsPerDay,
  }), [qBooks, wpm, fileStats, csOf, pace]);
  // The same over just the books with a linked document (the ones the app can actually open/track).
  const lst = useMemo(() => queueStats(qBooks.filter((b) => csOf[b.id]), {
    wpm, fileOf: (b) => fileStats[csOf[b.id]] || null, wordsPerDay: pace.wordsPerDay,
  }), [qBooks, wpm, fileStats, csOf, pace]);
  const [renaming, setRenaming] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  // File presence: the cheap checks (open tab / local copy) run on their own; the folder search only
  // on request, since it walks directories.
  const [where, setWhere] = useState({});
  const [searching, setSearching] = useState(false);
  const idsKey = qBooks.map((b) => b.id).join(',');
  useEffect(() => {
    let live = true;
    (async () => {
      const m = {};
      // In parallel — one at a time took ages to fill the "…" placeholders on a long queue.
      const res = await Promise.all(qBooks.map((b) => fileWhere(csOf[b.id], fileStats[csOf[b.id]]?.fileName || b.title, { openChecksums, dirs }).catch(() => ({ where: 'missing' }))));
      qBooks.forEach((b, i) => { m[b.id] = res[i].where; });
      if (live) setWhere(m);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, openChecksums, dirs]);
  async function searchFolders() {
    setSearching(true);
    const m = { ...where };
    for (const b of qBooks) {
      if (m[b.id] !== 'unsearched') continue;
      m[b.id] = (await fileWhere(csOf[b.id], fileStats[csOf[b.id]]?.fileName || b.title, { openChecksums, dirs, search: true })).where;
      setWhere({ ...m });
    }
    setSearching(false);
  }
  const counts = Object.values(where).reduce((a, w) => ({ ...a, [w]: (a[w] || 0) + 1 }), {});
  const avail = (counts.open || 0) + (counts.local || 0) + (counts.folder || 0);
  const { fin, todo } = useMemo(() => splitFinished(qBooks), [qBooks]);
  // Finished books start collapsed (a long finished list pushed what's left off-screen) unless you
  // chose to show them; the choice is remembered per device.
  const [hideFin, setHideFin] = useState(() => { try { return localStorage.getItem('tachyread-q-hidefin') !== '0'; } catch { return true; } });
  const toggleFin = () => { setHideFin(!hideFin); try { localStorage.setItem('tachyread-q-hidefin', hideFin ? '0' : '1'); } catch { /* private mode */ } };
  const move = (b, to) => onEdit((qs) => setQueueIds(qs, queue.id, moveInTodo(qBooks, b.id, to)));
  // Filters over the queue's own rows (you won't read a big queue strictly in order): regex per text
  // column, min/max words, finished or not. Queue order is kept; moves still act on the full queue.
  const [qcols, setQcols] = useSessionState(`tr-q-${queue.id}-cols`, {});
  const [minW, setMinW] = useSessionState(`tr-q-${queue.id}-minw`, '');
  const [maxW, setMaxW] = useSessionState(`tr-q-${queue.id}-maxw`, '');
  const [qstate, setQstate] = useSessionState(`tr-q-${queue.id}-state`, 'all');
  const qrows = useMemo(() => [...(hideFin ? [] : fin), ...todo].map((b) => {
    const cs = csOf[b.id];
    return bookRow(b, { pct: st.pctById[b.id], file: (cs && (paths[cs] || fileStats[cs]?.fileName)) || '' });
  }), [fin, todo, hideFin, csOf, st, paths, fileStats]);
  const num = (v) => (String(v).trim() === '' ? null : Number(v) * 1000);
  const { rows: shownRows, bad: qbad } = useMemo(() => filterCandidates(qrows, { cols: qcols, state: qstate, minWords: num(minW), maxWords: num(maxW), keepOrder: true }), [qrows, qcols, qstate, minW, maxW]);
  const qfiltered = Object.values(qcols).some((t) => t?.trim()) || minW !== '' || maxW !== '' || qstate !== 'all';
  const resort = (key) => onBulk((qs) => setQueueIds(qs, queue.id, sortQueueIds(qBooks, key, (b) => ({ pct: pctOf(b), lastRead: fileStats[csOf[b.id]]?.lastRead }))), `sort (${QUEUE_SORTS[key][0].toLowerCase()})`);

  return (
    <section className="lj-q-pane" aria-label={`Queue: ${queue.name}`}>
      <div className="rh-section-h lj-sh-row">
        {renaming == null
          ? <span>{queue.name}</span>
          : (
            <form className="lj-q-new" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) { onChange({ ...queue, name: renaming.trim() }); setRenaming(null); } }}>
              <input autoFocus value={renaming} aria-label="Queue name" onChange={(e) => setRenaming(e.target.value)} />
              <button type="submit">Save</button>
              <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          )}
        <span className="lj-spacer" />
        {renaming == null && <button onClick={() => setRenaming(queue.name)}>Rename</button>}
        {confirmDel
          ? <><button className="danger" onClick={onDelete}>Delete “{queue.name}”</button><button onClick={() => setConfirmDel(false)}>Keep</button></>
          : <button onClick={() => setConfirmDel(true)} title="Delete this queue (the books stay in your library)">Delete</button>}
      </div>
      {st.count > 0 && (
        <>
          {/* The whole queue at a glance: one segment per book, sized by length, filled by progress. */}
          <div className="lj-qseg" role="img" aria-label={`${st.pctWords}% of the queue's words read`}>
            {qBooks.map((b) => (
              <span key={b.id} style={{ flexGrow: Math.max(1, Math.sqrt(Number(b.words) || (Number(b.pages) || 0) * 275 || 1)) }}
                title={`${b.title} — ${pctTxt(st.pctById[b.id])} read`} className={readStatus(b) === 'finished' ? 'fin' : ''}>
                <i style={{ width: pctTxt(st.pctById[b.id]) }} />
              </span>
            ))}
          </div>
          <div className="lj-qstats">
            <div className="ab-stat"><b>{st.done} / {st.count}</b><span>finished</span><Bar pct={st.done / st.count} label={`${st.done} of ${st.count} finished`} /></div>
            <div className="ab-stat"><b>{st.pctWords}%</b><span>of {st.wordsTotal.toLocaleString()} words read</span><Bar pct={st.pctWords / 100} /></div>
            <div className="ab-stat"><b>{avail} / {st.count}</b><span>files available{counts.unsearched ? ` · ${counts.unsearched} not searched` : ''}{counts.missing ? ` · ${counts.missing} missing` : ''}</span><Bar cls="files" pct={avail / st.count} label={`${avail} of ${st.count} files available`} /></div>
            <div className="ab-stat"><b>{st.hoursLeft} h</b><span>left at {wpm} wpm</span></div>
            <div className="ab-stat" title="Projected finish if read in order at your recent pace — the last ~6 weeks of reading, recent days weighted most (days off count too)">
              <b>{st.eta || '—'}</b><span>{st.eta ? `ETA at ~${st.wordsPerDay.toLocaleString()} words/day lately` : 'ETA needs some recent reading'}</span>
            </div>
            <div className="ab-stat"><b>{st.hoursSpent} h</b><span>spent{st.readingWpm ? ` · ~${st.readingWpm} wpm on these` : ''}</span></div>
          </div>
          <div className="lj-qlinked" title="The same stats counting only books that have a linked document">
            <span className="lj-qlinked-h">🔗 Linked files only · {lst.count} of {st.count}</span>
            {lst.count ? <>
              <span className="lj-qlinked-s"><Bar cls="fin" pct={lst.done / lst.count} label={`${lst.done} of ${lst.count} linked books finished`} />{lst.done}/{lst.count} finished</span>
              <span className="lj-qlinked-s"><Bar pct={lst.pctWords / 100} />{lst.pctWords}% read</span>
              <span className="lj-qlinked-s">{lst.hoursLeft} h left</span>
              <span className="lj-qlinked-s">{lst.eta ? `done ~${lst.eta}` : 'ETA —'}</span>
              <span className="lj-qlinked-s">{lst.hoursSpent} h spent{lst.readingWpm ? ` · ~${lst.readingWpm} wpm` : ''}</span>
            </> : <span className="settings-note" style={{ margin: 0 }}>none of these books has a linked document yet</span>}
          </div>
        </>
      )}
      <div className="lj-inline lj-q-tools">
        <label className="settings-note" title={pace.wpm ? `Your recent reading speed is ~${pace.wpm} wpm` : 'No recent reading speed yet'}>
          Speed <input type="number" className="lj-wpm" min="100" max="1500" step="10" value={wpm} onChange={(e) => setWpm(Number(e.target.value) || null)} aria-label="Words per minute" /> wpm
        </label>
        <select value="" onChange={(e) => { if (e.target.value) resort(e.target.value); }} aria-label="Reorder the whole queue" disabled={qBooks.length < 2}>
          <option value="">⇅ Reorder…</option>
          {Object.entries(QUEUE_SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={qstate} onChange={(e) => setQstate(e.target.value)} aria-label="Show">
          {Object.entries(CAND_STATES).map(([k, label]) => <option key={k} value={k}>{k === 'all' ? 'All books' : label}</option>)}
        </select>
        {qfiltered && <button onClick={() => { setQcols({}); setMinW(''); setMaxW(''); setQstate('all'); }}>Clear filters</button>}
        <span className="lj-spacer" />
        <button onClick={onLayout} title={stacked ? 'Put the queue and the add-books table side by side' : 'Stack the add-books table under the queue (room for every column)'}>{stacked ? '⇔ Side by side' : '⇕ Stack'}</button>
        {counts.unsearched > 0 && <button disabled={searching} onClick={searchFolders} title="Look through your search folders for the files not on this device">{searching ? '⟳ Searching…' : `🔎 Search folders (${counts.unsearched})`}</button>}
        <button disabled={!st.next} title="Open a random unfinished pick from this queue" onClick={() => {
          const pool = qBooks.filter((b) => readStatus(b) !== 'finished');
          if (pool.length) onOpen(pool[Math.floor(Math.random() * pool.length)].id);
        }}>🎲</button>
      </div>
      {findMsg && <p className="settings-note lj-findmsg">{findMsg}</p>}
      <div className="lj-q-box">
        {qBooks.length === 0 ? <p className="settings-note">Empty so far — add books from the table {stacked ? 'below' : <><span className="lj-q-wide-only">on the right</span><span className="lj-q-narrow-only">below</span></>}.</p> : (
          <table className="lj-cand lj-qtable">
            <colgroup><col className="c-rank" /><col className="c-title" /><col className="c-author" /><col className="c-genre" /><col className="c-type" /><col className="c-words" /><col className="c-read" /><col className="c-eta" /><col className="c-folder" /><col className="c-file" /><col className="c-acts" /></colgroup>
            <thead>
              <tr><th>#</th><th>Title</th><th>Author</th><th>Genre</th><th>Type</th><th title="Words · hours at your speed">Words</th><th>Read</th><th>Done by</th><th>Folder</th><th>File</th><th aria-label="Actions" /></tr>
              <tr className="lj-cand-filters">
                <th />
                {['title', 'author', 'genre', 'type'].map((k) => (
                  <th key={k}><input value={qcols[k] || ''} onChange={(e) => setQcols({ ...qcols, [k]: e.target.value })} placeholder="regex" className={qbad.includes(k) ? 'bad' : ''} aria-label={`Filter ${QCOLS[k]} (regular expression)`} /></th>
                ))}
                <th className="lj-qwords-f">
                  <input value={minW} onChange={(e) => setMinW(e.target.value)} placeholder="min k" inputMode="numeric" aria-label="Minimum words, in thousands" title="Minimum words, in thousands (e.g. 50 = 50,000)" />
                  <input value={maxW} onChange={(e) => setMaxW(e.target.value)} placeholder="max k" inputMode="numeric" aria-label="Maximum words, in thousands" title="Maximum words, in thousands (e.g. 120 = 120,000)" />
                </th>
                <th /><th />
                {['folder', 'file'].map((k) => (
                  <th key={k}><input value={qcols[k] || ''} onChange={(e) => setQcols({ ...qcols, [k]: e.target.value })} placeholder="regex" className={qbad.includes(k) ? 'bad' : ''} aria-label={`Filter ${QCOLS[k]} (regular expression)`} /></th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {fin.length > 0 && (
                <tr className="lj-q-finhead"><td colSpan={11}><button onClick={toggleFin} aria-expanded={!hideFin}>{hideFin ? '▸' : '▾'} ✓ {fin.length} finished</button></td></tr>
              )}
              {shownRows.map(({ book: b, pct: p, cols: c, words }) => {
                const isFin = readStatus(b) === 'finished';
                const i = isFin ? -1 : todo.indexOf(b);
                const w = WHERE[where[b.id]] || ['…', 'Checking'];
                const last = i === todo.length - 1;
                return (
                  <tr key={b.id} className={isFin ? 'done' : ''}>
                    <td className="lj-qrank">{isFin ? '✓' : i + 1}</td>
                    <td title={b.title}><button className="link-btn" onClick={() => onOpen(b.id)} title="Open in Library">{b.title}</button></td>
                    <td title={c.author}>{c.author}</td>
                    <td title={c.genre}>{c.genre}</td>
                    <td>{c.type}</td>
                    <td title={`${words.toLocaleString()} words`}>{words ? `${Math.round(words / 1000)}k` : '—'}{estHours(b, wpm) != null ? <span className="lj-qdim"> · {estHours(b, wpm)} h</span> : ''}</td>
                    <td><Bar pct={p} cls={isFin ? 'fin' : ''} /><span className="lj-cand-pct">{pctTxt(p)}</span></td>
                    <td>{isFin ? (b.finishTime || '✓') : st.etaById[b.id] || '—'}</td>
                    <td title={c.folder}>{c.folder}</td>
                    <td title={c.file}><span className="lj-where" role="img" aria-label={w[1]} title={w[1]}>{w[0]}</span>{c.file}</td>
                    <td className="lj-qacts">
                      {csOf[b.id] && <button className="lj-queue-read" disabled={finding === b.id} onClick={() => openTheFile(b)} title="Read it">{finding === b.id ? '⟳' : '▶'}</button>}
                      {!isFin && <>
                        <button disabled={i === 0} onClick={() => move(b, 0)} aria-label={`Move “${b.title}” to the top`} title="To the top (of what's left)">⤒</button>
                        <button disabled={i === 0} onClick={() => move(b, i - 1)} aria-label={`Move “${b.title}” up`} title="Up one place in the full queue">↑</button>
                        <button disabled={last} onClick={() => move(b, i + 1)} aria-label={`Move “${b.title}” down`} title="Down one place in the full queue">↓</button>
                        <button disabled={last} onClick={() => move(b, todo.length)} aria-label={`Move “${b.title}” to the bottom`} title="To the bottom">⤓</button>
                      </>}
                      {others.length > 0 && (
                        <select className="lj-q-move" value="" aria-label={`Move “${b.title}” to another queue`} title="Move to another queue"
                          onChange={(e) => { if (e.target.value) onEdit((qs) => addToQueue(qs, e.target.value, b.id)); }}>
                          <option value="">⇄</option>
                          {others.map((x) => <option key={x.id} value={x.id}>→ {x.name}</option>)}
                        </select>
                      )}
                      <button title="Remove from this queue" aria-label={`Remove “${b.title}” from this queue`} onClick={() => onEdit((qs) => removeFromQueue(qs, queue.id, b.id))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {qfiltered && <p className="settings-note lj-cand-foot">Showing {shownRows.length} of {qrows.length}{hideFin && fin.length ? ` (${fin.length} finished hidden)` : ''} — numbers and moves still follow the full queue order.</p>}
      {folders}
    </section>
  );
}

// The add-books table: every library book outside this queue, filterable per column (regex), by
// completion (finished books hidden by default) — open files and recently read first.
const CAND_SHOW = 200;
// ponytail: once per app session; the Find folders button re-runs it on demand.
let foldersIndexed = false;
function QueueCandidates({ queue, queues, books, dirs = [], paths, setPaths, wpm, fileStats, csOf, pctOf, openChecksums, onAdd, onOpen }) {
  const [cols, setCols] = useSessionState('tr-cand-cols', {});
  const [state, setState] = useSessionState('tr-cand-state', 'unfinished');
  // The browser never says which folder a file was opened from, so the Folder column comes from
  // walking your search folders (indexFolders): silently once per session when their permission is
  // already granted, or from the button (which may ask for it).
  const [indexing, setIndexing] = useState('');
  async function runIndex(ask) {
    const wanted = Object.entries(csOf).map(([, cs]) => ({ cs, name: fileStats[cs]?.fileName })).filter((w) => w.name);
    if (!dirs.length || !wanted.length) return;
    setIndexing('⟳ Looking through your folders…');
    const r = await indexFolders(dirs, wanted, { ask }).catch(() => null);
    if (!r) { setIndexing('Could not read the search folders.'); return; }
    rememberPaths(r.paths);
    setPaths(foundPaths());
    setIndexing(ask || r.found ? `Found ${r.found} of ${wanted.length} linked files (${r.scanned.toLocaleString()} entries looked at)${r.skipped ? ` · ${r.skipped} folder${r.skipped === 1 ? '' : 's'} need permission — use Find folders` : ''}.` : '');
  }
  useEffect(() => {
    if (foldersIndexed || !dirs.length || !Object.keys(fileStats).length) return;
    foldersIndexed = true;
    runIndex(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirs, fileStats]);
  const all = useMemo(() => candidateRows(books, queues, (b) => {
    const cs = csOf[b.id];
    return { pct: pctOf(b), file: (cs && (paths[cs] || fileStats[cs]?.fileName)) || '', open: !!cs && openChecksums.includes(cs), lastRead: fileStats[cs]?.lastRead };
  }), [books, queues, csOf, pctOf, paths, fileStats, openChecksums]);
  const { rows, bad } = useMemo(() => filterCandidates(all, { cols, state }), [all, cols, state]);
  const shown = rows.slice(0, CAND_SHOW);
  const filtered = Object.values(cols).some((t) => t?.trim()) || state !== 'unfinished';
  return (
    <section className="lj-q-pane" aria-label={`Add books to ${queue.name}`}>
      <div className="rh-section-h lj-sh-row">
        <span>Add books</span>
        <span className="lj-spacer" />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Completion">
          {Object.entries(CAND_STATES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {filtered && <button onClick={() => { setCols({}); setState('unfinished'); }}>Clear filters</button>}
        <button disabled={!dirs.length || indexing.startsWith('⟳')} onClick={() => runIndex(true)}
          title={dirs.length ? 'Look through your search folders and record which folder each linked file is in' : 'Add a search folder first (📁 Where your documents live, under the queue)'}>📁 Find folders</button>
        <button disabled={!rows.length} onClick={() => onAdd(shown.map((r) => r.book.id), `add ${shown.length}`)}
          title={`Add the ${shown.length} books shown to “${queue.name}”, in this order`}>＋ All shown ({shown.length})</button>
      </div>
      {indexing && <p className="settings-note lj-findmsg">{indexing}</p>}
      <div className="lj-q-box lj-cand-box">
        <table className="lj-cand">
          <colgroup><col className="c-add" /><col className="c-title" /><col className="c-author" /><col className="c-genre" /><col className="c-type" /><col className="c-status" /><col className="c-folder" /><col className="c-file" /><col className="c-prog" /><col className="c-size" /></colgroup>
          <thead>
            <tr><th aria-label="Add" />{Object.values(CAND_COLS).map((l) => <th key={l}>{l}</th>)}<th>Read</th><th>Size</th></tr>
            <tr className="lj-cand-filters">
              <th />
              {Object.entries(CAND_COLS).map(([k, l]) => (
                <th key={k}>
                  <input value={cols[k] || ''} onChange={(e) => setCols({ ...cols, [k]: e.target.value })} placeholder="regex"
                    className={bad.includes(k) ? 'bad' : ''} aria-label={`Filter ${l} (regular expression)`}
                    title={bad.includes(k) ? 'Not a valid regular expression — matching it as plain text' : `Filter ${l} — a regular expression, case-insensitive (e.g. ^the|war$)`} />
                </th>
              ))}
              <th /><th />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ book: b, pct, cols: c, open }) => (
              <tr key={b.id} className={open ? 'open' : ''}>
                <td><button className="lj-cand-add" onClick={() => onAdd([b.id])} aria-label={`Add “${b.title}” to ${queue.name}`} title={`Add to ${queue.name}`}>＋</button></td>
                <td title={c.title}><button className="link-btn" onClick={() => onOpen(b.id)} title="Open in Library">{c.title}</button>{open ? ' 📂' : ''}</td>
                <td title={c.author}>{c.author}</td>
                <td title={c.genre}>{c.genre}</td>
                <td>{c.type}</td>
                <td>{c.status}</td>
                <td title={c.folder}>{c.folder}</td>
                <td title={c.file}>{c.file}</td>
                <td><Bar pct={pct} /><span className="lj-cand-pct">{pctTxt(pct)}</span></td>
                <td>{estHours(b, wpm) != null ? `~${estHours(b, wpm)} h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="settings-note">No books match{filtered ? ' these filters' : ' — everything unfinished is already queued'}.</p>}
      </div>
      <p className="settings-note lj-cand-foot">
        {rows.length > CAND_SHOW ? `Showing ${CAND_SHOW} of ${rows.length} — filter to narrow. ` : `${rows.length} book${rows.length === 1 ? '' : 's'}. `}
        Books already in a queue aren’t listed (a book sits in one queue — use ⇄ on its row to move it).
        Folder comes from your search folders (the browser doesn’t say where a file was opened from) — 📁 Find folders fills it in; File is the linked document’s name.
      </p>
    </section>
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
  const [grpQ, setGrpQ] = useState(''); // New-group picker filter (ticked files always stay listed)
  const [grpAddQ, setGrpAddQ] = useState(''); // "Add a file" search for the group being edited
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

  // Bulk-link scan: every opened file with NO tracker link, scored against the library
  // (features/bulkLink.js). Each row carries its own target — an existing book, a new book of a
  // chosen type, or skip — so a wrong guess is a dropdown away from right. Weak matches default to
  // skip: a wrong link the user accepts is worse than a file left for later.
  const [bulkF, setBulkF] = useState({ file: '', words: ['', ''], read: ['', ''], tier: 'all' }); // bulk-link table filters
  const [bulk, setBulk] = useState(null); // rows from planBulkLinks, each with a live `target`
  const [pick, setPick] = useState(null); // { cs, q } — the row whose library search box is open
  const [busy, setBusy] = useState(null); // { done, total, label } while applying — the table is read-only then
  const fileOf = {};                      // book id → checksum already linked to it
  for (const [cs, id] of Object.entries(bindMap || {})) fileOf[id] = cs;
  const tierCount = { strong: 0, weak: 0, none: 0 };
  let nLink = 0, nNew = 0;
  for (const r of bulk || []) {
    tierCount[r.tier]++;
    if (r.target.startsWith('new:')) nNew++; else if (r.target !== 'skip') nLink++;
  }
  const pickMatches = pick?.q.trim()
    ? books.filter((b) => `${b.title || ''} ${b.author || ''}`.toLowerCase().includes(pick.q.trim().toLowerCase())).slice(0, 8)
    : [];
  function scanUnlinked() {
    const files = Object.entries(fileStats).filter(([cs, f]) => !bindMap?.[cs] && f.fileName)
      .map(([cs, f]) => ({ cs, fileName: f.fileName, words: f.words || 0, coverage: f.coverage || 0 }));
    const rows = planBulkLinks(files, books);
    setBulk(rows.length ? rows : null); setPick(null);
    if (!rows.length) setMsg('Every opened file is already linked. ✅');
  }
  const setTarget = (cs, target) => setBulk((rows) => rows.map((r) => (r.cs === cs ? { ...r, target } : r)));
  // A book found by search joins the row's candidates (so the dropdown can show it) and becomes its target.
  function chooseBook(row, book) {
    setBulk((rows) => rows.map((r) => (r.cs !== row.cs ? r : {
      ...r, target: book.id,
      cands: [{ book, score: matchScore(r.fileName, book) }, ...r.cands.filter((c) => c.book.id !== book.id)],
    })));
    setPick(null);
  }
  // Apply one row at a time, stamping each with what happened as it happens: saving a book and
  // re-reading the library takes a moment per row, and the old version did all of it silently.
  // A row that throws is marked and the rest still run — half a shelf linked beats none.
  async function applyBulk() {
    const todo = (bulk || []).filter((r) => r.target !== 'skip');
    if (!todo.length || busy) return;
    setPick(null);
    const mark = (cs, patch) => setBulk((rows) => rows.map((x) => (x.cs === cs ? { ...x, ...patch } : x)));
    let linked = 0, created = 0, failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      const making = r.target.startsWith('new:');
      const to = making ? r.title : (r.cands.find((c) => c.book.id === r.target)?.book.title || r.target);
      setBusy({ done: i, total: todo.length, label: `${making ? 'Creating' : 'Linking'} “${r.title}”${making ? '' : ` → ${to}`}` });
      mark(r.cs, { state: 'busy' });
      try {
        let id = r.target;
        if (making) { const book = newBookFor(r, id.slice(4)); await onSaveBook(book); id = book.id; created++; } else linked++;
        await onBind(r.cs, id);
        mark(r.cs, { state: making ? 'created' : 'linked', outcome: making ? `created “${to}”` : `linked to “${to}”`, target: 'skip' });
      } catch (e) {
        failed++;
        if (making) created--; else linked--;
        mark(r.cs, { state: 'failed', outcome: `failed: ${e?.message || e}` });
      }
    }
    setBusy(null);
    setMsg(`Linked ${linked} file(s) to existing books and created ${created} new book(s).${failed ? ` ${failed} failed — see the table.` : ''}`);
    // Everything worked → the table has nothing left to say. A failure keeps it up, marked.
    if (!failed) { setBulk(null); setPick(null); }
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
                    <form className="lj-q-new" onSubmit={(e) => { e.preventDefault(); const m = /\[([^\]]+)\]$/.exec(grpAddQ.trim()); if (m) { addGrpMember(g.id, m[1]); setGrpAddQ(''); } }}>
                      <input list="lj-grp-files" value={grpAddQ} onChange={(e) => setGrpAddQ(e.target.value)} placeholder="＋ Add a file — type to search…" aria-label="Add a file to this group" title="Add another edition/file to this group (type part of its name)" />
                      <button type="submit" disabled={!/\[[^\]]+\]$/.test(grpAddQ.trim())}>Add</button>
                      <datalist id="lj-grp-files">
                        {ungroupedFiles.map(([cs, f]) => <option key={cs} value={`${f.fileName || cs.slice(0, 8)} [${cs}]`} />)}
                      </datalist>
                    </form>
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
          <TextF value={grpQ} onChange={setGrpQ} label="file name" />
          <div className="lj-newgrp-list">
            {ungroupedFiles.filter(([cs, f]) => newSel.has(cs) || !textMatcher(grpQ).test || textMatcher(grpQ).test(f.fileName || '')).map(([cs, f]) => (
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
      <p className="settings-note">
        Find every opened file with no tracker book. Each gets a best guess — an existing book when the title <em>and</em> length
        really fit, a new <b>AI-generated</b> book when nothing comes close, or <b>leave unlinked</b> when it is only a partial
        match — and every guess is a dropdown away from being changed before anything is written.
      </p>
      <div className="lj-inline">
        <button disabled={!!busy} onClick={scanUnlinked}>🔍 Scan opened files</button>
        {bulk && <span className="settings-note" style={{ margin: 0 }}>{bulk.length} unlinked · {tierCount.strong} sure · {tierCount.weak} to review · {tierCount.none} new</span>}
      </div>
      {bulk && (
        <div className="lj-cleanup">
          <div className="lj-tablewrap">
            <table className="lj-table lj-bulk">
              <thead>
                <tr><th>File</th><th>Words</th><th>Read</th><th>Match</th><th>Link to</th><th></th></tr>
                <tr className="lj-filter-row">
                  <th><TextF value={bulkF.file} onChange={(v) => setBulkF({ ...bulkF, file: v })} label="file" /></th>
                  <th><RangeF value={bulkF.words} onChange={(v) => setBulkF({ ...bulkF, words: v })} label="words" unit="k" /></th>
                  <th><RangeF value={bulkF.read} onChange={(v) => setBulkF({ ...bulkF, read: v })} label="% read" /></th>
                  <th>
                    <select value={bulkF.tier} onChange={(e) => setBulkF({ ...bulkF, tier: e.target.value })} aria-label="Filter by match">
                      <option value="all">all</option><option value="strong">✓ sure</option><option value="weak">? review</option><option value="none">– none</option>
                    </select>
                  </th>
                  <th colSpan={2} />
                </tr>
              </thead>
              <tbody>
                {bulk.filter((r) => { const t = textMatcher(bulkF.file).test; return (!t || t(`${r.title} ${r.fileName || ''}`)) && inRange(r.words, ...bulkF.words, 1000) && inRange(r.coverage * 100, ...bulkF.read) && (bulkF.tier === 'all' || r.tier === bulkF.tier); }).map((r) => {
                  const toBook = r.target !== 'skip' && !r.target.startsWith('new:');
                  const dupe = toBook && bulk.some((o) => o !== r && o.target === r.target);
                  const taken = toBook ? fileOf[r.target] : null;
                  return (
                    <Fragment key={r.cs}>
                      <tr className={`${r.state ? `st-${r.state}` : ''} ${!r.state && r.target === 'skip' ? 'skip' : ''}`.trim()}>
                        <td className="lj-bulk-name" title={r.fileName}>{r.title}</td>
                        <td>{r.words ? r.words.toLocaleString() : '—'}</td>
                        <td>{Math.round(r.coverage * 100)}%</td>
                        <td>{r.state
                          ? <span className={`lj-tier t-${r.state}`} title={r.outcome || ''}>{r.state === 'busy' ? '⟳ working…' : r.state === 'linked' ? '✓ linked' : r.state === 'created' ? '✓ created' : '✕ failed'}</span>
                          : <span className={`lj-tier t-${r.tier}`} title={r.why}>{r.tier === 'strong' ? '✓ sure' : r.tier === 'weak' ? '? review' : '– none'}</span>}</td>
                        <td>
                          {r.state === 'linked' || r.state === 'created' ? <span className="lj-bulk-done">{r.outcome}</span> : (
                          <select disabled={!!busy} value={r.target} onChange={(e) => setTarget(r.cs, e.target.value)} aria-label={`Link ${r.title} to`}>
                            <option value="skip">— leave unlinked</option>
                            <optgroup label="Create a new tracker book">
                              <option value="new:ai-gen">＋ AI-generated</option>
                              <option value="new:long">＋ Long-form book</option>
                              <option value="new:short">＋ Short-form</option>
                              <option value="new:article">＋ Article</option>
                            </optgroup>
                            {r.cands.length > 0 && (
                              <optgroup label="Existing books">
                                {r.cands.map((c) => <option key={c.book.id} value={c.book.id}>{Math.round(c.score * 100)}% · {c.book.title}{c.book.author ? ` — ${c.book.author}` : ''}{fileOf[c.book.id] ? ' 🔗' : ''}</option>)}
                              </optgroup>
                            )}
                          </select>)}
                          {r.state === 'failed' && <span className="lj-bulk-warn" title={r.outcome}>⚠ {r.outcome}</span>}
                          {dupe && !r.state && <span className="lj-bulk-warn" title="Another row targets the same book. A book keeps one linked file, so only the last one applied stays linked — group editions under Settings → Book Groups instead.">⚠ twice</span>}
                          {taken && !dupe && !r.state && <span className="lj-bulk-warn" title={`Already linked to “${nameOf(taken)}” — applying moves that link to this file (group editions under Settings → Book Groups instead)`}>⚠ relink</span>}
                        </td>
                        <td className="lj-bulk-acts">{r.state !== 'linked' && r.state !== 'created' && <button disabled={!!busy} onClick={() => setPick(pick?.cs === r.cs ? null : { cs: r.cs, q: '' })} title="Search the whole library for the right book">🔍</button>}</td>
                      </tr>
                      {pick?.cs === r.cs && (
                        <tr className="lj-bulk-pickrow"><td colSpan={6}>
                          <span className="lj-anth-pick">
                            <input autoFocus placeholder="Search title or author…" value={pick.q} onChange={(e) => setPick({ cs: r.cs, q: e.target.value })} aria-label="Search books" />
                            {pickMatches.map((b) => <button key={b.id} onClick={() => chooseBook(r, b)}>{b.title}{b.author ? ` — ${b.author}` : ''}</button>)}
                            {pick.q.trim() && !pickMatches.length && <em className="settings-note" style={{ margin: 0 }}>no book matches</em>}
                          </span>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {busy && (
            <div className="lj-inline">
              <div className="imp-bar" style={{ flex: '1 1 160px', maxWidth: 320 }}><div className="imp-fill" style={{ width: `${(busy.done / busy.total) * 100}%` }} /></div>
              <span className="settings-note" style={{ margin: 0 }}>{busy.done + 1}/{busy.total} — {busy.label}…</span>
            </div>
          )}
          <div className="lj-inline">
            <button className="toggle-on" disabled={!!busy || (!nLink && !nNew)} onClick={applyBulk}>{busy ? `⟳ Applying ${busy.done}/${busy.total}…` : `✓ Apply — link ${nLink}, create ${nNew}`}</button>
            <button disabled={!!busy} onClick={() => { setBulk(null); setPick(null); }}>Dismiss</button>
          </div>
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
  const [monthPick, setMonthPick] = useState(null); // { y, m } — clicked heat tile → that month's finishes
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
      <div className="lj-heat lj-heat-compact">
        <div className="lj-heat-row lj-heat-head"><span className="lj-heat-yr" />{MON.map((m, i) => <span key={i} className="lj-heat-mlabel">{m}</span>)}</div>
        {hm.years.map((y) => (
          <div key={y} className="lj-heat-row">
            <span className="lj-heat-yr">{y}</span>
            {hm.cells[y].map((c, mi) => {
              const lvl = hm.max ? c / hm.max : 0;
              const on = monthPick && monthPick.y === y && monthPick.m === mi;
              return (
                <button
                  key={mi}
                  className={`lj-heat-cell${on ? ' on' : ''}`}
                  title={`${y}-${String(mi + 1).padStart(2, '0')}: ${c} finished — click to list them`}
                  style={{ background: c ? `color-mix(in srgb, var(--toggle-active-bg) ${Math.round(20 + lvl * 80)}%, transparent)` : 'var(--divider)' }}
                  onClick={() => setMonthPick(on ? null : { y, m: mi })}
                />
              );
            })}
          </div>
        ))}
      </div>
      {monthPick && (() => {
        const key = `${monthPick.y}-${String(monthPick.m + 1).padStart(2, '0')}`;
        const fins = cum.filter((r) => r.date.startsWith(key));
        return (
          <div className="lj-month-fins">
            <div className="lj-month-fins-head"><b>{key}</b> — {fins.length} finish{fins.length === 1 ? '' : 'es'} <button className="close-x" onClick={() => setMonthPick(null)}>×</button></div>
            {fins.length === 0 && <p className="settings-note">Nothing finished this month.</p>}
            <ul className="lj-recent">
              {fins.map((r) => <li key={r.id}><b>{r.title}</b> — {r.author} <em>{r.date}</em></li>)}
            </ul>
          </div>
        );
      })()}
      <p className="settings-note">{hm.total} dated finishes across {hm.years.length} year{hm.years.length === 1 ? '' : 's'} — click a tile to see that month's books.</p>
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
function AnalyticsView({ books, dayAgg = [], ai = null, splitTypes = false, onSplitTypes }) {
  const pace = useMemo(() => paceByYear(books), [books]);
  const gt = useMemo(() => genreTrend(books, 6), [books]);
  const rb = useMemo(() => recommenderBreakdown(books), [books]);
  if (pace.length === 0 && rb.length <= 1 && !dayAgg.length) return <p className="settings-note">Not much to chart yet — mark some books finished (with dates) and attribute a few recommendations.</p>;
  const maxBooks = Math.max(1, ...pace.map((p) => p.books));
  const maxGT = Math.max(1, ...gt.rows.map((r) => r.total));
  const maxRec = Math.max(1, ...rb.map((r) => r.total));
  return (
    <div className="lj-analytics">
      <label className="inline-check" title="Break the numbers out by long-form vs short-form/articles vs AI-generated content (shared with the Dashboard toggle)">
        <input type="checkbox" checked={splitTypes} onChange={(e) => onSplitTypes?.(e.target.checked)} /> Split by content type
      </label>
      {splitTypes && <TypeSplit books={books} />}
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
// The shared AI-cowork-sync panel (https://adervec.github.io/cowork.js) — the same chrome every app and
// CoworkSyncHub show. Loaded from the maker portal; until it loads (or offline) the cowork group renders
// exactly as before, so nothing depends on it.
function usePanelReady() {
  const [ready, setReady] = useState(() => !!(window.customElements && customElements.get('cowork-panel')));
  useEffect(() => {
    if (ready || !window.customElements) return undefined;
    let on = true;
    customElements.whenDefined('cowork-panel').then(() => { if (on) setReady(true); });
    return () => { on = false; };
  }, [ready]);
  return ready;
}
async function writeToDir(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
}
async function readFromDir(dir, name) {
  try { const fh = await dir.getFileHandle(name); return await (await fh.getFile()).text(); } catch { return null; }
}

function AiView({ books, ai, global, bindMap = {}, onReload }) {
  // Reading-progress bundle (daily/weekly totals, streak, in-flight books) attached to every export,
  // so cowork daily/weekly summary tasks have the data. Built fresh at call time from the file records.
  // The algorithmic weekly summaries ride along so a cowork task can return dressed-up `weeklies`.
  const datasetWithProgress = async (light) => {
    const progress = buildProgress(await allFiles().catch(() => []), { books, bindMap, days: 63 });
    progress.weeklySummaries = weeklySummaries(progress.days, books, { weeks: 8 });
    const ds = buildDataset(books, { light, progress });
    ds.queues = queuesForDataset(await getLibraryRef('queues').catch(() => []), books); // for queue advice
    return ds;
  };
  // Request builder: a checkbox TREE of every sync action (cowork folder / direct API / cloud),
  // each row carrying its last-run info and its own schedule. Selection is session-local.
  const [sel, setSel] = useState(() => new Set(['cw-light']));
  // A reply waiting for review: { rows, dropped, ops, source, hash } — nothing is written until Apply.
  const [review, setReview] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [openExplain, setOpenExplain] = useState(null);
  const [question, setQuestion] = useState(ai?.question || ''); // for the "Ask a question" operation
  const [dir, setDir] = useState(null);
  const [dirPath, setDirPath] = useState(ai?.coworkDirPath || '');
  const panelReady = usePanelReady();
  const panelRef = useRef(null);
  // when the folder reply was last read in, so the shared panel can say "answered" (device-local)
  const [lastRead, setLastRead] = useState(() => { try { return +localStorage.getItem('tr-cowork-lastread') || 0; } catch { return 0; } });
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [histView, setHistView] = useState('list');
  const [calCursor, setCalCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [dayFilter, setDayFilter] = useState(null);
  const keyOk = anthropicConfigured(global?.anthropicKey);
  const model = global?.anthropicModel || 'claude-sonnet-5';
  const booksById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
  // Device role: once a sync machine is designated, every other device drops to view-only status.
  const deviceId = getDeviceId();
  const { role, machine } = syncRole(ai, deviceId);
  const viewer = role === 'viewer';
  const schedules = ai?.schedules || {};
  const actionRuns = ai?.actionRuns || {};
  const history = useMemo(() => mergedHistory(ai), [ai]);
  const coworkTarget = (dirPath || '').trim() || dir?.name || '';

  useEffect(() => { getFsHandle('journeyCoworkDir').then(setDir).catch(() => {}); }, []);

  // Related-activity feed entries (kept for compatibility — the merged history displays them).
  const actEntry = (kind, text) => ({ at: Date.now(), kind, text });
  async function logActivity(kind, text) {
    await saveJourneyAi({ ...(ai || {}), activity: [...(ai?.activity || []), actEntry(kind, text)].slice(-40) });
    onReload();
  }

  const persistAi = async (patch) => { await saveJourneyAi({ ...(ai || {}), ...patch }); onReload(); };
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setSched = (id, v) => persistAi({ schedules: { ...schedules, [id]: v } });
  const designate = () => persistAi({ syncMachine: { deviceId, name: (global?.deviceName || '').trim() || deviceKind(), at: Date.now() } });
  const releaseRole = () => persistAi({ syncMachine: null });

  // Every reply — folder, paste or API — is filtered by the operations it was REQUESTED for
  // (coworkOps.sanitizeOutput: anything else is dropped, with the reason) and staged as review rows.
  async function stageReply(text, ops, source) {
    const hash = contentHash(text);
    if ((ai?.ledger || []).includes(hash)) { setMsg('That reply was already applied.'); return; }
    const queues = (await getLibraryRef('queues').catch(() => null)) || [];
    const queuedIds = new Set(liveQueues(queues).flatMap((q) => q.ids || []));
    const { output, dropped } = sanitizeOutput(parseAiOutput(text), ops, { booksById, bindMap, queuedIds, queues });
    const files = Object.fromEntries((await allFiles().catch(() => [])).map((f) => [f.checksum, f]));
    const rows = planRows(output, { booksById, files });
    setReview({ rows, dropped, ops, source, hash });
    setPicked(new Set(rows.map((r) => r.key)));
    setMsg(rows.length
      ? `Reply ready for review: ${rows.length} proposed change(s)${dropped.length ? `, ${dropped.length} out-of-scope item(s) discarded` : ''}. Nothing is written until you apply.`
      : `Nothing in that reply is allowed by the requested operation(s)${dropped.length ? ` — ${dropped.length} item(s) discarded` : ''}.`);
  }
  async function applyReview() {
    if (!review) return;
    const rows = review.rows.filter((r) => picked.has(r.key));
    if (!rows.length) { setMsg('Nothing ticked.'); return; }
    setBusy(true);
    try {
      const base = { ...(ai || {}), ledger: [...(ai?.ledger || []), review.hash].slice(-50) };
      const r = await commitRows(rows, { books, ai: base, ops: review.ops, source: review.source });
      setMsg(`Applied: ${r.summary}. ↶ Undo puts it all back.`);
      setReview(null);
      onReload();
    } catch (e) { setMsg('Apply failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function undoApply() {
    setBusy(true);
    try { const r = await undoLastApply(ai); setMsg(r.summary); onReload(); }
    catch (e) { setMsg('Undo failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function snapshotNow() {
    if (!dir) { setMsg('Choose the cowork folder first.'); return; }
    setBusy(true);
    try {
      const n = await writeSnapshot(dir);
      const cur = recordRun((await getJourneyAi().catch(() => null)) || ai || {}, ['cw-snapshot'], { at: Date.now(), kind: 'cowork', target: coworkTarget, ok: true, note: `wrote snapshot (${n} files)` });
      await saveJourneyAi(cur); onReload();
      setMsg(`Snapshot written: ${n} files in ${coworkTarget || dir.name}/snapshot/ (read-only for agents — see its README.md).`);
    } catch (e) { setMsg('Snapshot failed: ' + (e?.message || e)); }
    setBusy(false);
  }

  async function chooseFolder() {
    try { const h = await window.showDirectoryPicker({ id: 'tachyread-journey-cowork', mode: 'readwrite' }); await setFsHandle('journeyCoworkDir', h); setDir(h); }
    catch { /* cancelled */ }
  }

  // Run everything checked in the tree, in transport order: API first (its apply saves the ai
  // record), then re-read the record and fold in the cowork write + cloud syncs + run stamps.
  async function runSelected(onlyCowork) {
    const ids = [...sel].filter((id) => actionById(id)).filter((id) => onlyCowork !== true || id.startsWith('cw-'));
    if (!ids.length) { setMsg('Nothing checked — tick at least one action in the tree.'); return; }
    setBusy(true); setMsg('Running selected actions…');
    const now = Date.now();
    const parts = [];
    let apiTried = false; let apiOk = true; let apiNote = '';
    if (ids.includes('api-light')) {
      apiTried = true;
      if (!keyOk) { apiOk = false; apiNote = 'skipped — no Anthropic API key'; }
      else {
        try {
          const dataset = await datasetWithProgress(true); // API path is always the compact subset
          const instr = opsInstruction(['cw-light']);
          const { system, messages } = buildApiMessages(dataset, instr);
          const reply = await askClaude(messages, { key: global.anthropicKey, model, system, maxTokens: 2048, source: 'trackyread-ai' });
          await stageReply(reply, instr.ops, `API (${model})`);
          apiNote = 'ran — reply staged for review'; parts.push('API reply ready for review below');
        } catch (e) { apiOk = false; apiNote = String(e?.message || e); parts.push('API failed'); }
      }
    }
    let cur = (await getJourneyAi().catch(() => null)) || ai || {};
    if (ids.includes('cw-snapshot') && dir) {
      try { const n = await writeSnapshot(dir); cur = recordRun(cur, ['cw-snapshot'], { at: now, kind: 'cowork', target: coworkTarget, ok: true, note: `wrote snapshot (${n} files)` }); parts.push('snapshot written'); }
      catch (e) { cur = recordRun(cur, ['cw-snapshot'], { at: now, kind: 'cowork', target: coworkTarget, ok: false, note: String(e?.message || e) }); parts.push('snapshot failed'); }
    }
    const coworkIds = ids.filter((id) => COWORK_OPS[id]);
    if (coworkIds.length) {
      let ok = true; let note;
      if (!dir) { ok = false; note = 'no cowork folder chosen'; parts.push('cowork skipped (no folder)'); }
      else {
        try {
          const ci = combineCoworkInstruction(coworkIds, { question });
          if (!ci) throw new Error('nothing to send — “Ask a question” needs a question');
          const dataset = await datasetWithProgress(ci.mode === 'light');
          if (!ids.includes('cw-snapshot')) await writeSnapshot(dir); // the agent reads snapshot/ too
          await writeToDir(dir, 'journey-cowork-request.json', JSON.stringify(buildCoworkRequest(dataset, ci), null, 2));
          await writeToDir(dir, 'journey-instructions.md', buildDigest(dataset, ci));
          await writeToDir(dir, 'cowork.json', JSON.stringify(buildCoworkManifest(), null, 2)); // discovery manifest for hubs
          cur = { ...cur, instruction: { ...ci, updatedAt: now } }; // the reply is filtered by these ops
          note = `wrote request (${ci.mode})`; parts.push(`cowork request written (${ci.mode})`);
        } catch (e) { ok = false; note = String(e?.message || e); parts.push('cowork write failed'); }
      }
      cur = recordRun(cur, coworkIds, { at: now, kind: 'cowork', target: coworkTarget, ok, note });
    }
    for (const id of ids.filter((d) => d.startsWith('cloud-'))) {
      let ok = true; let note;
      const cfg = global?.sync || {};
      const p = getSyncProvider(cfg.provider);
      const target = p?.label || cfg.provider || 'no provider';
      try {
        if (!p || !p.supported()) { ok = false; note = 'no sync provider configured (Data → Cloud sync)'; }
        else if (id === 'cloud-progress') { const r = await syncWithProvider(cfg.provider, cfg); note = `progress synced (${Math.round((r.bytes || 0) / 1024)} KB)`; }
        else { const r = await syncLibraryWithProvider(cfg.provider, cfg); note = r.skipped ? 'library already in sync' : `library synced (${r.books ?? '?'} books)`; }
      } catch (e) { ok = false; note = String(e?.message || e); }
      parts.push(`${id === 'cloud-progress' ? 'progress' : 'library'}: ${note}`);
      cur = recordRun(cur, [id], { at: now, kind: 'cloud', target, ok, note });
    }
    if (apiTried) cur = recordRun(cur, ['api-light'], { at: now, kind: 'api', target: model, ok: apiOk, note: apiNote });
    await saveJourneyAi(cur);
    onReload();
    setMsg(parts.length ? parts.join(' · ') : 'Done.');
    setBusy(false);
  }

  async function readResponse() {
    if (!dir) return; setBusy(true); setMsg('Reading response…');
    try {
      const t = await readFromDir(dir, 'journey-cowork-response.json');
      if (!t) { setMsg('No journey-cowork-response.json in the folder yet.'); }
      else {
        // Filtered by the operations the last request asked for (an old request without ops is
        // treated as the report-only analysis operation — the safest reading).
        await stageReply(t, ai?.instruction?.ops || ['cw-light'], 'cowork folder');
        const n = Date.now(); setLastRead(n);
        try { localStorage.setItem('tr-cowork-lastread', String(n)); } catch { /* quota */ }
      }
    } catch (e) { setMsg('Read failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function copyDigest() {
    try {
      const ci = combineCoworkInstruction([...sel], { question }) || opsInstruction(['cw-light']);
      await navigator.clipboard.writeText(buildDigest(await datasetWithProgress(ci.mode === 'light'), ci));
      await logActivity('digest', `Copied ${ci.mode} digest to clipboard`);
      setMsg('Digest copied — paste it into a Claude chat, then paste the JSON reply below.');
    } catch { setMsg('Clipboard blocked — use the cowork folder instead.'); }
  }
  async function applyPasted() {
    setBusy(true);
    const ticked = [...sel].filter((id) => COWORK_OPS[id]);
    try { await stageReply(pasted, ticked.length ? ticked : (ai?.instruction?.ops || ['cw-light']), 'pasted reply'); setPasted(''); }
    catch (e) { setMsg('Could not parse that reply: ' + (e?.message || e)); }
    setBusy(false);
  }

  // the shared panel: our cowork state in, its header buttons back as `cowork-action` events
  useEffect(() => {
    const p = panelRef.current;
    if (!p || !panelReady) return;
    p.setAttribute('mode', 'data'); // attribute, not a JSX prop: React 19 would assign a property
    const req = Math.max(0, ...Object.entries(actionRuns)
      .filter(([id, r]) => id.startsWith('cw-') && r && r.ok).map(([, r]) => r.at || 0)) / 1000;
    const rep = lastRead / 1000;
    p.data = {
      app: 'tachyread', folder: coworkTarget || 'no folder connected',
      channels: [{ channel: 'journey', request_mtime: req, reply_mtime: rep, pending: !!req && rep < req, answered: !!req && rep >= req }],
      actions: viewer ? [] : [
        { id: 'connect', label: dir ? 'Change folder' : 'Connect folder', primary: !dir },
        ...(dir ? [{ id: 'push', label: 'Send requests', primary: true }, { id: 'poll', label: 'Check for replies' }] : []),
      ],
      channelActions: [],
    };
  }, [panelReady, dir, coworkTarget, actionRuns, lastRead, viewer]);
  useEffect(() => {
    const p = panelRef.current;
    if (!p) return undefined;
    const h = (ev) => {
      const a = ev.detail?.action;
      if (a === 'connect') chooseFolder();
      else if (a === 'push') runSelected(true);
      else if (a === 'poll') readResponse();
    };
    p.addEventListener('cowork-action', h);
    return () => p.removeEventListener('cowork-action', h);
  });

  const targetOf = (g) => (g.kind === 'cowork' ? (coworkTarget || 'no folder chosen')
    : g.kind === 'api' ? model
      : (getSyncProvider(global?.sync?.provider)?.label || global?.sync?.provider || 'no provider'));
  const filteredHistory = dayFilter ? history.filter((h) => dayKey(h.at) === dayFilter) : history;

  return (
    <div className="lj-ai">
      {/* Sync-machine role: once designated, only that device builds/runs — the rest watch. */}
      <div className={`cw-role cw-role-${role}`}>
        {role === 'machine' && (
          <><span>🖥 <b>This device is the sync machine</b> — requests and schedules run here; other devices are view-only.</span>
            <button onClick={releaseRole}>Release role</button></>
        )}
        {role === 'viewer' && (
          <><span>👁 <b>View-only.</b> <b>{machine.name || 'Another device'}</b> is the sync machine (designated {fmtDateTime(machine.at)}). Status and history stay live via tracker sync.</span>
            <button onClick={designate}>Take over as sync machine</button></>
        )}
        {role === 'open' && (
          <><span>No sync machine designated — every device currently has full sync controls.</span>
            <button onClick={designate}>🖥 Make this device the sync machine</button>
            <span className="settings-note">Typically the desktop; other devices then become view-only status monitors.</span></>
        )}
      </div>

      <div className="rh-section-h">{viewer ? 'Sync status (view-only)' : 'Request builder'}</div>
      {SYNC_ACTION_GROUPS.map((g) => {
        if (g.needsKey && !keyOk) return null; // no key → the whole group vanishes, no nagging note
        const onCount = g.actions.filter((a) => sel.has(a.id)).length;
        const allOn = onCount === g.actions.length;
        const groupEl = (
          <div className="cwt-group">
            <label className="cwt-ghead">
              <input
                type="checkbox" disabled={viewer} checked={allOn}
                ref={(el) => { if (el) el.indeterminate = onCount > 0 && !allOn; }}
                onChange={() => setSel((s) => { const n = new Set(s); for (const a of g.actions) { if (allOn) n.delete(a.id); else n.add(a.id); } return n; })}
              />
              <span className="cwt-gico">{g.icon}</span><b>{g.label}</b>
              <span className="cwt-target" title="Where this group's actions land">→ {targetOf(g)}</span>
            </label>
            {g.actions.map((a, ai2) => {
              const run = actionRuns[a.id];
              const op = COWORK_OPS[a.id];
              const prevOp = COWORK_OPS[g.actions[ai2 - 1]?.id];
              const sub = op && op.group !== prevOp?.group ? OP_GROUPS.find((x) => x.id === op.group) : null;
              const ex = op ? op.explain : a.id === 'cw-snapshot' ? {
                sends: 'Nothing goes to an AI. Writes read-only files into the folder\'s snapshot/ subfolder: reading days, books, queues, goals, typing, reading aloud, narration quality, focus, an activity log and a README explaining every field.',
                changes: 'Nothing in Tachyread — the app never reads these files back. Files in snapshot/ are overwritten each time. No document text, audio or keys are written.',
                review: 'Nothing to review. Also written automatically with every operation request.',
              } : null;
              return (
                <Fragment key={a.id}>
                {sub && <div className="cwt-sub">{sub.label}</div>}
                <div className="cwt-row">
                  <label className="cwt-main">
                    <input type="checkbox" disabled={viewer} checked={sel.has(a.id)} onChange={() => toggleSel(a.id)} />
                    <span className="cwt-ico" aria-hidden="true">{a.icon}</span>
                    <span className="cwt-txt"><span className="cwt-lbl">{a.label}</span><span className="cwt-desc">{a.desc}</span></span>
                  </label>
                  <span
                    className={`cwt-last${run && !run.ok ? ' err' : ''}`}
                    title={run ? `${run.ok ? 'OK' : 'Failed'} — ${fmtDateTime(run.at)}${run.target ? ` → ${run.target}` : ''}${run.note ? ` · ${run.note}` : ''}` : 'Never run'}
                  >
                    {run ? `${run.ok ? '✓' : '⚠'} ${fmtAgo(run.at)}${run.auto ? ' · auto' : ''}` : '· never run'}
                  </span>
                  <select
                    className="cwt-sched" disabled={viewer} value={schedules[a.id] || 'off'}
                    title="Schedule this action — it then runs automatically on the sync machine"
                    onChange={(e) => setSched(a.id, e.target.value)}
                  >
                    {SCHEDULE_OPTS.map((o) => <option key={o.id} value={o.id}>{o.id === 'off' ? '⏰ manual' : `⏰ ${o.label}`}</option>)}
                  </select>
                  {ex && <button type="button" className="cwt-explain-btn" aria-expanded={openExplain === a.id} onClick={() => setOpenExplain(openExplain === a.id ? null : a.id)} title="Exactly what this does and may change">{openExplain === a.id ? '▾ details' : '▸ details'}</button>}
                </div>
                {ex && openExplain === a.id && (
                  <div className="cwt-explain">
                    <div><b>Sends / reads:</b> {ex.sends}</div>
                    <div><b>May change:</b> {ex.changes}</div>
                    {op && <div><b>Never changes:</b> {op.never || NEVER_CHANGED}</div>}
                    <div><b>Review &amp; undo:</b> {ex.review}</div>
                    {op && <div className="settings-note" style={{ margin: '2px 0 0' }}>Enforced by the app, not left to the AI: when the reply comes back, anything outside this permission is discarded and listed.</div>}
                  </div>
                )}
                {a.id === 'cw-ask' && sel.has('cw-ask') && !viewer && (
                  <textarea className="lj-instr cwt-question" rows={2} placeholder="Your question — e.g. “Is my typing accuracy improving since I switched to word-backspace-only?”"
                    value={question} onChange={(e) => setQuestion(e.target.value)} onBlur={() => persistAi({ question })} aria-label="Question for the agent" />
                )}
                </Fragment>
              );
            })}
            {g.id === 'cowork' && (
              <div className="lj-inline cwt-foot">
                {!panelReady && <button onClick={chooseFolder} disabled={viewer}>{dir ? `📁 ${dir.name}` : '📁 Choose cowork folder…'}</button>}
                <input
                  className="cwt-path" type="text" disabled={viewer}
                  placeholder="Full folder path (annotation — shown in history; browsers can't read real paths)"
                  value={dirPath} onChange={(e) => setDirPath(e.target.value)} onBlur={() => persistAi({ coworkDirPath: dirPath })}
                />
              </div>
            )}
          </div>
        );
        return g.id === 'cowork'
          ? <cowork-panel key={g.id} ref={panelRef} class="cwt-panel">{groupEl}</cowork-panel>
          : <Fragment key={g.id}>{groupEl}</Fragment>;
      })}
      {!viewer && (
        <div className="lj-inline">
          <button className="toggle-on" disabled={busy || sel.size === 0} onClick={() => runSelected()}>▶ Run selected ({[...sel].filter((id) => actionById(id)).length})</button>
          {dir && <button disabled={busy} onClick={readResponse} title="Read the agent's reply — it is filtered and shown for review, never applied straight away">📥 Read response</button>}
          {dir && <button disabled={busy} onClick={snapshotNow} title="Write the read-only activity snapshot now">📸 Snapshot now</button>}
          <span className="settings-note">Scheduled actions run automatically — on the sync machine only.</span>
        </div>
      )}

      {review && (
        <div className="cw-review">
          <div className="rh-section-h">Review the reply — {review.source} · {review.ops.map((id) => COWORK_OPS[id]?.label || id).join(', ')}</div>
          <p className="settings-note">Nothing has been written yet. Untick anything you don&rsquo;t want, then apply. Applied changes can be undone in one step.</p>
          {review.rows.length > 0 && (
            <div className="lj-q-box cw-review-box">
              <table className="lj-cand cw-review-table">
                <thead><tr><th aria-label="Apply" /><th>Change</th><th>Now</th><th>Proposed</th></tr></thead>
                <tbody>
                  {review.rows.map((r) => (
                    <tr key={r.key}>
                      <td><input type="checkbox" checked={picked.has(r.key)} aria-label={`Apply: ${r.label}`} onChange={() => setPicked((s0) => { const s1 = new Set(s0); if (s1.has(r.key)) s1.delete(r.key); else s1.add(r.key); return s1; })} /></td>
                      <td title={r.label}>{r.label}</td>
                      <td title={String(r.from ?? '')} className="lj-qdim">{r.from == null || r.from === '' ? '—' : String(r.from)}</td>
                      <td title={String(r.to ?? '')}>{String(r.to ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {review.dropped.length > 0 && (
            <details className="lj-fold">
              <summary>{review.dropped.length} item(s) in the reply were outside the requested operation(s) and were discarded</summary>
              <ul className="lj-clean-list">{review.dropped.slice(0, 200).map((d, i) => <li key={i}><b>{d.what}</b> — {d.why}</li>)}</ul>
            </details>
          )}
          <div className="lj-inline">
            <button className="toggle-on" disabled={busy || !picked.size} onClick={applyReview}>Apply {picked.size} ticked</button>
            <button onClick={() => setPicked(new Set(review.rows.map((r) => r.key)))}>Tick all</button>
            <button onClick={() => setPicked(new Set())}>Untick all</button>
            <button onClick={() => { setReview(null); setMsg('Reply discarded — nothing was changed.'); }}>Discard reply</button>
          </div>
        </div>
      )}
      {(ai?.lastApply || (ai?.applyLog || []).length > 0) && (
        <>
          <div className="rh-section-h">Applied changes</div>
          {ai?.lastApply && !viewer && (
            <div className="lj-inline">
              <span className="settings-note" style={{ margin: 0 }}>Last apply {fmtDateTime(ai.lastApply.at)}: {ai.lastApply.summary}</span>
              <button disabled={busy} onClick={undoApply} title="Restore every book, link, note and AI field the last apply changed (books you edited since are left alone)">↶ Undo last apply</button>
            </div>
          )}
          <details className="lj-fold">
            <summary>Apply log ({(ai?.applyLog || []).length})</summary>
            <ul className="lj-clean-list">{(ai?.applyLog || []).slice(0, 50).map((e, i) => <li key={i}>{fmtDateTime(e.at)} — {e.summary}{e.source ? ` · ${e.source}` : ''}{e.auto ? ' · auto' : ''}</li>)}</ul>
          </details>
        </>
      )}
      {ai?.briefs && Object.keys(ai.briefs).length > 0 && (
        <>
          <div className="rh-section-h">Morning briefs</div>
          {Object.entries(ai.briefs).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 10).map(([date, b], i) => (
            <details key={date} className="lj-hist" open={i === 0}>
              <summary><span>{date}</span></summary>
              <p className="lj-analysis cw-brief">{b.text}</p>
            </details>
          ))}
        </>
      )}

      {(ai?.answers || []).length > 0 && (
        <>
          <div className="rh-section-h">Answers</div>
          {ai.answers.slice(0, 10).map((x, i) => (
            <details key={x.at} className="lj-hist" open={i === 0}>
              <summary><span>{fmtDateTime(x.at)}{x.question ? ` — ${x.question}` : ''}</span></summary>
              <p className="lj-analysis cw-brief">{x.text}</p>
            </details>
          ))}
        </>
      )}

      <div className="rh-section-h cw-hist-h">
        <span>Sync history ({history.length})</span>
        <span className="cw-hist-toggle">
          <button className={histView === 'list' ? 'toggle-on' : ''} onClick={() => { setHistView('list'); setDayFilter(null); }}>☰ List</button>
          <button className={histView === 'cal' ? 'toggle-on' : ''} onClick={() => setHistView('cal')}>📅 Calendar</button>
        </span>
      </div>
      {histView === 'cal' && (
        <div className="cwcal">
          <div className="cwcal-nav">
            <button onClick={() => setCalCursor((c) => (c.m ? { y: c.y, m: c.m - 1 } : { y: c.y - 1, m: 11 }))}>‹</button>
            <b>{new Date(calCursor.y, calCursor.m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</b>
            <button onClick={() => setCalCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))}>›</button>
          </div>
          <div className="cwcal-grid">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="cwcal-dow">{d}</span>)}
            {calendarCells(calCursor.y, calCursor.m, history).map((c) => (
              <button
                key={c.key}
                className={`cwcal-cell${c.inMonth ? '' : ' out'}${c.count ? ' has' : ''}${c.errs ? ' err' : ''}${dayFilter === c.key ? ' sel' : ''}`}
                title={c.count ? `${c.count} run(s)${c.errs ? `, ${c.errs} failed` : ''} — click to see them` : undefined}
                onClick={() => setDayFilter(dayFilter === c.key ? null : (c.count ? c.key : dayFilter))}
              >
                <span>{c.day}</span>{c.count > 0 && <em>{c.count}</em>}
              </button>
            ))}
          </div>
        </div>
      )}
      {(histView === 'list' || dayFilter) && (
        <div className="cw-histlist">
          {filteredHistory.length === 0 && <p className="settings-note">No sync runs yet{dayFilter ? ' on that day' : ''}.</p>}
          {filteredHistory.slice(0, 80).map((h, i) => (
            <div key={`${h.at}-${i}`} className={`cw-histrow${h.ok ? '' : ' err'}`}>
              <span className="cw-hkind" aria-hidden="true">{{ cowork: '🤝', api: '🤖', cloud: '☁️', request: '📤', apply: '✅', digest: '📋' }[h.kind] || '·'}</span>
              <span className="cw-hids">{h.ids?.length ? h.ids.map((id) => actionById(id)?.label || id).join(', ') : (h.note || '—')}</span>
              {h.ids?.length > 0 && h.note ? <span className="cw-hnote">{h.note}</span> : null}
              {h.target ? <span className="cw-htarget" title="Target">→ {h.target}</span> : null}
              {h.auto && <span className="cw-hauto">auto</span>}
              {!h.ok && <span className="cw-herr">failed</span>}
              <em>{fmtDateTime(h.at)}</em>
            </div>
          ))}
        </div>
      )}

      {!viewer && (
        <details className="lj-fold">
          <summary>Copy / paste (manual chat fallback)</summary>
          <div className="lj-inline"><button onClick={copyDigest}>Copy digest to clipboard</button></div>
          <textarea className="lj-instr" rows={3} placeholder="Paste Claude's JSON reply here…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <div className="lj-inline"><button disabled={busy || !pasted.trim()} onClick={applyPasted}>Review pasted reply</button><span className="settings-note" style={{ margin: 0 }}>Filtered by the ticked operations (or the last request&rsquo;s).</span></div>
        </details>
      )}

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

      {msg && <p className="settings-note lj-aimsg">{msg}</p>}
    </div>
  );
}
