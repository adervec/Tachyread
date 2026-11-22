import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import TreeViews from './TreeViews.jsx';
import DataTable from '../components/DataTable.jsx';
import { genreHue } from '../features/bookGraph.js';
import { useSessionState } from '../state/useSessionState.js';
import { todaySummary, localDate } from '../features/todaySummary.js';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { scanMiscategorized, applyRecat, recatSummary } from '../features/journeyRecat.js';
import { forgettingScan, driftingScan } from '../features/journeyForgetting.js';
import { bookCovers, bookCoverSrc, addCover, removeCover, setMaster, coverId, coverSpecToSvg, proceduralCover, coverPromptFor, parseCoverSpec } from '../features/bookCovers.js';
import { fmtDate, fmtDateTime, fmtDay } from '../features/dateFmt.js';
import { t, fmtNum } from '../i18n.js';
import {
  getLibraryBooks, saveLibraryBook, deleteLibraryBook, getLibraryRef, saveLibraryRef,
  getJourneyAi, saveJourneyAi, exportLibraryData, importLibraryData, librarySize, clearLibrary,
  getBinding, setBinding, getSectionBindings, setSectionBinding, allDocMeta, allFiles,
  loadFile, loadReadState, loadDocPayload,
  getCrossNotes, saveCrossNote, deleteCrossNote, allTypingRuns, getSpeechLog,
} from '../state/storage.js';
import { extractTextMeta } from '../features/textMeta.js';
import { createReadingTracker } from '../engine/readingTracker.js';
import { sectionSpan } from '../document/toc.js';
import { askClaude, anthropicConfigured } from '../features/anthropic.js';
import {
  buildDataset, buildDigest, buildProgress, AI_NOTE_TYPES,
  buildCoworkRequest, buildApiMessages, parseAiOutput, contentHash,
} from '../features/journeyAi.js';
import {
  normalizeSeed, filterBooks, libraryStats, exportJourneyMarkdown,
  readStatus, setReadStatus, recommender, STATUS_LABEL,
  distinctValues, pubYear, finishMs, deriveId, bookRating,
  bookTags, allTags, finishCount, logReread, CONTENT_TYPES, contentType, withRereads,
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
import ShelfImportPanel from './ShelfImportPanel.jsx';
import IsbnAdd from '../components/IsbnAdd.jsx';
import ProgressDetailDialog from './ProgressDetailDialog.jsx';
import { getSyncProvider } from '../features/sync/syncProviders.js';
import { syncLibraryWithProvider, syncWithProvider } from '../features/sync/syncManager.js';
import {
  SYNC_ACTION_GROUPS, actionById, combineCoworkInstruction, SCHEDULE_OPTS,
  syncRole, recordRun, mergedHistory, calendarCells, fmtAgo, dayKey,
} from '../features/coworkActions.js';
import { COWORK_OPS, OP_GROUPS, NEVER_CHANGED, sanitizeOutput, planRows, opsInstruction, queuesForDataset, logRequest, opsForReply, opForRow, opForReport, PREP_NOTE_TYPES, reviewFirst, unparkReply } from '../features/coworkOps.js';
import { writeSnapshot, commitRows, undoLastApply, listInbox, readInbox, moveInbox } from '../features/coworkApply.js';
import { getDeviceId } from '../state/storage.js';
import { cloudCoworkDir, wasApplied, markApplied } from '../features/coworkCloud.js';
import { deviceKind } from '../state/device.js';
import { AXES, READER_ARCHETYPES, readerProfile, matchArchetype, currentArchetype, archetypeTrend, archetypeAxes } from '../features/readerArchetype.js';
import { localDay, parseDay } from '../features/localDay.js';
import { sessionsForReview, allSessionIds, sessionLabel, reviewText, appScores } from '../features/sessionReview.js';

// Trigger a client-side file download (same anchor trick DataDialog uses; showSaveFilePicker hangs
// headless so a plain anchor is the reliable path).
function download(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const todayISO = () => localDay();
const clean = (v) => String(v || '').trim();

// Map the Library editor's status pill back onto the book's completion/inProgress/shelf fields.
const applyStatus = (book, status) => setReadStatus(book, status, todayISO());

// Unified vs split view of the headline numbers: bucket books into long-form / short-form+articles /
// AI-generated so throwaway content can be read OUT of the "real" totals at a glance.
const TYPE_BUCKETS = [['long', `📚 ${t('Long-form')}`], ['short', `📄 ${t('Short-form & articles')}`], ['ai-gen', `🤖 ${t('AI-generated')}`]];
const bucketOf = (b) => {
  const ct = contentType(b);
  return ct === 'ai-gen' ? 'ai-gen' : ct === 'short' || ct === 'article' ? 'short' : 'long';
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
        <thead><tr><th>{t('Content')}</th><th>{t('Books')}</th><th>{t('Finished')}</th><th>{t('Words read')}</th><th>{t('Pages read')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{fmtNum(r.total)}</td>
              <td>{fmtNum(r.finished)}</td>
              <td>{r.words ? `${fmtNum(r.words / 1e6, 2, 2)}M` : '—'}</td>
              <td>{r.pages ? fmtNum(r.pages) : '—'}</td>
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
  const year = new Date(now).getFullYear();
  const target = Number(goals?.[year]) || 0;
  const g = useMemo(() => yearGoal(withRereads(books), target, now), [books, target, now]); // a re-read counts in each year it was finished
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const pct = g.target ? Math.min(100, (g.finished / g.target) * 100) : 0;
  return (
    <div className="lj-goal">
      {g.target > 0 ? (
        <>
          <div className="lj-goal-head">
            <b>{t('{year} goal', { year: g.year })}</b>
            <span>{t('{finished} of {target} books', { finished: g.finished, target: g.target })}</span>
            <span className={`lj-goal-badge ${g.finished >= g.target ? 'won' : g.onTrack ? 'on' : 'off'}`}>
              {g.finished >= g.target ? `🏆 ${t('goal hit!')}` : g.onTrack ? `✓ ${t('on track')}` : `⚠ ${t('behind pace')}`}
            </span>
            <span className="lj-spacer" />
            <button className="link-btn" onClick={() => { setVal(String(g.target)); setEditing(true); }}>{t('edit')}</button>
          </div>
          <div className="lj-goal-bar" title={t('{done}/{target} · the tick marks where today sits in the year', { done: g.finished, target: g.target })}>
            <i style={{ width: `${pct}%` }} />
            <em style={{ left: `${g.yearFrac * 100}%` }} />
          </div>
          <p className="settings-note lj-goal-note">
            {g.finished >= g.target
              ? t('Done with {n} days to spare — raise the bar?', { n: g.daysLeft })
              : t('{remaining} to go · need ~{perMonth}/month · current pace projects {projected} by year-end', { remaining: g.remaining, perMonth: g.needPerMonth ?? '—', projected: g.projected ?? '—' })}
          </p>
        </>
      ) : (
        <button onClick={() => { setVal('12'); setEditing(true); }}>🎯 {t('Set a {year} reading goal…', { year })}</button>
      )}
      {editing && (
        <div className="lj-inline">
          <label className="settings-note" style={{ margin: 0 }}>{t('Books in {year}:', { year })}</label>
          <input className="lj-goal-num" type="number" min="1" max="1000" value={val} onChange={(e) => setVal(e.target.value)} />
          <button className="toggle-on" onClick={() => { onSetGoal(year, Math.max(0, Math.round(Number(val) || 0))); setEditing(false); }}>{t('Set goal')}</button>
          {g.target > 0 && <button onClick={() => { onSetGoal(year, 0); setEditing(false); }}>{t('Remove')}</button>}
          <button onClick={() => setEditing(false)}>{t('Cancel')}</button>
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
  const ts = useMemo(() => todaySummary({ dayAgg, fileStats, bookOf: (cs) => byId.get(bindMap[cs]) || null, books, now }), [dayAgg, fileStats, bindMap, byId, books, now]);
  const pace = useMemo(() => recentPace(dayAgg.filter((d) => d.date !== ts.today), { now: now - 86400000 }), [dayAgg, ts.today, now]);
  const wordsTarget = Number(goals?.[`${new Date(now).getFullYear()}-words`]) || 0;
  const wg = useMemo(() => (wordsTarget ? yearWordsGoal(dayAgg, books, linkedIds, wordsTarget, now) : null), [wordsTarget, dayAgg, books, linkedIds, now]);
  // What's next in each queue (first few queues).
  const [nexts, setNexts] = useState([]);
  useEffect(() => {
    let live = true;
    getLibraryRef('queues').then((qs) => {
      if (!live) return;
      // Skip what you're already reading today — "up next" means the one after it.
      const readToday = new Set(ts.files.map((f) => f.book?.id).filter(Boolean));
      setNexts(liveQueues(qs || []).map((q) => { const todo = splitFinished(queueBooks(q, books)).todo; return { q, book: todo.find((b) => !readToday.has(b.id)) || todo[0] || null }; }).filter((x) => x.book).slice(0, 4));
    }).catch(() => {});
    return () => { live = false; };
  }, [books, ts.files]);
  // Today's need = what's left of the year's goal per day, plus today's own share already read.
  const need = wg && wg.remaining > 0 ? Math.round((wg.remaining + ts.words) / Math.max(1, wg.daysLeft + 1)) : null;
  const usual = pace.wordsPerDay;
  const bar = (v, of) => (of ? Math.min(1, v / of) : 0);
  const csOf = {};
  for (const [c, id] of Object.entries(bindMap)) if (!csOf[id]) csOf[id] = c;
  return (
    <div className="lj-today">
      <div className="lj-today-head">
        <b>{t('Today')}</b>
        <span className="settings-note" style={{ margin: 0 }}>{fmtDay(now)}</span>
        <span className="lj-spacer" />
        <span className={`lj-today-streak${ts.streak.readToday ? ' on' : ''}`} title={t('Consecutive days with some reading')}>
          🔥 {!ts.streak.readToday && ts.streak.days ? t.n('{n} day — read today to keep it', '{n} days — read today to keep it', ts.streak.days) : t.n('{n} day', '{n} days', ts.streak.days)}
        </span>
      </div>
      <div className="lj-qstats">
        <div className="ab-stat"><b>{fmtNum(ts.words)}</b><span>{ts.aloudWords ? t('words today ({n} aloud)', { n: fmtNum(ts.aloudWords) }) : t('words today')}</span></div>
        <div className="ab-stat"><b>{fmtMin(ts.secs)}</b><span>{t('active reading')}</span></div>
        <div className="ab-stat"><b>{ts.wpm ?? '—'}</b><span>{pace.wpm ? t('wpm today · usually ~{wpm}', { wpm: pace.wpm }) : t('wpm today')}</span></div>
        <div className="ab-stat" title={t('Your recent words per day (last ~6 weeks, recent days weighted most)')}>
          <b>{usual ? `${Math.round((ts.words / usual) * 100)}%` : '—'}</b><span>{usual ? t('of your usual ~{n}/day', { n: fmtNum(usual) }) : t('of a usual day (no history yet)')}</span>
          {usual ? <Bar pct={bar(ts.words, usual)} label={t('Today against your usual day')} /> : null}
        </div>
        {need != null && (
          <div className="ab-stat" title={t("What's left of this year's words goal, spread over the days left (today included)")}>
            <b>{ts.words >= need ? '✓' : fmtNum(need - ts.words)}</b><span>{ts.words >= need ? t("words goal: today's ~{n} done", { n: fmtNum(need) }) : t("words to go for today's goal share (~{n})", { n: fmtNum(need) })}</span>
            <Bar cls={ts.words >= need ? 'fin' : ''} pct={bar(ts.words, need)} label={t("Today against the words goal's daily share")} />
          </div>
        )}
      </div>
      {ts.files.length > 0 ? (
        <div className="lj-today-list">
          {ts.files.slice(0, 8).map((f) => (
            <div key={f.cs} className="lj-today-row">
              <button className="link-btn" onClick={() => (f.book ? onOpenBook(f.book.id) : onOpenFile(f.cs))} title={f.book ? t('Open in Library') : t('Open the file')}>{f.book?.title || f.name}</button>
              <span className="lj-qdim">{t('{n} words · {time}', { n: fmtNum(f.words), time: fmtMin(f.secs) })}</span>
              <Bar pct={f.coverage} label={t('{pct}% of the book read', { pct: Math.round(f.coverage * 100) })} /><span className="lj-cand-pct">{Math.round(f.coverage * 100)}%</span>
              {!openChecksums.includes(f.cs) && <button onClick={() => onOpenFile(f.cs)} title={t('Continue reading')}>▶</button>}
            </div>
          ))}
        </div>
      ) : <p className="settings-note">{t('Nothing read yet today.')}</p>}
      {ts.finished.length > 0 && <p className="settings-note lj-today-fin">🎉 {t('Finished today: {titles}', { titles: ts.finished.map((b) => b.title).join(', ') })}</p>}
      {nexts.length > 0 && (
        <div className="lj-today-next">
          <span className="settings-note" style={{ margin: 0 }}>{t('Up next:')}</span>
          {nexts.map(({ q, book }) => (
            <span key={q.id} className="lj-today-chip">
              <button className="link-btn" onClick={onQueues} title={t('Queue “{name}”', { name: q.name })}>{q.name}</button> → <button className="link-btn" onClick={() => onOpenBook(book.id)}>{book.title}</button>
              {csOf[book.id] && <button onClick={() => onOpenFile(csOf[book.id])} title={t('Open it')}>▶</button>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Yearly WORDS goal, beside the books one (stored in the same synced goals ref as "<year>-words").
// Counts reading the app recorded this year plus off-app finishes (books with no linked document).
const fmtWords = (n) => (n >= 1e6 ? `${fmtNum(n / 1e6, n >= 1e7 ? 0 : 1, n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
function WordsGoalCard({ books, goals, dayAgg, linkedIds, onSetGoal }) {
  const now = useMemo(() => Date.now(), []); // eslint-disable-line react-hooks/purity
  const year = new Date(now).getFullYear();
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
            <b>{t('{year} words goal', { year: g.year })}</b>
            <span title={t('{app} read in the app + {off} from books finished elsewhere', { app: fmtNum(g.appWords), off: fmtNum(g.offApp) })}>{t('{read} of {target} words', { read: fmtNum(g.read), target: fmtNum(g.target) })}</span>
            <span className={`lj-goal-badge ${g.read >= g.target ? 'won' : g.onTrack ? 'on' : 'off'}`}>
              {g.read >= g.target ? `🏆 ${t('goal hit!')}` : g.onTrack ? `✓ ${t('on track')}` : `⚠ ${t('behind pace')}`}
            </span>
            <span className="lj-spacer" />
            <button className="link-btn" onClick={() => { setVal(String(g.target)); setEditing(true); }}>{t('edit')}</button>
          </div>
          <div className="lj-goal-bar" title={t('{done}/{target} · the tick marks where today sits in the year', { done: fmtWords(g.read), target: fmtWords(g.target) })}>
            <i style={{ width: `${pct}%` }} />
            <em style={{ left: `${g.yearFrac * 100}%` }} />
          </div>
          <p className="settings-note lj-goal-note">
            {g.read >= g.target
              ? t('Done with {n} days to spare — raise the bar?', { n: g.daysLeft })
              : t('{remaining} to go · need ~{perDay} words/day · current pace projects {projected} by year-end', { remaining: fmtWords(g.remaining), perDay: fmtNum(g.needPerDay ?? 0), projected: g.projected != null ? fmtWords(g.projected) : '—' })}
            {' · '}{g.offApp ? t('{app} read in the app + {off} finished elsewhere', { app: fmtWords(g.appWords), off: fmtWords(g.offApp) }) : t('{app} read in the app', { app: fmtWords(g.appWords) })}
          </p>
        </>
      ) : (
        <button onClick={() => { setVal('3000000'); setEditing(true); }}>🎯 {t('Set a {year} words goal…', { year })}</button>
      )}
      {editing && (
        <div className="lj-inline">
          <label className="settings-note" style={{ margin: 0 }}>{t('Words in {year}:', { year })}</label>
          <input className="lj-goal-num lj-goal-words" type="number" min="1000" step="100000" value={val} onChange={(e) => setVal(e.target.value)} aria-label={t('Words goal for {year}', { year })} />
          <span className="settings-note" style={{ margin: 0 }}>{Number(val) > 0 ? t.n('≈ {words} · ~{n} novel', '≈ {words} · ~{n} novels', Math.round(Number(val) / 90000), { words: fmtWords(Number(val)) }) : ''}</span>
          <button className="toggle-on" onClick={() => { onSetGoal(key, Math.max(0, Math.round(Number(val) || 0))); setEditing(false); }}>{t('Set goal')}</button>
          {g.target > 0 && <button onClick={() => { onSetGoal(key, 0); setEditing(false); }}>{t('Remove')}</button>}
          <button onClick={() => setEditing(false)}>{t('Cancel')}</button>
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
    const title = String(linkName || t('Untitled')).replace(/\.[a-z0-9]+$/i, '');
    const book = { id: deriveId({ title }), title };
    await saveLibraryBook(book);
    await bind(linkCs, book.id);
    setSelected(book.id); setLinkCs(null); await reload();
  }

  const syncResultMsg = (r) => (r.skipped
    ? `${t('Already in sync — nothing needed to move.')} ✅`
    : r.pulled
      ? (r.pushed ? t('Synced — pulled updates · pushed {books} books ({kb} KB).', { books: r.books, kb: Math.round(r.bytes / 1024) }) : t('Synced — pulled updates · nothing to push.'))
      : (r.pushed ? t('Synced — nothing to pull · pushed {books} books ({kb} KB).', { books: r.books, kb: Math.round(r.bytes / 1024) }) : t('Synced — nothing to pull · nothing to push.')));

  async function syncTracker() {
    setSyncBusy(true); setSyncMsg(t('Syncing tracker…'));
    try {
      const r = await syncLibraryWithProvider(sync.provider, sync);
      onPatch?.({ sync: { ...sync, lastLibrarySync: Date.now() } });
      if (!r.skipped) { reconciled.current = false; await reload(); }
      setSyncMsg(syncResultMsg(r));
    } catch (e) { setSyncMsg(t('Sync failed: {error}', { error: e?.message || e })); }
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
  // Toolbar + column filters → matching books (unsorted). Shared by the table and the saved views.
  const libMatches = (flt, colF) => {
    if (!books) return [];
    const tq = textMatcher(colF.title).test, aq = textMatcher(colF.author).test;
    return filterBooks(books, flt).filter((b) => {
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
  };
  const filtered = useMemo(() => {
    if (!books) return [];
    const base = libMatches(flt, colF);
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
  // Saved views ("smart shelves"): a named snapshot of the toolbar + column filters + sort, kept
  // with the app settings. Pinned ones sit on the dashboard with a live count.
  const views = global?.ljViews || [];
  const saveViews = (v) => onPatch?.({ ljViews: v });
  const [naming, setNaming] = useState(null); // draft name while saving a view
  const applyView = (v) => { setFlt({ ...flt, ...v.flt }); setColF({ ...NO_COLF, ...v.colF }); setSort(v.sort || { key: 'rec', dir: 1 }); setLimit(100); setTab('library'); setSelected(null); };
  const viewCounts = useMemo(() => Object.fromEntries(views.filter((v) => v.pinned).map((v) => [v.id, libMatches({ ...flt, ...v.flt }, { ...NO_COLF, ...v.colF }).length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views, books, csForBook, fileStats]);
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
      if (importMode === 'replace' && !window.confirm(t('Replace the tracker with {n} books from this file? Books you added on this device that aren’t in the file are removed.', { n: env.books.length }))) return;
      const r = await importLibraryData(env, { mode: importMode });
      await reload();
      window.alert(t('Imported {n} books ({added} new, {merged} updated).', { n: env.books.length, added: r.added, merged: r.merged }));
    } catch (err) {
      window.alert(t('Import failed: {error}', { error: err?.message || err }));
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
    if (!window.confirm(t('Remove this book from your tracker?'))) return;
    await deleteLibraryBook(id); setSelected(null); await reload();
  }
  async function wipe() {
    if (!window.confirm(t('Delete the ENTIRE reading tracker from this device? Export first if you want a copy.'))) return;
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
    setCleanMsg(nothing ? `${t('No issues found — the tracker looks consistent.')} ✅` : '');
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
    setCleanMsg(cleanup.undatable.length
      ? t.n('Applied {n} fix · {left} undated finish(es) left as-is.', 'Applied {n} fixes · {left} undated finish(es) left as-is.', n, { left: cleanup.undatable.length })
      : t.n('Applied {n} fix.', 'Applied {n} fixes.', n));
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
    let fileNote = t('no linked file');
    if (csQ.length && !csK.length) fileNote = t('{files} becomes the kept entry’s linked file', { files: csQ.map(nameOfCs).join(', ') });
    else if (csQ.length && csK.length) {
      const g = groupFiles(groups, [...csK, ...csQ], keep.title, csK[0], 0);
      const files = [...csK, ...csQ].map(nameOfCs).join(' + ');
      fileNote = g.made
        ? t('both files stay linked ({files}) and become one book group “{group}” — shared reading position', { files, group: keep.title })
        : t('both files stay linked ({files}) and join book group “{group}” — shared reading position', { files, group: g.group.name });
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
      .map((d) => ({ ...planFor({ quick: live.get(d.foldId), keep: live.get(d.keepId) }, qs, groups), aiWhy: d.why || t('suggested by the cowork agent') }));
    const plans = [...manual, ...found.map((pr) => planFor(pr, qs, groups)), ...fromAi];
    setRecon(plans);
    setReconPick(new Set(plans.filter((pl) => pl.authorHit && !pl.alternatives.length && !pl.aiWhy).map((pl) => pl.id))); // the sure ones ticked; AI suggestions never pre-ticked
    setReconMsg(plans.length ? '' : `${t('No quick-added copies of recommended books found.')} ✅`);
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
    if (!keep || !quick) { setReconMsg(t('Pick both entries from the suggestions (start typing a title).')); return; }
    if (keep.id === quick.id) { setReconMsg(t('Those are the same entry.')); return; }
    const qs = (await getLibraryRef('queues')) || [];
    const pl = planFor({ quick, keep, manual: true }, qs, global?.bookGroups || []);
    setRecon((r) => [pl, ...(r || []).filter((x) => x.id !== quick.id)]);
    setReconPick((s0) => new Set([...s0, quick.id]));
    setManKeep(''); setManFold('');
    setReconMsg(t('Added “{fold}” → “{keep}” to the list below — check its row, then reconcile.', { fold: quick.title, keep: keep.title }));
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
    setReconMsg(t.n('Reconciled {n} pair — each quick entry is folded into its recommendation (snapshot kept on it). ↶ Undo puts everything back.', 'Reconciled {n} pairs — each quick entry is folded into its recommendation (snapshot kept on it). ↶ Undo puts everything back.', plans.length));
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
    setReconMsg(t('Undone — both entries, their file links, queues and book groups are back as they were.'));
    setBindMap(await getBinding());
    await reload();
  }

  // Opt-in destructive pass: the finished books no date could be found for are un-finished (→ To read),
  // for when they were mis-flagged. Kept separate so a real off-app read is never silently cleared.
  async function clearUndatedFinishes() {
    if (!cleanup?.undatable.length) return;
    if (!window.confirm(t('Un-finish {n} book(s) that have no finish date and no reading history to date them from? They move to “To read”. (Export first if unsure.)', { n: cleanup.undatable.length }))) return;
    for (const it of cleanup.undatable) await saveLibraryBook(it.fix);
    setCleanMsg(t('Un-finished {n} undated book(s).', { n: cleanup.undatable.length }));
    setCleanup(null); await reload();
  }

  // ── Miscategorised content ───────────────────────────────────────────────────────────────────
  // Content types come from import guesses, so the Dashboard's long/short/AI splits are only as
  // honest as those guesses. Scan proposes; nothing changes until you tick and apply.
  function scanTypes() {
    const found = scanMiscategorized(books || []);
    setRecat(found);
    setRecatPick(new Set(found.map((s) => s.id))); // everything ticked — it's a review list, not a quiz
    setRecatMsg(found.length ? '' : `${t('Every record’s content type matches its evidence.')} ✅`);
  }
  async function applyRecatPicks() {
    const accepted = (recat || []).filter((s) => recatPick.has(s.id));
    const updated = applyRecat(books || [], accepted);
    for (const b of updated) await saveLibraryBook(b);
    setRecatMsg(t.n('Recategorised {n} record. Types you set are locked, so the scan won’t re-flag them.', 'Recategorised {n} records. Types you set are locked, so the scan won’t re-flag them.', updated.length));
    setRecat(null); setRecatPick(new Set());
    await reload();
  }

  const empty = books && books.length === 0;
  const TABS = [
    { id: 'dashboard', label: t('Dashboard') },
    { id: 'library', label: books ? t('Library ({n})', { n: books.length }) : t('Library') },
    { id: 'queue', label: t('Queues') },
    { id: 'series', label: t('Series') },
    { id: 'groups', label: t('Groups') },
    { id: 'timeline', label: t('Timeline') },
    { id: 'rhistory', label: t('Reading History') },
    { id: 'notes', label: t('Notes') },
    { id: 'analytics', label: t('Analytics') },
    { id: 'authors', label: t('Authors') },
    { id: 'genres', label: t('Genres') },
    { id: 'archetype', label: t('Archetype') },
    { id: 'constellation', label: t('Tech Tree') },
    { id: 'ai', label: t('AI / Cowork') },
    { id: 'data', label: t('Import / Export') },
  ];

  return (
    <Dialog title="Trackyread" onClose={handleClose} width={tab === 'queue' ? 1500 : 880} buttons={<button onClick={handleClose}>{t('Close')}</button>}>
      {!books && <p>{t('Loading…')}</p>}
      {books && (
        <>
          {empty && <p className="settings-note">{t('Your reading tracker is empty — import your library.json under Import / Export (nothing is bundled with the app).')}</p>}
          <div className="rh-tabs">
            {TABS.map((tb) => (
              <button key={tb.id} className={`rh-tab${tab === tb.id ? ' on' : ''}`} onClick={() => { setTab(tb.id); setSelected(null); }}>{tb.label}</button>
            ))}
          </div>

          {tab === 'dashboard' && stats && (
            <div className="lj-dash">
              <TodayCard books={books} goals={goals} dayAgg={dayAgg} fileStats={fileStats} bindMap={bindMap || {}} linkedIds={linkedIds} openChecksums={openChecksums}
                onOpenBook={(id) => { setTab('library'); setSelected(id); }} onOpenFile={async (cs) => { if (await openRecent(cs)) handleClose(); }} onQueues={() => setTab('queue')} />
              {views.some((v) => v.pinned) && (
                <div className="lj-pinned-views">
                  {views.filter((v) => v.pinned).map((v) => (
                    <button key={v.id} className="lj-pinned-view" onClick={() => applyView(v)} title={t('Open the library with this saved view')}>
                      <b>{viewCounts[v.id] ?? '…'}</b><span>📌 {v.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <GoalCard books={books} goals={goals} onSetGoal={setGoalTarget} />
              <WordsGoalCard books={books} goals={goals} dayAgg={dayAgg} linkedIds={linkedIds} onSetGoal={setGoalTarget} />
              <div className="rh-stat-grid">
                <Stat v={stats.total} l={t('books')} />
                <Stat v={stats.finished} l={t('finished')} sub={stats.abandoned ? t('{reading} reading · {abandoned} abandoned', { reading: stats.reading, abandoned: stats.abandoned }) : t('{reading} reading', { reading: stats.reading })} />
                <Stat v={stats.queue} l={t('on deck')} sub={t('{n} to read', { n: fmtNum(stats.toread) })} />
                <Stat v={stats.fiction} l={t('fiction')} sub={t('{n} non-fiction', { n: stats.nonfiction })} />
                <Stat v={stats.words ? fmtNum(stats.words / 1e6, 1, 1) + 'M' : '0'} l={t('words read')} />
                <Stat v={stats.pages ? fmtNum(stats.pages) : '0'} l={t('pages read')} />
              </div>
              <label className="inline-check" title={t('Break the totals out by long-form vs short-form/articles vs AI-generated content')}>
                <input type="checkbox" checked={!!global?.ljSplitTypes} onChange={(e) => onPatch?.({ ljSplitTypes: e.target.checked })} /> {t('Split by content type')}
              </label>
              {global?.ljSplitTypes && <TypeSplit books={books} />}

              <div className="rh-section-h">{t('Difficulty of finished books')}</div>
              <div className="lj-diffbars">
                {[1, 2, 3, 4, 5].map((d) => {
                  const n = stats.byDifficulty[d] || 0;
                  const max = Math.max(1, ...Object.values(stats.byDifficulty));
                  return <div key={d} className="lj-diffbar" title={t('{n} book(s)', { n })}><span className="lj-diffbar-fill" style={{ height: `${(n / max) * 100}%` }} /><em>{d}</em></div>;
                })}
              </div>

              {ai?.analysis && (<><div className="rh-section-h">{t('AI analysis')}{ai.updatedAt ? <span className="lj-analysis-time"> · {fmtDateTime(ai.updatedAt)}</span> : null}</div><p className="lj-analysis">{ai.analysis}</p></>)}
              {ai?.recommendations?.length > 0 && (
                <><div className="rh-section-h">{t('Recommended next')}</div>
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
                        {st === 'queue' ? <span className="settings-note" style={{ margin: 0 }}>· {t('on deck')} 📋</span>
                          : st === 'finished' ? <span className="settings-note" style={{ margin: 0 }}>· {t('finished')} ✅</span>
                          : (
                            <button className="link-btn" title={match ? t('Add this library book to the queue') : t('Create it as a book and add it to the queue')}
                              onClick={async () => {
                                if (match) { await shelve(match, 'queue'); return; }
                                const book = setReadStatus({ id: deriveId({ title: rec.title, author: rec.author }), title: rec.title, author: rec.author || '', recBy: 'Claude', notes: rec.why || '' }, 'queue');
                                await saveLibraryBook(book); await reload();
                              }}>📋 {match ? t('Queue') : t('Queue (new)')}</button>
                          )}
                        {match && st !== 'queue' && <button className="link-btn" onClick={() => { setTab('library'); setSelected(match.id); }}>↗</button>}
                      </li>
                    );
                  })}</ul></>
              )}

              {drifting.length > 0 && (
                <>
                  <div className="rh-section-h">🌫️ {t('Drifting — unfinished reads going cold')}</div>
                  <p className="settings-note">
                    {t('Books you’re partway through but haven’t opened in a while. The risk here isn’t forgetting the gist — it’s losing your place and the thread. Resume before they go cold.')}
                  </p>
                  <ul className="lj-fading">
                    {drifting.slice(0, driftAll ? drifting.length : 6).map((d) => {
                      const cov = Math.round((fileStats[csForBook[d.id]]?.coverage || 0) * 100);
                      return (
                        <li key={d.id} className={`lj-fade-${d.tier === 'cold' ? 'faded' : 'fading'}`}>
                          <span className="lj-fade-bar" title={t('{pct}% read so far', { pct: cov })}>
                            <span className="lj-fade-fill" style={{ width: `${cov}%` }} />
                          </span>
                          <span className="lj-fade-pct">{cov}%</span>
                          <span className="lj-fade-title"><b>{d.title}</b>{d.author ? ` — ${d.author}` : ''}</span>
                          <span className="settings-note lj-fade-meta">
                            {d.tier === 'cold' ? t('gone cold · {days}d untouched', { days: d.daysSince }) : t('drifting · {days}d untouched', { days: d.daysSince })}
                          </span>
                          <button
                            className="link-btn"
                            title={t('Bring it back on deck to resume')}
                            onClick={async () => { const b = books.find((x) => x.id === d.id); if (b) await shelve(b, 'queue'); }}
                          >📋 {t('Resume')}</button>
                        </li>
                      );
                    })}
                  </ul>
                  {drifting.length > 6 && (
                    <button className="link-btn" onClick={() => setDriftAll((v) => !v)}>{driftAll ? t('Show fewer') : t('Show all {n}', { n: drifting.length })}</button>
                  )}
                </>
              )}

              <div className="rh-section-h">🧠 {t('Fading — finished books you may be forgetting')}</div>
              <p className="settings-note">
                {t('Estimated from a forgetting curve: how much you’d likely still have of each finished book, decaying with time since you last read it and firming up with every re-read. Leads with the ones still worth a quick refresh before they slip further.')}
              </p>
              {fading.length === 0 ? (
                <p className="settings-note">{t('Nothing fading — your finished books are either fresh or already re-read.')} ✅</p>
              ) : (
                <ul className="lj-fading">
                  {fading.slice(0, fadingAll ? fading.length : 8).map((f) => (
                    <li key={f.id} className={`lj-fade-${f.tier}`}>
                      <span className="lj-fade-bar" title={t('~{pct}% retained', { pct: Math.round(f.retention * 100) })}>
                        <span className="lj-fade-fill" style={{ width: `${Math.round(f.retention * 100)}%` }} />
                      </span>
                      <span className="lj-fade-pct">{Math.round(f.retention * 100)}%</span>
                      <span className="lj-fade-title"><b>{f.title}</b>{f.author ? ` — ${f.author}` : ''}</span>
                      <span className="settings-note lj-fade-meta">
                        {f.tier === 'faded' ? t('likely gone · {days}d ago', { days: f.daysSince }) : t('fading · {days}d ago', { days: f.daysSince })}{f.reads > 1 ? ` · ${t('read {n}×', { n: f.reads })}` : ''}
                      </span>
                      <button
                        className="link-btn"
                        title={t('Add to the queue for a refresher read')}
                        onClick={async () => { const b = books.find((x) => x.id === f.id); if (b) await shelve(b, 'queue'); }}
                      >📋 {t('Refresh')}</button>
                    </li>
                  ))}
                </ul>
              )}
              {fading.length > 8 && (
                <button className="link-btn" onClick={() => setFadingAll((v) => !v)}>{fadingAll ? t('Show fewer') : t('Show all {n}', { n: fading.length })}</button>
              )}

              <div className="rh-section-h">{t('Recently finished')}</div>
              {stats.recentFinishes.length === 0 && <p className="settings-note">{t('No dated finishes yet.')}</p>}
              <ul className="lj-recent">
                {stats.recentFinishes.map((b) => (
                  <li key={b.id}><b>{b.title}</b> — {b.author} <em>{finishMs(b) ? localDay(finishMs(b)) : ''}</em></li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'library' && (
            <div className="lj-lib">
              {linkCs && (
                <div className="lj-linkbar">
                  <span>🔗 {t('Link {file} to a tracker book:', { file: linkName })}</span>
                  {linkSuggestion && <button className="toggle-on" onClick={() => linkTo(linkSuggestion.id)}>{t('Link “{title}”', { title: linkSuggestion.title })}</button>}
                  <button onClick={linkAsNewBook}>＋ {t('New book from this file')}</button>
                  <span className="settings-note" style={{ margin: 0 }}>{t('…or open any book below and set its “Linked document”.')}</span>
                  <button onClick={() => setLinkCs(null)}>{t('Dismiss')}</button>
                </div>
              )}
              <div className="lj-toolbar">
                <select value={flt.fnf} onChange={(e) => setFlt({ ...flt, fnf: e.target.value })}>
                  <option value="all">{t('Fiction + NF')}</option><option value="F">{t('Fiction')}</option><option value="NF">{t('Non-fiction')}</option>
                </select>
                <select value={flt.recBy} onChange={(e) => setFlt({ ...flt, recBy: e.target.value })} title={t('Recommended by')}>
                  <option value="all">{t('Any recommender')}</option>{recOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={flt.recMin} onChange={(e) => setFlt({ ...flt, recMin: Number(e.target.value) })}>
                  <option value={0}>{t('Any rec')}</option><option value={9}>{t('Rec 9+')}</option><option value={8}>{t('Rec 8+')}</option>
                </select>
                {tagOptions.length > 0 && (
                  <select value={flt.tag} onChange={(e) => setFlt({ ...flt, tag: e.target.value })} title={t('Filter by tag')}>
                    <option value="all">{t('All tags')}</option>{tagOptions.map((tg) => <option key={tg} value={tg}>🏷 {tg}</option>)}
                  </select>
                )}
                <span className="lj-diffpick">{t('Diff:')}{[1, 2, 3, 4, 5].map((d) => (
                  <label key={d}><input type="checkbox" checked={flt.difficulty.includes(d)} onChange={(e) => { const s = new Set(flt.difficulty); e.target.checked ? s.add(d) : s.delete(d); setFlt({ ...flt, difficulty: [...s] }); }} />{d}</label>
                ))}</span>
              </div>
              <div className="lj-toolbar2">
                <span className="settings-note">{t.n('{n} match', '{n} matches', filtered.length)}</span>
                {views.map((v) => (
                  <span key={v.id} className="lj-view-chip">
                    <button className="link-btn" onClick={() => applyView(v)} title={t('Apply this saved view')}>{v.pinned ? '📌 ' : '☆ '}{v.name}</button>
                    <button className="link-btn" title={v.pinned ? t('Unpin from the dashboard') : t('Pin to the dashboard')} onClick={() => saveViews(views.map((x) => (x.id === v.id ? { ...x, pinned: !x.pinned } : x)))}>{v.pinned ? '⊖' : '📌'}</button>
                    <button className="link-btn" title={t('Delete this saved view')} aria-label={t('Delete view {name}', { name: v.name })} onClick={() => saveViews(views.filter((x) => x.id !== v.id))}>✕</button>
                  </span>
                ))}
                {naming == null
                  ? <button onClick={() => setNaming('')} title={t('Save the current filters and sort as a named view you can re-apply (or pin to the dashboard)')}>☆ {t('Save view')}</button>
                  : (
                    <form className="lj-view-name" onSubmit={(e) => { e.preventDefault(); const name = naming.trim(); if (name) saveViews([...views, { id: `v${Date.now().toString(36)}`, name, flt, colF, sort, pinned: true }]); setNaming(null); }}>
                      <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={t('View name')} aria-label={t('Saved view name')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
                      <button type="submit" className="toggle-on" disabled={!naming.trim()}>{t('Save')}</button>
                      <button type="button" onClick={() => setNaming(null)}>{t('Cancel')}</button>
                    </form>
                  )}
                {anySet(colF) && <button onClick={() => { setColF(NO_COLF); setLimit(100); }} title={t("Clear the filters under the table's column headers")}>{t('Clear column filters')}</button>}
                <span className="lj-viewtoggle" role="tablist" aria-label={t('List view')}>
                  <button className={ljView !== 'tiles' ? 'on' : ''} onClick={() => onPatch?.({ ljView: 'table' })} title={t('Table view')}>▤ {t('Table')}</button>
                  <button className={ljView === 'tiles' ? 'on' : ''} onClick={() => onPatch?.({ ljView: 'tiles' })} title={t('Cover tile grid')}>▦ {t('Tiles')}</button>
                </span>
                {ljView !== 'tiles' && (
                  <label className="inline-check" title={t('Show cover thumbnails in the list — loads them from covers.openlibrary.org for visible books with an ISBN or fetched cover')}>
                    <input type="checkbox" checked={showCovers} onChange={(e) => onPatch?.({ ljCovers: e.target.checked })} /> {t('Covers')}
                  </label>
                )}
                <CoverBatchButton books={filtered} legacyOf={(b) => bookCoverUrl(b)} apiKey={global?.anthropicKey} onSaveBook={saveBook} onReload={reload} />
                <span className="lj-spacer" />
                <button onClick={() => setAdding(true)}>+ {t('Add book')}</button>
                <IsbnAdd books={books || []} onFound={(b) => { setSelected(null); setAdding(b); }} onOpenExisting={(id) => setSelected(id)} />
                <button onClick={() => exportView('json')}>{t('Export view (JSON)')}</button>
                <button onClick={() => exportView('md')}>{t('Export view (Markdown)')}</button>
              </div>

              {adding && <BookEditor key={adding === true ? 'blank' : adding.isbn || 'new'} book={adding === true ? { id: '', title: '', author: '', genre: '', fnf: 'F', type: 'long' } : { id: '', ...adding }} isNew apiKey={global?.anthropicKey} onCancel={() => setAdding(false)} onSave={async (b) => { await saveBook({ ...b, id: deriveId(b) }); setAdding(false); }} />}
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
                      {[['status', t('St')], ['title', t('Title')], ['author', t('Author')], ['genre', t('Genre')], ['type', t('Type')], ['file', '📄'], ['started', t('Started')], ['pct', '%'], ['diff', t('D')], ['rec', '★'], ['pages', t('Pages')], ['pub', t('Pub')], ['finished', t('Finished')]].map(([k, l]) => (
                        <th key={k} className={sort.key === k ? 'on' : ''} onClick={() => sortBy(k)} title={t('Click to sort (click again to flip)')}>{l}{sortMark(k)}</th>
                      ))}
                      <th aria-label={t('Shelf actions')} />
                    </tr>
                    {/* Column filters live right under their headers. */}
                    <tr className="lj-filter-row">
                      <th>
                        <select value={colF.status} onChange={(e) => { setColF({ ...colF, status: e.target.value }); setLimit(100); }} title={t('Filter by status')}>
                          <option value="all">{t('all')}</option><option value="finished">✅</option><option value="reading">📖</option><option value="queue">📋</option><option value="toread">🔖</option><option value="abandoned">✕</option>
                        </select>
                      </th>
                      <th><TextF value={colF.title} onChange={(v) => { setColF({ ...colF, title: v }); setLimit(100); }} label={t('title or series')} /></th>
                      <th><TextF value={colF.author} onChange={(v) => { setColF({ ...colF, author: v }); setLimit(100); }} label={t('author')} /></th>
                      <th>
                        <select value={colF.genre} onChange={(e) => { setColF({ ...colF, genre: e.target.value }); setLimit(100); }} title={t('Filter by genre')}>
                          <option value="all">{t('all')}</option>{genreOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </th>
                      <th>
                        <select value={colF.type} onChange={(e) => { setColF({ ...colF, type: e.target.value }); setLimit(100); }} title={t('Filter by content type')}>
                          <option value="all">{t('all')}</option>{Object.entries(CONTENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </th>
                      <th>
                        <select value={colF.file} onChange={(e) => { setColF({ ...colF, file: e.target.value }); setLimit(100); }} title={t('Filter by file link')}>
                          <option value="all">{t('all')}</option><option value="linked">📄</option><option value="unlinked">—</option>
                        </select>
                      </th>
                      {[['started', t('Started'), 'date'], ['pct', t('% read')], ['diff', t('difficulty')], ['rec', t('rec score')], ['pages', t('pages')], ['pub', t('year published')], ['finished', t('Finished'), 'date']].map(([k, label, kind]) => (
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
                            <b>{b.title}</b>{b.locked && <span title={t('Locked — cowork operations never change this book')}> 🔒</span>}
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
                                title={t('Linked file: {file} — open it in the reader', { file: ff?.fileName || cs.slice(0, 8) })}
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
                          <td>{finishMs(b) ? localDay(finishMs(b)) : ''}</td>
                          <td className="lj-row-acts" onClick={(e) => e.stopPropagation()}>
                            <button title={t('On deck (queue)')} className={st === 'queue' ? 'on' : ''} onClick={() => shelve(b, st === 'queue' ? 'toread' : 'queue')}>📋</button>
                            <button title={t('Reading')} className={st === 'reading' ? 'on' : ''} onClick={() => shelve(b, 'reading')}>📖</button>
                            <button title={t('Finished')} className={st === 'finished' ? 'on' : ''} onClick={() => shelve(b, 'finished')}>✅</button>
                            <button title={t('Abandon')} className={st === 'abandoned' ? 'on' : ''} onClick={() => shelve(b, st === 'abandoned' ? 'toread' : 'abandoned')}>✕</button>
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
                  <button className="lj-more" onClick={() => setLimit(limit + 200)}>{t('Load more ({n} left)', { n: filtered.length - limit })}</button>
                  <button className="lj-more" onClick={() => setLimit(filtered.length)}>{t('Load all {n}', { n: filtered.length })}</button>
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
          {tab === 'constellation' && <TreeViews books={books} ai={ai} onOpenInLibrary={(id) => { setTab('library'); setSelected(id); }} />}
          {tab === 'ai' && <AiView books={books} ai={ai} global={global} onPatchGlobal={onPatch} bindMap={bindMap || {}} onReload={reload} onReloadAi={async () => setAi(await getJourneyAi())} />}

          {tab === 'data' && (
            <div className="lj-data">
              <div className="rh-section-h">{t('Import a library')}</div>
              <p className="settings-note">{t('Import your own library.json (or a tracker export). Nothing is shipped with the app.')}</p>
              <div className="lj-inline">
                <label><input type="radio" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> {t('Merge (keep existing, update matches)')}</label>
                <label><input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> {t('Replace')}</label>
              </div>
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
              <button onClick={() => fileRef.current?.click()}>{t('Choose file…')}</button>

              <div className="rh-section-h">{t('Import from Goodreads / StoryGraph')}</div>
              <ShelfImportPanel books={books} onDone={reload} apiKey={global?.anthropicKey || ''} model={global?.anthropicModel || 'claude-sonnet-5'} />

              <div className="rh-section-h">{t('Export everything')}</div>
              <div className="lj-inline">
                <button onClick={() => exportFull('json')}>{t('Full tracker (JSON)')}</button>
                <button onClick={() => exportFull('md')}>{t('Reading history (Markdown)')}</button>
              </div>
              <p className="settings-note">{t('Filtered / partial exports live on the Library tab (“Export view”).')}</p>

              <div className="rh-section-h">{t('Cloud sync (whole tracker)')}</div>
              <p className="settings-note">{t('Syncs the entire tracker as its own file ({target}) — separate from reading-progress sync. Set up / sign in to the target under Settings → Data Management → Cloud sync.', { target: provider?.label || t('no target set') })}</p>
              <div className="lj-inline">
                <button disabled={!providerOk || syncBusy} onClick={syncTracker}>{t('Sync tracker now')}</button>
                {sync.lastLibrarySync ? <span className="settings-note">{t('Last: {when}', { when: fmtDateTime(sync.lastLibrarySync) })}</span> : null}
              </div>
              {syncMsg && <p className="settings-note">{syncMsg}</p>}

              <div className="rh-section-h">{t('Reconcile & clean up')}</div>
              <p className="settings-note">{t('Find finished books missing a date and duplicate records, then fix them in one pass. Nothing changes until you apply.')}</p>
              <div className="lj-inline">
                <button onClick={scanCleanup}>{t('Scan for issues')}</button>
                {cleanMsg && <span className="settings-note">{cleanMsg}</span>}
              </div>
              {cleanup && (
                <div className="lj-cleanup">
                  {cleanup.datable.length > 0 && (
                    <details open><summary>{t('{n} finished, dated from reading history', { n: cleanup.datable.length })}</summary>
                      <ul className="lj-clean-list">{cleanup.datable.map((it) => <li key={it.id}>{it.title} → <em>{it.date}</em></li>)}</ul>
                    </details>
                  )}
                  {cleanup.contradictory.length > 0 && (
                    <details><summary>{t('{n} marked both finished & reading — clear “reading”', { n: cleanup.contradictory.length })}</summary>
                      <ul className="lj-clean-list">{cleanup.contradictory.map((it) => <li key={it.id}>{it.title}</li>)}</ul>
                    </details>
                  )}
                  {cleanup.dups.length > 0 && (
                    <details open><summary>{t('{n} duplicate group(s) — merge into one record', { n: cleanup.dups.length })}</summary>
                      <ul className="lj-clean-list">{cleanup.dups.map((g) => <li key={g.keepId}>{g.titles.join(' + ')} <em>{t('({n} folded in)', { n: g.dropIds.length })}</em></li>)}</ul>
                    </details>
                  )}
                  {cleanup.undatable.length > 0 && (
                    <details><summary>{t('{n} finished with no date and no reading history', { n: cleanup.undatable.length })}</summary>
                      <p className="settings-note">{t('These may be books you read elsewhere (keep them) or mis-flagged. Left untouched by the safe pass.')}</p>
                      <ul className="lj-clean-list">{cleanup.undatable.map((it) => <li key={it.id}>{it.title}{it.author ? ` — ${it.author}` : ''}</li>)}</ul>
                    </details>
                  )}
                  <div className="lj-inline">
                    <button className="toggle-on" disabled={!cleanup.datable.length && !cleanup.contradictory.length && !cleanup.dups.length} onClick={applySafeCleanup}>{t('Apply safe fixes')}</button>
                    {cleanup.undatable.length > 0 && <button className="lj-danger" onClick={clearUndatedFinishes}>{t('Un-finish the {n} undated…', { n: cleanup.undatable.length })}</button>}
                    <button onClick={() => { setCleanup(null); setCleanMsg(''); }}>{t('Dismiss')}</button>
                  </div>
                </div>
              )}

              <div className="rh-section-h">{t('Reconcile quick-added copies')}</div>
              <p className="settings-note">
                {t('Finds books that exist twice: a recommendation with good details (author, ISBN, cover…) and a second entry made by Add to Trackyread when you opened its file — titled from the file name, and usually the one you read and queued. Each pair shows exactly what will happen. The recommendation is kept and takes over the reading state, the file link and the queue place; the quick entry is retired but kept as a snapshot on it, and ↶ Undo restores everything.')}
              </p>
              <div className="lj-inline">
                <button onClick={scanRecon}>{t('Scan for quick-added copies')}</button>
                {(ai?.dupeSuggestions || []).length > 0 && <span className="settings-note" style={{ margin: 0 }}>🤖 {t.n('{n} pair suggested by the cowork agent — included in the scan', '{n} pairs suggested by the cowork agent — included in the scan', ai.dupeSuggestions.length)}</span>}
                {reconUndo && <button onClick={undoRecon}>↶ {t('Undo last reconcile')}</button>}
                {reconMsg && <span className="settings-note">{reconMsg}</span>}
              </div>
              <form className="lj-inline lj-recon-man" onSubmit={(e) => { e.preventDefault(); addManualPair(); }}>
                <span className="settings-note" style={{ margin: 0 }}>{t('Pair two yourself — keep')}</span>
                <input list="lj-recon-books" value={manKeep} onChange={(e) => setManKeep(e.target.value)} placeholder={t('entry to keep (good details)…')} aria-label={t('Entry to keep')} />
                <span className="settings-note" style={{ margin: 0 }}>← {t('fold in')}</span>
                <input list="lj-recon-books" value={manFold} onChange={(e) => setManFold(e.target.value)} placeholder={t('entry to retire…')} aria-label={t('Entry to fold in and retire')} />
                <button type="button" title={t('Swap which entry is kept')} onClick={() => { setManKeep(manFold); setManFold(manKeep); }}>⇄</button>
                <button type="submit" disabled={!manKeep || !manFold}>＋ {t('Add pair')}</button>
                <datalist id="lj-recon-books">
                  {books.filter((b) => !b.deleted).map((b) => <option key={b.id} value={`${b.title}${b.author ? ` — ${b.author}` : ''} [${b.id}]`} />)}
                </datalist>
              </form>
              {recon && recon.length > 0 && (
                <div className="lj-cleanup lj-recon">
                  <div className="lj-q-box lj-recon-box">
                    <table className="lj-cand lj-recon-table">
                      <colgroup><col className="c-tick" /><col className="c-keep" /><col className="c-fold" /><col className="c-file" /><col className="c-queue" /><col className="c-chg" /><col className="c-more" /></colgroup>
                      <thead><tr><th aria-label={t('Reconcile')} /><th>{t('Keep')}</th><th>{t('Fold in & retire')}</th><th>{t('File link')}</th><th>{t('Queue')}</th><th>{t('Changes')}</th><th aria-label={t('Details')} /></tr></thead>
                      <tbody>
                        {recon.map((pl) => {
                          const warn = [!pl.authorHit && t('matched on the title alone — the file name doesn’t mention the author'), pl.alternatives.length && t('also matches {titles}', { titles: pl.alternatives.map((b) => b.title).join('; ') })].filter(Boolean);
                          const open = reconOpen === pl.id;
                          return (
                            <Fragment key={pl.id}>
                              <tr className={warn.length ? 'warn' : ''}>
                                <td><input type="checkbox" checked={reconPick.has(pl.id)} aria-label={t('Reconcile “{fold}” into “{keep}”', { fold: pl.quick.title, keep: pl.keep.title })}
                                  onChange={() => setReconPick((s0) => { const s1 = new Set(s0); if (s1.has(pl.id)) s1.delete(pl.id); else s1.add(pl.id); return s1; })} /></td>
                                <td title={`${pl.keep.title} — ${pl.keep.author || ''}${pl.keep.isbn ? ` · ISBN ${pl.keep.isbn}` : ''}`}><b>{pl.keep.title}</b>{pl.keep.author ? <span className="lj-qdim"> — {pl.keep.author}</span> : ''}</td>
                                <td title={pl.quick.title}>{warn.length ? <span title={warn.join(' · ')}>⚠ </span> : ''}{pl.manual ? <span title={t('Paired by you')}>✋ </span> : ''}{pl.aiWhy ? <span title={t('Suggested by the cowork agent: {why}', { why: pl.aiWhy })}>🤖 </span> : ''}{pl.quick.title} <span className="lj-qdim">({STATUS_LABEL[readStatus(pl.quick)].replace(/^\S+\s/, '')})</span></td>
                                <td title={pl.fileNote}>{pl.csQ.length ? (pl.csK.length ? `🔗 ${t('both linked + grouped')}` : `📎 ${pl.csQ.map(nameOfCs).join(', ')}`) : '—'}</td>
                                <td title={pl.queueNote}>{pl.queueNote}</td>
                                <td title={pl.diff.map((d) => `${d.key}: ${fmtVal(d.from)} → ${fmtVal(d.to)}`).join('\n')}>{pl.diff.length ? t.n('{n} field: {keys}', '{n} fields: {keys}', pl.diff.length, { keys: pl.diff.map((d) => d.key).join(', ') }) : t('none')}</td>
                                <td><button className="lj-recon-more" onClick={() => setReconOpen(open ? null : pl.id)} aria-expanded={open} title={t('Details')}>{open ? '▾' : '▸'}</button></td>
                              </tr>
                              {open && (
                                <tr className="lj-recon-detail"><td /><td colSpan={6}>
                                  <ul className="lj-clean-list">
                                    <li>📎 {pl.fileNote}</li>
                                    <li>📋 {t('Queue: {note}', { note: pl.queueNote })}</li>
                                    <li>✏️ {pl.diff.length ? pl.diff.map((d) => <span key={d.key} className="lj-recon-diff"><code>{d.key}</code> {fmtVal(d.from)} → <b>{fmtVal(d.to)}</b></span>) : t('no field changes on the kept entry')}</li>
                                    <li>🗃 {t('“{title}” is retired (kept as a tombstone + a snapshot in the kept entry’s history)', { title: pl.quick.title })}</li>
                                    {warn.map((w) => <li key={w} className="lj-recon-warn">⚠ {t('{warning}. Check it’s the same book.', { warning: w })}</li>)}
                                    {pl.aiWhy && <li>🤖 {t('Suggested by the cowork agent: {why}', { why: pl.aiWhy })}</li>}
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
                    <button className="toggle-on" disabled={!reconPick.size} onClick={applyRecon}>{t('Reconcile {n} ticked', { n: reconPick.size })}</button>
                    <button onClick={() => setReconPick(new Set(recon.map((pl) => pl.id)))}>{t('Tick all')}</button>
                    <button onClick={() => setReconPick(new Set())}>{t('Untick all')}</button>
                    <button onClick={() => { setRecon(null); setReconMsg(''); }}>{t('Dismiss')}</button>
                    <span className="settings-note" style={{ margin: 0 }}>{t('⚠ = less certain (left unticked) · ✋ = paired by you · 🤖 = suggested by the cowork agent (left unticked) · hover a cell or ▸ for the full details')}</span>
                  </div>
                </div>
              )}

              <div className="rh-section-h">{t('Fix miscategorised content')}</div>
              <p className="settings-note">
                {t('Content types mostly come from how a record was imported, so the Dashboard’s long / short / AI-generated splits inherit those guesses. This looks for records whose evidence — length, author, title, genre — disagrees with their label. Every row says why, nothing changes until you apply, and a type you set by hand is never re-flagged.')}
              </p>
              <div className="lj-inline">
                <button onClick={scanTypes}>{t('Scan content types')}</button>
                {recatMsg && <span className="settings-note">{recatMsg}</span>}
              </div>
              {recat && recat.length > 0 && (
                <div className="lj-cleanup">
                  <p className="settings-note">
                    {t.n('{n} record looks mislabelled:', '{n} records look mislabelled:', recat.length)}{' '}
                    {Object.entries(recatSummary(recat)).map(([ty, n]) => `${n} → ${CONTENT_TYPES[ty] || ty}`).join(' · ')}
                  </p>
                  <div className="lj-inline">
                    <button onClick={() => setRecatPick(new Set(recat.map((x) => x.id)))}>{t('Select all')}</button>
                    <button onClick={() => setRecatPick(new Set())}>{t('Select none')}</button>
                  </div>
                  <table className="lj-recat">
                    <thead><tr><th /><th>{t('Title')}</th><th>{t('Now')}</th><th>{t('Suggested')}</th><th>{t('Why')}</th></tr></thead>
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
                      {t.n('Apply {n} change', 'Apply {n} changes', recatPick.size)}
                    </button>
                    <button onClick={() => { setRecat(null); setRecatMsg(''); }}>{t('Dismiss')}</button>
                  </div>
                </div>
              )}

              <div className="rh-section-h">{t('Storage')}</div>
              <p className="settings-note">{size ? t('{n} books · ~{mb} MB on this device.', { n: fmtNum(size.books), mb: fmtNum(size.bytes / 1024 / 1024, 2, 2) }) : ''} {t('The tracker is excluded from the local full backup — it moves via these exports and (once set up) its own cloud file.')}</p>
              <button className="lj-danger" onClick={wipe}>{t('Delete tracker from this device…')}</button>
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
      <div className="field-section" style={{ marginTop: 8 }}>{t('AI notes ({n})', { n: notes.length })}</div>
      {Object.entries(byType).map(([type, list]) => (
        <div key={type} className="lj-ainote-group">
          <div className="lj-ainote-type">{AI_NOTE_TYPES[type] || t('Note')}</div>
          {list.map((n, i) => {
            const key = `${type}:${i}`;
            const spoilery = (type === 'summary' || type === 'section-summary') && !finished;
            const hidden = spoilery && !revealed.has(key);
            return (
              <div key={key} className={`lj-ainote${hidden ? ' lj-spoiler' : ''}`}
                title={hidden ? t('Spoiler-protected — this summarizes something you haven’t finished reading. Click to reveal.') : undefined}
                onClick={hidden ? () => setRevealed((r) => new Set(r).add(key)) : undefined}>
                {n.sectionTitle && <span className="lj-ainote-sec">§ {n.sectionTitle}</span>}
                {hidden ? <span className="lj-spoiler-label">🙈 {type === 'section-summary' ? t('Spoiler — unfinished section. Click to reveal.') : t('Spoiler — unfinished book. Click to reveal.')}</span> : null}
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
      <div className="field-section" style={{ marginTop: 8 }}>{relevant.length ? t('Shared notes — multi-book / series ({n})', { n: relevant.length }) : t('Shared notes — multi-book / series')}</div>
      {relevant.map((n) => {
        const spoilery = (n.type === 'summary' || n.type === 'section-summary') && !allSpanFinished(n);
        const hidden = spoilery && !revealed.has(n.id);
        return (
          <div key={n.id} className={`lj-ainote lj-xnote${hidden ? ' lj-spoiler' : ''}`}
            onClick={hidden ? () => setRevealed((r) => new Set(r).add(n.id)) : undefined}>
            <span className="lj-xnote-span">
              {(n.bookIds || []).map((id) => <i key={id} className="lj-xnote-chip">{titleOf(id)}</i>)}
              {n.series && <i className="lj-xnote-chip lj-xnote-series">📚 {n.series}</i>}
              <em className="lj-xnote-type">{AI_NOTE_TYPES[n.type] || t('Note')}{n.source === 'ai' ? ` · ${t('AI')}` : ''}</em>
              <button className="close-x" title={t('Delete this shared note')} onClick={(e) => { e.stopPropagation(); onDeleteCross?.(n.id); }}>×</button>
            </span>
            {hidden ? <span className="lj-spoiler-label">🙈 {t('Spoiler — spans unfinished book(s). Click to reveal.')}</span> : null}
            <div className="lj-ainote-text">{n.text}</div>
          </div>
        );
      })}
      {!adding ? (
        <button onClick={() => setAdding(true)}>＋ {t('Shared note…')}</button>
      ) : (
        <div className="lj-xnote-editor">
          <div className="lj-inline">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(AI_NOTE_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {book.series && (
              <label className="inline-check"><input type="checkbox" checked={asSeries} onChange={(e) => setAsSeries(e.target.checked)} /> {t('Attach to series “{series}”', { series: book.series })}</label>
            )}
          </div>
          <div className="lj-xnote-span" style={{ margin: '4px 0' }}>
            {span.map((id) => (
              <i key={id} className="lj-xnote-chip">{titleOf(id)}{span.length > 1 && <button className="close-x" onClick={() => setSpan((sp) => sp.filter((x) => x !== id))}>×</button>}</i>
            ))}
            <input placeholder={t('＋ add another book…')} value={q} onChange={(e) => setQ(e.target.value)} />
            {matches.map((x) => <button key={x.id} className="link-btn" onClick={() => { setSpan((sp) => [...sp, x.id]); setQ(''); }}>{x.title}</button>)}
          </div>
          <textarea rows={3} placeholder={t('A note about these books together…')} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="lj-inline">
            <button className="toggle-on" disabled={!text.trim()} onClick={save}>{t('Save shared note')}</button>
            <button onClick={() => setAdding(false)}>{t('Cancel')}</button>
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('Could not read that image.'))); };
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
    if (!/^https?:\/\//i.test(u) && !u.startsWith('data:')) { setMsg(t('Enter an http(s) or data: image URL.')); return; }
    push({ src: u, source: 'link' }); setUrl(''); setMsg('');
  }
  function addProcedural() {
    push({ src: proceduralCover({ title: b.title, author: b.author, genre: b.genre }), source: 'proc' });
    setMsg('');
  }
  async function addAi() {
    if (!apiKey) { setMsg(t('Add your Anthropic API key in Settings to have Claude design a cover.')); return; }
    setBusy('ai'); setMsg(t('Claude is designing a cover…'));
    try {
      const reply = await askClaude([{ role: 'user', content: coverPromptFor(b) }], { key: apiKey, model: model || 'claude-sonnet-5', maxTokens: 320, source: 'cover-design' });
      const spec = parseCoverSpec(reply);
      if (!spec) { setMsg(t('Could not read a cover design from the reply — try again, or use Auto.')); }
      else { push({ src: coverSpecToSvg(spec, { title: b.title, author: b.author }), source: 'ai', spec }); setMsg(t('AI cover added.')); }
    } catch (err) { setMsg(t('AI cover failed: {error}', { error: err?.message || err })); }
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
        {list.length === 0 && <span className="lj-cover lj-cover-none" title={t('No cover yet')}>📕</span>}
        {list.map((c) => {
          const isMaster = c.src === master;
          return (
            <div key={c.id} className={`lj-cover-cell${isMaster ? ' master' : ''}`}>
              <img className="lj-cover" src={c.src} alt="" loading="lazy" onError={(ev) => { ev.target.style.opacity = 0.2; }} />
              <button type="button" className={`lj-cover-star${isMaster ? ' on' : ''}`} title={isMaster ? t('Master cover (shown on tiles)') : t('Make this the master cover')} onClick={() => makeMaster(c.id)}>{isMaster ? '★' : '☆'}</button>
              <button type="button" className="lj-cover-del" title={t('Remove this cover')} onClick={() => remove(c.id)}>×</button>
              <span className="lj-cover-src">{c.legacy ? 'link' : c.source}</span>
            </div>
          );
        })}
      </div>
      <div className="lj-cover-actions">
        <label className="lj-cover-btn" title={t('Upload one or more images (downscaled locally)')}>⬆ {t('Upload')}<input type="file" accept="image/*" multiple hidden onChange={onUpload} /></label>
        <button type="button" className="lj-cover-btn" disabled={busy === 'ai'} onClick={addAi} title={t('Have Claude design a cover (needs your API key)')}>✨ {t('AI cover')}</button>
        <button type="button" className="lj-cover-btn" onClick={addProcedural} title={t("Generate a stylised cover from the book's own details — no API needed")}>🎨 {t('Auto')}</button>
      </div>
      <div className="lj-cover-url">
        <input placeholder={t('Image URL…')} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUrl())} />
        <button type="button" onClick={addUrl} disabled={!url.trim()}>＋ {t('Add URL')}</button>
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
  if (coverless.length === 0) return <span className="settings-note" title={t('Every book in view already has a cover')}>🖼 {t('all covered')}</span>;

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
    if (!apiKey) { setProg(t('needs API key')); return; }
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
      <button disabled={busy} onClick={auto} title={t('Generate a stylised cover for {n} book(s) in view without one — no API', { n: coverless.length })}>🎨 {t('Auto-cover {n}', { n: coverless.length })}</button>
      <button disabled={busy} onClick={ai} title={apiKey ? t('Have Claude design covers for the coverless books in view (up to 20)') : t('Add an Anthropic API key in Settings to use this')}>✨ {t('AI-cover')}</button>
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
      if (!doc) setOlMsg(t('No confident match on Open Library.'));
      else {
        const got = Object.keys(patch);
        set(patch);
        setOlMsg(got.length ? t('Filled: {fields} — review, then Save.', { fields: got.join(', ') }) : t('Matched, but every field is already filled.'));
      }
    } catch (e) { setOlMsg(t('Lookup failed: {error}', { error: e?.message || e })); }
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
      if (got.length) setOlMsg(t('From the document: {fields} — review, then Save.', { fields: got.join(', ') }));
      else if (!payload?.fullText && !words) setOlMsg(t('The linked file’s text isn’t stored on this device — open it once, then retry.'));
      else setOlMsg(t('Nothing new found in the document’s front matter.'));
    } catch (e) { setOlMsg(t('Text scan failed: {error}', { error: e?.message || e })); }
    setTxtBusy(false);
  }
  const linkedGroup = currentLink ? groupForChecksum(groups, currentLink) : null;
  const suggested = !isNew && !currentLink ? suggestDoc(b, docMeta) : null;
  // Reading facts from the linked document, for the "auto" fills below.
  const docStats = currentLink ? fileStats[currentLink] : null;
  const finishISO = finishMs(b) ? localDay(finishMs(b)) : null;
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
          <button type="button" disabled={olBusy || (!b.title && !b.isbn)} title={t('Fetch a cover + blank details from Open Library')} onClick={fetchOl}>🔎 Open Library</button>
          {olMsg && <span className="settings-note">{olMsg}</span>}
        </div>
      </div>
      <div className="lj-editor-grid">
        <label className={dcls('title')}>{t('Title')}<input value={b.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className={dcls('author')}>{t('Author')}<input value={b.author || ''} onChange={(e) => set({ author: e.target.value })} /></label>
        <label className={dcls('genre')}>{t('Genre')}<input value={b.genre || ''} onChange={(e) => set({ genre: e.target.value })} /></label>
        <label className={dcls('subgenre')}>{t('Subgenre')}<input value={b.subgenre || ''} onChange={(e) => set({ subgenre: e.target.value })} /></label>
        <label className={dcls('fnf')}>{t('Fiction?')}<select value={b.fnf || ''} onChange={(e) => set({ fnf: e.target.value })}><option value="F">{t('Fiction')}</option><option value="NF">{t('Non-fiction')}</option></select></label>
        <label className={dcls('type')}>{t('Content type')}<select value={contentType(b)} onChange={(e) => set({ type: e.target.value })}>{Object.entries(CONTENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={dcls('completion', 'inProgress', 'shelf')}>{t('Status')}<select value={status} onChange={(e) => setB(applyStatus(b, e.target.value))}><option value="toread">{t('To read')}</option><option value="queue">{t('On deck')}</option><option value="reading">{t('Reading')}</option><option value="finished">{t('Finished')}</option><option value="abandoned">{t('Abandoned')}</option></select></label>
        <label className={dcls('finishTime')}>{t('Finished')}<input type="date" value={(finishMs(b) ? localDay(finishMs(b)) : '')} onChange={(e) => set({ finishTime: e.target.value })} /></label>
        <label className={dcls('recBy')}>{t('Rec. by')}<input value={b.recBy || ''} placeholder="Claude" onChange={(e) => set({ recBy: e.target.value })} /></label>
        <label className={dcls('rating')}>{t('Rating')}<input type="number" min="0" max="5" value={bookRating(b) || ''} onChange={(e) => set({ rating: Number(e.target.value) })} /></label>
        <label className={dcls('locked')} title={t('A locked book is never changed by any cowork operation (fills, rescoring, notes, duplicates) — those changes are discarded before review')}>
          🔒 {t('Lock from AI')}<input type="checkbox" checked={!!b.locked} onChange={(e) => set({ locked: e.target.checked || undefined })} />
        </label>
        {b.aiSet && Object.keys(b.aiSet).length > 0 && (
          <span className="settings-note lj-aiset" title={t('Fields a cowork operation filled or changed — edit any of them to make it yours (the marker stays as history)')}>
            🤖 {t('Set by cowork:')} {Object.entries(b.aiSet).map(([f, v]) => `${f} (${String(new Date(v.at).toISOString()).slice(0, 10)}${v.by ? ` · ${v.by}` : ''})`).join(', ')}
          </span>
        )}
        <label className={dcls('difficultyLevel')}>{t('Difficulty')}<input type="number" min="1" max="5" value={b.difficultyLevel || ''} onChange={(e) => set({ difficultyLevel: Number(e.target.value) })} /></label>
        <label className={dcls('recScore')}>{t('Rec score')}<input type="number" min="0" max="10" value={b.recScore || ''} onChange={(e) => set({ recScore: Number(e.target.value) })} /></label>
        <label className={dcls('pages')}>{t('Pages')}<input type="number" value={b.pages || ''} onChange={(e) => set({ pages: Number(e.target.value) })} /></label>
        <label className={dcls('words')}>{t('Words')}<input type="number" value={b.words || ''} placeholder={b.pages ? `~${bookWordCount({ pages: b.pages })}` : ''} onChange={(e) => set({ words: Number(e.target.value) })} /></label>
        <label className={dcls('pubDate')}>{t('Published')}<input value={b.pubDate || ''} onChange={(e) => set({ pubDate: e.target.value })} /></label>
        <label className={dcls('isbn')}>ISBN<input value={b.isbn || ''} onChange={(e) => set({ isbn: e.target.value })} /></label>
        <label className={dcls('tags')}>{t('Tags')}<input value={Array.isArray(b.tags) ? b.tags.join(', ') : (b.tags || '')} placeholder={t('comma, separated')} onChange={(e) => set({ tags: e.target.value })} /></label>
      </div>
      <div className="lj-inline">
        <button type="button" disabled={olBusy || (!b.title && !b.isbn)} onClick={fetchOl}
          title={t('Search Open Library by ISBN (or title + author) and fill the blank fields — sends that query to openlibrary.org')}>
          {olBusy ? t('Searching…') : `🔎 ${t('Fetch details (Open Library)')}`}
        </button>
        {currentLink && (
          <button type="button" disabled={txtBusy} onClick={pullFromText}
            title={t('Fill blank fields from the linked document itself: exact word count (and a pages estimate), plus author / publish year / ISBN scraped from its front matter. Nothing leaves the device.')}>
            {txtBusy ? t('Scanning…') : `📄 ${t('Fill from linked document')}`}
          </button>
        )}
        {status === 'finished' && (
          <button type="button" title={t('Finished it again? The current finish date moves into history and today becomes the finish')} onClick={() => setB(logReread(b, todayISO()))}>↻ {t('Log re-read')}</button>
        )}
        {finishCount(b) > 1 && <span className="settings-note" style={{ margin: 0 }}>{t('Read ×{n} · previously {dates}', { n: finishCount(b), dates: b.finishHistory.join(', ') })}</span>}
        {olMsg && <span className="settings-note" style={{ margin: 0 }}>{olMsg}</span>}
      </div>
      <div className="lj-readtime">
        <div className="field-section" style={{ marginTop: 0 }}>{t('Reading time')}</div>
        <div className="lj-editor-grid">
          <label className={dcls('startTime')}>{t('Started')}
            <span className="lj-inline">
              <input type="date" value={b.startTime || ''} onChange={(e) => set({ startTime: e.target.value })} />
              {docStats?.firstRead && b.startTime !== docStats.firstRead && <button type="button" className="link-btn" title={t('Use the first date you read the linked document')} onClick={() => set({ startTime: docStats.firstRead })}>{t('auto')}</button>}
            </span>
          </label>
          <label className={dcls('readSecs')}>{t('Time reading (min)')}
            <span className="lj-inline">
              <input type="number" min="0" value={b.readSecs ? Math.round(b.readSecs / 60) : ''} onChange={(e) => set({ readSecs: Math.max(0, Number(e.target.value) || 0) * 60 })} />
              {docStats?.activeSecs > 0 && b.readSecs !== docStats.activeSecs && <button type="button" className="link-btn" title={t('Use the active reading time recorded for the linked document')} onClick={() => set({ readSecs: docStats.activeSecs })}>{t('auto')}</button>}
            </span>
          </label>
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={!!b.audiobookFinish} onChange={(e) => set({ audiobookFinish: e.target.checked, audiobookEyePct: e.target.checked ? (b.audiobookEyePct ?? Math.round((docStats?.coverage || 0) * 100)) : b.audiobookEyePct })} />
          {t('Finished the rest by audiobook')}
        </label>
        {b.audiobookFinish && (
          <label className="lj-ab-pct">{t('Read by eye first (%)')}
            <input type="number" min="0" max="100" value={b.audiobookEyePct ?? ''} onChange={(e) => set({ audiobookEyePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
            <span className="settings-note" style={{ margin: 0 }}>
              {bookWordCount(b) ? t('~{audio} of audiobook at 1× · estimated total ~{total}', { audio: fmtDur(abSecs), total: fmtDur(totalSecs) }) : t('Add a word or page count to estimate the audiobook time.')}
            </span>
          </label>
        )}
        <p className="settings-note" style={{ margin: '2px 0 0' }}>{readingTimeSummary(b, finishISO)}</p>
      </div>

      <label className={`lj-editor-notes ${dcls('notes') || ''}`}>{t('Notes')}<textarea rows={3} value={b.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
      <AiNotesBlock book={b} />
      {!isNew && <CrossNotesBlock book={b} books={books} crossNotes={crossNotes} onSaveCross={onSaveCross} onDeleteCross={onDeleteCross} />}
      {!isNew && onBind && (
        <div className="lj-bind">
          <label>{t('Linked document')}
            <select value={currentLink || ''} onChange={(e) => onBind(e.target.value, b.id)}>
              <option value="">{t('— none —')}</option>
              {docMeta.map((d) => <option key={d.checksum} value={d.checksum}>{d.fileName}</option>)}
            </select>
          </label>
          {suggested && <button className="link-btn" onClick={() => onBind(suggested.checksum, b.id)}>{t('Link “{file}”?', { file: suggested.fileName })}</button>}
          {currentLink && onProgress && <button className="link-btn" title={t("Reading progress detail for the linked document — works even when the file isn't on this device (uses the synced reading state)")} onClick={() => onProgress(currentLink)}>📈 {t('Progress')}</button>}
          {linkedGroup && <span className="settings-note">📚 {t('Also in book group {group} (Settings → Book Groups).', { group: linkedGroup.name })}</span>}
          <span className="settings-note">{t('Linking auto-marks this book finished when you complete that document.')}</span>
        </div>
      )}
      <div className="lj-editor-buttons">
        <button
          className="primary"
          disabled={!b.title || (!isNew && dirtyKeys.size === 0)}
          title={!isNew && dirtyKeys.size === 0 ? t('No changes yet — edit a field first') : undefined}
          onClick={() => onSave({ ...b, tags: bookTags(b) })}
        >
          {isNew ? t('Add') : dirtyKeys.size ? t.n('Save {n} change', 'Save {n} changes', dirtyKeys.size) : t('Save')}
        </button>
        <button onClick={onCancel}>{t('Cancel')}</button>
        {!isNew && onDelete && <button className="lj-danger" onClick={onDelete}>{t('Delete')}</button>}
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
      .filter((it) => { const mt = textMatcher(q).test; return !mt || mt(it[nameKey] || ''); })
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
      <p className="settings-note">{kind === 'author' ? t.n('{n} author', '{n} authors', rows.length) : t.n('{n} genre', '{n} genres', rows.length)}{!items && ` ${t('(derived from your books)')}`}{rows.length > 300 ? ` · ${t('showing the first 300 — filter to narrow')}` : ''} · {t('click a name for its reference details')}
        {(q || anySet(rf)) && <> · <button className="link-btn" onClick={() => { setQ(''); setRf({ books: ['', ''], finished: ['', ''], pct: ['', ''] }); }}>{t('clear filters')}</button></>}</p>
      <div className="lj-tablewrap">
        <table className="lj-table lj-ref-table">
          <thead>
            <tr>
              {[['name', kind === 'author' ? t('Author') : t('Genre')], ['books', t('Books')], ['finished', t('Finished')], ['pct', t('Completion')]].map(([k, l]) => (
                <th key={k} className={rsort.key === k ? 'on' : ''} onClick={() => rsortBy(k)} title={t('Click to sort (click again to flip)')}>{l}{rsortMark(k)}</th>
              ))}
              <th>{t('Links')}</th>
              <th aria-label={t('Show in library')} />
            </tr>
            <tr className="lj-filter-row">
              <th><TextF value={q} onChange={setQ} label={kind === 'author' ? t('author name') : t('genre name')} /></th>
              <th><RangeF value={rf.books} onChange={(v) => setRf({ ...rf, books: v })} label={t('books')} /></th>
              <th><RangeF value={rf.finished} onChange={(v) => setRf({ ...rf, finished: v })} label={t('finished')} /></th>
              <th><RangeF value={rf.pct} onChange={(v) => setRf({ ...rf, pct: v })} label={t('completion %')} /></th>
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
                    <div className="rh-td-prog" title={t('{done} of {total} finished', { done: fin, total })}>
                      <span>{total ? Math.round(pct) : 0}%</span>
                      <span className="lj-series-bar lj-ref-bar"><i style={{ width: `${pct}%` }} /></span>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <a className="link-btn" href={grUrl(name)} target="_blank" rel="noreferrer noopener" title={t('Search Goodreads for {name}', { name })}>GR</a>
                    {' '}
                    <a className="link-btn" href={wikiUrl(name)} target="_blank" rel="noreferrer noopener" title={t('Search Wikipedia for {name}', { name })}>W</a>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="link-btn" title={t('Show {name} in the Library', { name })} onClick={() => onOpen?.(name)}>↗</button>
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
                          <div className="lj-subgenres">{t('Subgenres:')} {subitems.filter((s) => s.genre === name).map((s) => s.subgenre).join(', ') || '—'}</div>
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
const AXIS_SHORT = { fiction: t('Fic'), nonfiction: t('NF'), literary: t('Lit'), genreFiction: t('Genre'), ideas: t('Ideas'), contemporary: t('New'), challenge: t('Hard'), volume: t('Vol'), speculative: t('SFF'), factual: t('Fact'), poetic: t('Poet'), series: t('Ser') };
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
  const winLabel = windowDays >= 365 ? t('{n} yr', { n: fmtNum(windowDays / 365, windowDays % 365 ? 1 : 0, windowDays % 365 ? 1 : 0) }) : t('{n} mo', { n: Math.round(windowDays / 30) });

  if (finished.length < 3) return <p className="settings-note">{t('Mark at least 3 books finished to reveal your Reader Archetype.')}</p>;
  return (
    <div className="lj-arch">
      <div className="lj-arch-top">
        <div className="lj-arch-head">
          <div className="rh-section-h">{t('All-time')}</div>
          {allTime.archetype ? <><b className="lj-arch-name" style={{ color: ARCHETYPE_COLOR[allTime.archetype.id] }}>{allTime.archetype.name}</b><p className="settings-note">{allTime.archetype.blurb}{allTime.secondary ? ` · ${t('leaning {name}', { name: allTime.secondary.name })}` : ''}</p></> : <p className="settings-note">{t('Not enough data.')}</p>}
          <div className="rh-section-h">{t('Now (last {window})', { window: winLabel })}</div>
          {cur.archetype ? <b className="lj-arch-name" style={{ color: ARCHETYPE_COLOR[cur.archetype.id] }}>{cur.archetype.name}</b> : <p className="settings-note">{t('Fewer than 3 dated finishes in this window.')}</p>}
          <p className="settings-note">{t('{n} book(s) in window', { n: winBooks.length })}</p>
        </div>
        <Radar vector={winProfile.count ? winProfile.vector : allTime.vector} />
      </div>

      <div className="rh-section-h">{t('How it changed (trailing {window} window)', { window: winLabel })}</div>
      <label className="lj-winslider">{t('Window: {window}', { window: winLabel })}
        <input type="range" min={30} max={1825} step={30} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} />
      </label>
      {trend.length === 0 ? <p className="settings-note">{t('Add finish dates to your books to reconstruct the timeline.')}</p> : (
        <>
          <div className="lj-trend">
            {trend.map((p, i) => <span key={i} className="lj-trend-cell" title={t.n('{date}: {name} ({n} book)', '{date}: {name} ({n} books)', p.count, { date: p.date, name: p.archetypeName || t('insufficient data') })} style={{ background: p.archetypeId ? ARCHETYPE_COLOR[p.archetypeId] : 'var(--divider)' }} />)}
          </div>
          <div className="lj-trend-axis"><span>{trend[0].date}</span><span>{trend[trend.length - 1].date}</span></div>
          <div className="lj-legend">{present.map((id) => { const a = READER_ARCHETYPES.find((x) => x.id === id); return <span key={id} className="lj-legend-item"><i style={{ background: ARCHETYPE_COLOR[id] }} />{a?.name}</span>; })}</div>
          {dated.length < finished.length && <p className="settings-note">{t('{n} finished book(s) have no date and don’t appear in the timeline.', { n: finished.length - dated.length })}</p>}
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
        {open ? '▾' : '▸'} {t('What the archetypes mean ({n})', { n: READER_ARCHETYPES.length })}
      </button>
      {open && (
        <div className="lj-arch-legend-list">
          {READER_ARCHETYPES.map((a) => (
            <div key={a.id} className={`lj-arch-legend-row${a.id === currentId ? ' current' : ''}`}>
              <span className="lj-arch-legend-dot" style={{ background: ARCHETYPE_COLOR[a.id] }} />
              <div className="lj-arch-legend-body">
                <b style={{ color: ARCHETYPE_COLOR[a.id] }}>{a.name}{a.id === currentId ? ` — ${t('you')}` : ''}</b>
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

// ── Queues view ──────────────────────────────────────────────────────────────────────────────────
// Hand-picked, hand-ordered reading queues. Desktop: the selected queue on the left, the add-books
// table on the right, each in a fixed-height scroll box so adding/removing never shifts the page.
// Phone: stacked. ETAs and hours use your RECENT pace (recentPace), not an all-time average.
const pctTxt = (p) => `${Math.round((p || 0) * 100)}%`;
const Bar = ({ pct, cls = '', label }) => (
  <span className={`lj-pbar ${cls}`} role="img" aria-label={label || t('{pct} read', { pct: pctTxt(pct) })}><i style={{ width: pctTxt(Math.min(1, pct)) }} /></span>
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
    try { setDirs(await addSearchDir(await window.showDirectoryPicker({ id: 'tachyread-library-dirs', mode: 'read' }))); setFindMsg(''); } catch (e) { if (e?.name !== 'AbortError') setFindMsg(t('Could not add that folder: {error}', { error: e?.message || e })); }
  }
  // Local copy → already-open tab → the designated folders. Only the last step can be slow, and it
  // runs straight off this click so a folder whose permission lapsed can ask for it back.
  async function openTheFile(b) {
    const cs = csOf[b.id];
    if (!cs || finding) return;
    const name = fileStats[cs]?.fileName || b.title;
    setFinding(b.id); setFindMsg(dirs.length ? t('Looking for “{name}”…', { name }) : '');
    try {
      const r = await openBookFile({ cs, name, openChecksums, dirs, openRecent, openFiles });
      if (r.ok) closeDialog?.(); else setFindMsg(r.msg);
    } catch (e) {
      setFindMsg(t('Could not open “{name}”: {error}', { name, error: e?.message || e }));
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
  const saveQueues = (next) => { setQueues(next); saveLibraryRef('queues', next).catch((e) => setFindMsg(t('Could not save queues: {error}', { error: e?.message || e }))); };
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
  if (!queues) return <p className="settings-note">{t('Loading queues…')}</p>;

  return (
    <div className="lj-queue">
      <div className="lj-queue-pick" role="tablist" aria-label={t('Queues')}>
        {shownQueues.length > 0 && <button role="tab" aria-selected={overview} className={`lj-qcat${overview ? ' on' : ''}`} onClick={() => setSel('overview')} title={t('Every queue at a glance (view only)')}>📊 {t('All queues')}</button>}
        {shownQueues.map((x, qi) => {
          const qb = queueBooks(x, books);
          const done = qb.filter((b) => readStatus(b) === 'finished').length;
          const on = selQueue?.id === x.id;
          return (
            <span key={x.id} className="lj-qpill">
              {on && <button className="lj-qnudge" disabled={qi === 0} onClick={() => saveQueues(moveQueue(queues, x.id, -1))} aria-label={t('Move “{name}” left', { name: x.name })} title={t('Move this queue left')}>‹</button>}
              <button role="tab" aria-selected={on} className={`lj-qcat lj-qchip${on ? ' on' : ''}`} onClick={() => setSel(x.id)}
                title={t('{name}: {done} of {total} finished', { name: x.name, done, total: qb.length })}>
                <span>{x.name} ({qb.length})</span>
                <Bar pct={qb.length ? done / qb.length : 0} label={t('{done} of {total} finished', { done, total: qb.length })} />
              </button>
              {on && <button className="lj-qnudge" disabled={qi === shownQueues.length - 1} onClick={() => saveQueues(moveQueue(queues, x.id, 1))} aria-label={t('Move “{name}” right', { name: x.name })} title={t('Move this queue right')}>›</button>}
            </span>
          );
        })}
        {naming == null
          ? <button className="lj-qcat" onClick={() => setNaming('')} title={t('A hand-picked, hand-ordered list — a book can sit in several')}>＋ {t('New queue')}</button>
          : (
            <form className="lj-q-new" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) createQueue(); }}>
              <input autoFocus value={naming} placeholder={t('Queue name, e.g. AI lore')} aria-label={t('New queue name')}
                onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
              <button type="submit" disabled={!naming.trim()}>{t('Create')}</button>
              <button type="button" onClick={() => setNaming(null)}>{t('Cancel')}</button>
            </form>
          )}
        {undo && <button className="lj-qcat" onClick={() => { saveQueues(undo.queues); setUndo(null); }} title={t('Put the queues back as they were')}>↶ {t('Undo {action}', { action: undo.label })}</button>}
      </div>
      {overview ? <QueuesDashboard queues={queues} books={books} wpm={wpm} pace={pace} fileStats={fileStats} csOf={csOf} onPick={setSel} onBulk={bulk} />
        : !selQueue ? <p className="settings-note">{t('No queues yet — ＋ New queue to make one, then add books to it from the table that appears.')}</p> : (
        <div className={`lj-q-panes${stacked ? ' stacked' : ''}`}>
          <NamedQueue
            paths={paths} stacked={stacked} onLayout={toggleLayout}
            key={selQueue.id} // fresh rename/confirm-delete state per queue — an armed Delete must not carry over to the next one
            queue={selQueue} others={shownQueues.filter((x) => x.id !== selQueue.id)} books={books} wpm={wpm} setWpm={setWpm} pace={pace} fileStats={fileStats} csOf={csOf} pctOf={pctOf}
            openChecksums={openChecksums} dirs={dirs} finding={finding} openTheFile={openTheFile} findMsg={findMsg}
            onChange={(next) => saveQueues(queues.map((x) => (x.id === next.id ? next : x)))}
            onDelete={() => { bulk((qs) => deleteQueue(qs, selQueue.id), t('delete “{name}”', { name: selQueue.name })); setSel(null); }}
            onEdit={(fn) => saveQueues(fn(queues))}
            onBulk={bulk}
            onOpen={onOpen}
            folders={(
              <div className="lj-inline lj-findfolders">
                <span className="settings-note" style={{ margin: 0 }} title={t("A document's text never leaves the device it was opened on — only your reading record syncs. Name the folders your files live in and ▶ can find them on any device.")}>
                  📁 {dirs.length ? t('Where your documents live:') : t('Where your documents live — none set yet, so ▶ only opens books this device has already read.')}
                </span>
                {dirs.map((d) => (
                  <span key={d.name} className="lj-dirchip">
                    📁 {d.name}
                    <button title={t('Stop searching “{name}”', { name: d.name })} onClick={async () => setDirs(await removeSearchDir(d))}>✕</button>
                  </span>
                ))}
                {pickerSupported()
                  ? <button onClick={addDir} title={t('Pick a folder to search when a queued book has no copy on this device')}>➕ {t('Add folder…')}</button>
                  : <span className="settings-note" style={{ margin: 0 }}>{t('Choosing folders needs a Chromium browser (Chrome, Edge, Brave).')}</span>}
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

const ROW_KIND = { field: t('Book field'), note: t('Book note'), cross: t('Shared note'), link: t('File link'), analysis: t('Analysis'), recommendations: t('Read-next list'), weekly: t('Weekly summary'), brief: t('Morning brief'), treeMeta: t('Tree links'), answer: t('Answer'), queueOrder: t('Queue order'), queueAdd: t('Queue add'), queueMove: t('Queue move'), sessionReview: t('Session review'), dupe: t('Duplicate pair'), report: t('Report'), newBook: t('New book'), tags: t('Tags'), vocab: t('Vocab card'), typingPlan: t('Typing plan'), goal: t('Goal') };
const APPLY_CAP = 200; // most changes one apply may write (bigger replies are reviewed in pages)

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
    <section className="lj-qdash" aria-label={t('All queues')}>
      <div className="lj-qstats">
        <div className="ab-stat"><b>{total.queues}</b><span>{t('queues')}</span></div>
        <div className="ab-stat"><b>{total.done} / {total.count}</b><span>{t('books finished')}</span><Bar pct={total.count ? total.done / total.count : 0} label={t('{done} of {total} finished', { done: total.done, total: total.count })} /></div>
        <div className="ab-stat"><b>{fmtNum(total.wordsLeft)}</b><span>{t('words left of {total}', { total: fmtNum(total.wordsTotal) })}</span><Bar pct={total.wordsTotal ? 1 - total.wordsLeft / total.wordsTotal : 0} /></div>
        <div className="ab-stat"><b>{t('{n} h', { n: total.hoursLeft })}</b><span>{t('left at {wpm} wpm', { wpm })}</span></div>
        <div className="ab-stat" title={t('Everything left, read at your recent pace (last ~6 weeks, recent days weighted most)')}><b>{total.eta || '—'}</b><span>{total.eta ? t('all done at ~{n} words/day', { n: fmtNum(pace.wordsPerDay) }) : t('needs some recent reading')}</span></div>
        <div className="ab-stat"><b>{t('{n} h', { n: total.hoursSpent })}</b><span>{t('spent so far')}</span></div>
      </div>
      <div className="lj-inline lj-qdash-tools">
        {picked.length >= 2 ? (
          <form className="lj-q-new" onSubmit={(e) => {
            e.preventDefault();
            const order = rows.map((r) => r.queue.id).filter((id) => picked.includes(id));
            onBulk((qs) => mergeQueues(qs, order, mergeName), t('merge {n} queues', { n: order.length }));
            setPicked([]); setMergeName('');
          }}>
            <span className="settings-note" style={{ margin: 0 }}>{t('Merge {n} queues into', { n: picked.length })}</span>
            <input value={mergeName} onChange={(e) => setMergeName(e.target.value)} aria-label={t('Name of the merged queue')}
              placeholder={rows.find((r) => picked.includes(r.queue.id))?.queue.name} />
            <button type="submit" className="toggle-on" title={t('Books keep their order (left-most queue first); the other queues are removed — ↶ Undo puts them back')}>{t('Merge')}</button>
            <button type="button" onClick={() => setPicked([])}>{t('Cancel')}</button>
          </form>
        ) : <span className="settings-note" style={{ margin: 0 }}>{t('Tick two or more queues to merge them · ✂ on a row splits it.')}</span>}
      </div>
      <div className="lj-q-box lj-qdash-box">
        <table className="lj-cand lj-qdash-table">
          <thead><tr><th aria-label={t('Select')} /><th>{t('Queue')}</th><th>{t('Finished')}</th><th>{t('Words read')}</th><th>{t('Words left')}</th><th>{t('Hours left')}</th><th>{t('Done by*')}</th><th title={t('The same, counting only books that have a linked document')}>{t('Linked files only')}</th><th>{t('Up next')}</th></tr></thead>
          <tbody>
            {rows.map(({ queue: q, st, linked }) => (
              <tr key={q.id}>
                <td><input type="checkbox" checked={picked.includes(q.id)} onChange={() => togglePick(q.id)} aria-label={t('Select “{name}” to merge', { name: q.name })} /></td>
                <td>
                  <button className="link-btn" onClick={() => onPick(q.id)} title={t('Open this queue')}>{q.name}</button>
                  {splitAt?.id === q.id ? (
                    <span className="lj-qdash-split">
                      {' '}{t('first')} <input type="number" min="1" max={Math.max(1, st.count - 1)} value={splitAt.n} onChange={(e) => setSplitAt({ id: q.id, n: e.target.value })} aria-label={t('Books that stay in this queue')} /> {t('stay')}
                      <button onClick={() => { onBulk((qs) => splitQueue(qs, q.id, books, 'at', Number(splitAt.n) || 1), t('split “{name}”', { name: q.name })); setSplitAt(null); }}>{t('Split')}</button>
                      <button onClick={() => setSplitAt(null)}>✕</button>
                    </span>
                  ) : st.count > 1 && (
                    <select className="lj-q-move" value="" aria-label={t('Split “{name}”', { name: q.name })} title={t('Split this queue')}
                      onChange={(e) => {
                        const how = e.target.value;
                        if (!how) return;
                        if (how === 'at') setSplitAt({ id: q.id, n: Math.ceil(st.count / 2) });
                        else onBulk((qs) => splitQueue(qs, q.id, books, how), t('split “{name}”', { name: q.name }));
                      }}>
                      <option value="">✂</option>
                      {Object.entries(QUEUE_SPLITS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  )}
                </td>
                <td><Bar cls="fin" pct={st.count ? st.done / st.count : 0} label={t('{done} of {total} finished', { done: st.done, total: st.count })} /><span className="lj-cand-pct lj-qdash-n">{st.done}/{st.count}</span></td>
                <td><Bar pct={st.pctWords / 100} /><span className="lj-cand-pct">{st.pctWords}%</span></td>
                <td title={t('{n} words', { n: fmtNum(st.wordsLeft) })}><span className="lj-qdash-left"><i style={{ width: `${(st.wordsLeft / maxLeft) * 100}%` }} /></span>{Math.round(st.wordsLeft / 1000)}k</td>
                <td>{t('{n} h', { n: st.hoursLeft })}</td>
                <td>{st.eta || '—'}</td>
                <td title={t('{n} of {total} books have a linked document', { n: linked.count, total: st.count })}>{linked.count
                  ? <><Bar cls="fin" pct={linked.done / linked.count} label={t('{done} of {total} linked books finished', { done: linked.done, total: linked.count })} /><span className="lj-qdash-linked">{linked.done}/{linked.count} · {linked.pctWords}% · {t('{n} h', { n: linked.hoursLeft })}</span></>
                  : <span className="settings-note">{t('none linked')}</span>}</td>
                <td title={st.next?.title || ''}>{st.next?.title || (st.count ? `✓ ${t('all finished')}` : t('empty'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="settings-note lj-cand-foot">{t('* if that queue alone were read in order at your recent pace. Click a queue’s name to open it.')}</p>
    </section>
  );
}

// One queue: its stats (progress, pace, time, ETA, where the files are) with bars, the ordered list
// with ▶ open / reorder / remove, and whole-queue reorders.
const WHERE = { open: ['📂', t('Open in a tab')], local: ['💾', t('Saved on this device')], folder: ['📁', t('Found in a search folder')], unsearched: ['❔', t('Not on this device — not searched for yet')], missing: ['✖', t('Not on this device or in the search folders')], unlinked: ['—', t('No document linked')] };
// The queue table's filterable text columns (Words has min/max instead).
const QCOLS = { title: t('Title'), author: t('Author'), genre: t('Genre'), type: t('Type'), folder: t('Folder'), file: t('File') };
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
  // Cowork settings on the queue itself (they sync with it): a description the "Fill dynamic queues"
  // operation adds matching unread books from, and the prep-note types wanted for its unread books.
  const [cw, setCw] = useState(false);
  const [dyn, setDyn] = useState(queue.dynamic || '');
  const togglePrep = (pt) => onChange({ ...queue, prep: (queue.prep || []).includes(pt) ? queue.prep.filter((x) => x !== pt) : [...(queue.prep || []), pt] });
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
  }, [idsKey, openChecksums, dirs, paths]); // paths: Find folders may have dropped a stale one
  // One walk over the folders for every missing file (indexFolders, deep), not a crawl per book — a
  // long queue of files on another device used to burn a whole budget each without ever reaching
  // the subfolders. The paths it finds are remembered, so ▶ opens them without searching again.
  async function searchFolders() {
    setSearching(true);
    const todo = qBooks.filter((b) => where[b.id] === 'unsearched');
    const r = await indexFolders(dirs, todo.map((b) => ({ cs: csOf[b.id], name: fileStats[csOf[b.id]]?.fileName || b.title })), { ask: true }).catch(() => null);
    if (r) rememberPaths(r.paths);
    setWhere((m) => ({ ...m, ...Object.fromEntries(todo.map((b) => [b.id, r?.paths[csOf[b.id]] ? 'folder' : 'missing'])) }));
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
  const qfiltered = Object.values(qcols).some((v) => v?.trim()) || minW !== '' || maxW !== '' || qstate !== 'all';
  const resort = (key) => onBulk((qs) => setQueueIds(qs, queue.id, sortQueueIds(qBooks, key, (b) => ({ pct: pctOf(b), lastRead: fileStats[csOf[b.id]]?.lastRead }))), t('sort ({how})', { how: QUEUE_SORTS[key][0].toLowerCase() }));

  return (
    <section className="lj-q-pane" aria-label={t('Queue: {name}', { name: queue.name })}>
      <div className="rh-section-h lj-sh-row">
        {renaming == null
          ? <span>{queue.name}</span>
          : (
            <form className="lj-q-new" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) { onChange({ ...queue, name: renaming.trim() }); setRenaming(null); } }}>
              <input autoFocus value={renaming} aria-label={t('Queue name')} onChange={(e) => setRenaming(e.target.value)} />
              <button type="submit">{t('Save')}</button>
              <button type="button" onClick={() => setRenaming(null)}>{t('Cancel')}</button>
            </form>
          )}
        <span className="lj-spacer" />
        {renaming == null && <button onClick={() => setRenaming(queue.name)}>{t('Rename')}</button>}
        <button aria-expanded={cw} onClick={() => setCw(!cw)} title={t('What the cowork may do with this queue: fill it from a description, prepare notes for its unread books')}>🤖 {t('Cowork')}{String(queue.dynamic || '').trim() ? ' · 🧲' : ''}{queue.prep?.length ? ' · 📖' : ''}</button>
        {confirmDel
          ? <><button className="danger" onClick={onDelete}>{t('Delete “{name}”', { name: queue.name })}</button><button onClick={() => setConfirmDel(false)}>{t('Keep')}</button></>
          : <button onClick={() => setConfirmDel(true)} title={t('Delete this queue (the books stay in your library)')}>{t('Delete')}</button>}
      </div>
      {cw && (
        <div className="lj-qcw">
          <label>🧲 {t('Dynamic — the cowork adds unread books that fit:')}
            <input type="text" value={dyn} placeholder={t('e.g. American literature (empty = not dynamic)')} aria-label={t('Dynamic queue description')}
              onChange={(e) => setDyn(e.target.value)} onBlur={() => { if (dyn.trim() !== String(queue.dynamic || '')) onChange({ ...queue, dynamic: dyn.trim() }); }} />
          </label>
          <span>📖 {t('Prep notes for its unread books:')}
            {PREP_NOTE_TYPES.map((pt) => <label key={pt}><input type="checkbox" checked={(queue.prep || []).includes(pt)} onChange={() => togglePrep(pt)} /> {AI_NOTE_TYPES[pt]}</label>)}
          </span>
          <p className="settings-note">{t('Cowork page → “Fill dynamic queues”, “Prep notes for queued books”, “Suggest re-queuing mis-queued books”. Every change is reviewed there before it lands.')}</p>
        </div>
      )}
      {st.count > 0 && (
        <>
          {/* The whole queue at a glance: one segment per book, sized by length, filled by progress. */}
          <div className="lj-qseg" role="img" aria-label={t("{pct}% of the queue's words read", { pct: st.pctWords })}>
            {qBooks.map((b) => (
              <span key={b.id} style={{ flexGrow: Math.max(1, Math.sqrt(Number(b.words) || (Number(b.pages) || 0) * 275 || 1)) }}
                title={t('{title} — {pct} read', { title: b.title, pct: pctTxt(st.pctById[b.id]) })} className={readStatus(b) === 'finished' ? 'fin' : ''}>
                <i style={{ width: pctTxt(st.pctById[b.id]) }} />
              </span>
            ))}
          </div>
          <div className="lj-qstats">
            <div className="ab-stat"><b>{st.done} / {st.count}</b><span>{t('finished')}</span><Bar pct={st.done / st.count} label={t('{done} of {total} finished', { done: st.done, total: st.count })} /></div>
            <div className="ab-stat"><b>{st.pctWords}%</b><span>{t('of {n} words read', { n: fmtNum(st.wordsTotal) })}</span><Bar pct={st.pctWords / 100} /></div>
            <div className="ab-stat"><b>{avail} / {st.count}</b><span>{t('files available')}{counts.unsearched ? ` · ${t('{n} not searched', { n: counts.unsearched })}` : ''}{counts.missing ? ` · ${t('{n} missing', { n: counts.missing })}` : ''}</span><Bar cls="files" pct={avail / st.count} label={t('{done} of {total} files available', { done: avail, total: st.count })} /></div>
            <div className="ab-stat"><b>{t('{n} h', { n: st.hoursLeft })}</b><span>{t('left at {wpm} wpm', { wpm })}</span></div>
            <div className="ab-stat" title={t('Projected finish if read in order at your recent pace — the last ~6 weeks of reading, recent days weighted most (days off count too)')}>
              <b>{st.eta || '—'}</b><span>{st.eta ? t('ETA at ~{n} words/day lately', { n: fmtNum(st.wordsPerDay) }) : t('ETA needs some recent reading')}</span>
            </div>
            <div className="ab-stat"><b>{t('{n} h', { n: st.hoursSpent })}</b><span>{st.readingWpm ? t('spent · ~{wpm} wpm on these', { wpm: st.readingWpm }) : t('spent')}</span></div>
          </div>
          <div className="lj-qlinked" title={t('The same stats counting only books that have a linked document')}>
            <span className="lj-qlinked-h">🔗 {t('Linked files only · {n} of {total}', { n: lst.count, total: st.count })}</span>
            {lst.count ? <>
              <span className="lj-qlinked-s"><Bar cls="fin" pct={lst.done / lst.count} label={t('{done} of {total} linked books finished', { done: lst.done, total: lst.count })} />{t('{done}/{total} finished', { done: lst.done, total: lst.count })}</span>
              <span className="lj-qlinked-s"><Bar pct={lst.pctWords / 100} />{t('{pct}% read', { pct: lst.pctWords })}</span>
              <span className="lj-qlinked-s">{t('{n} h left', { n: lst.hoursLeft })}</span>
              <span className="lj-qlinked-s">{lst.eta ? t('done ~{eta}', { eta: lst.eta }) : t('ETA —')}</span>
              <span className="lj-qlinked-s">{lst.readingWpm ? t('{n} h spent · ~{wpm} wpm', { n: lst.hoursSpent, wpm: lst.readingWpm }) : t('{n} h spent', { n: lst.hoursSpent })}</span>
            </> : <span className="settings-note" style={{ margin: 0 }}>{t('none of these books has a linked document yet')}</span>}
          </div>
        </>
      )}
      <div className="lj-inline lj-q-tools">
        <label className="settings-note" title={pace.wpm ? t('Your recent reading speed is ~{wpm} wpm', { wpm: pace.wpm }) : t('No recent reading speed yet')}>
          {t('Speed')} <input type="number" className="lj-wpm" min="100" max="1500" step="10" value={wpm} onChange={(e) => setWpm(Number(e.target.value) || null)} aria-label={t('Words per minute')} /> {t('wpm')}
        </label>
        <select value="" onChange={(e) => { if (e.target.value) resort(e.target.value); }} aria-label={t('Reorder the whole queue')} disabled={qBooks.length < 2}>
          <option value="">⇅ {t('Reorder…')}</option>
          {Object.entries(QUEUE_SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={qstate} onChange={(e) => setQstate(e.target.value)} aria-label={t('Show')}>
          {Object.entries(CAND_STATES).map(([k, label]) => <option key={k} value={k}>{k === 'all' ? t('All books') : label}</option>)}
        </select>
        {qfiltered && <button onClick={() => { setQcols({}); setMinW(''); setMaxW(''); setQstate('all'); }}>{t('Clear filters')}</button>}
        <span className="lj-spacer" />
        <button onClick={onLayout} title={stacked ? t('Put the queue and the add-books table side by side') : t('Stack the add-books table under the queue (room for every column)')}>{stacked ? `⇔ ${t('Side by side')}` : `⇕ ${t('Stack')}`}</button>
        {counts.unsearched > 0 && <button disabled={searching} onClick={searchFolders} title={t('Look through your search folders for the files not on this device')}>{searching ? `⟳ ${t('Searching…')}` : `🔎 ${t('Search folders ({n})', { n: counts.unsearched })}`}</button>}
        <button disabled={!st.next} title={t('Open a random unfinished pick from this queue')} onClick={() => {
          const pool = qBooks.filter((b) => readStatus(b) !== 'finished');
          if (pool.length) onOpen(pool[Math.floor(Math.random() * pool.length)].id);
        }}>🎲</button>
      </div>
      {findMsg && <p className="settings-note lj-findmsg">{findMsg}</p>}
      <div className="lj-q-box">
        {qBooks.length === 0 ? <p className="settings-note">{stacked ? t('Empty so far — add books from the table below.') : <><span className="lj-q-wide-only">{t('Empty so far — add books from the table on the right.')}</span><span className="lj-q-narrow-only">{t('Empty so far — add books from the table below.')}</span></>}</p> : (
          <table className="lj-cand lj-qtable">
            <colgroup><col className="c-rank" /><col className="c-title" /><col className="c-author" /><col className="c-genre" /><col className="c-type" /><col className="c-words" /><col className="c-read" /><col className="c-eta" /><col className="c-folder" /><col className="c-file" /><col className="c-acts" /></colgroup>
            <thead>
              <tr><th>#</th><th>{t('Title')}</th><th>{t('Author')}</th><th>{t('Genre')}</th><th>{t('Type')}</th><th title={t('Words · hours at your speed')}>{t('Words')}</th><th>{t('Read')}</th><th>{t('Done by')}</th><th>{t('Folder')}</th><th>{t('File')}</th><th aria-label={t('Actions')} /></tr>
              <tr className="lj-cand-filters">
                <th />
                {['title', 'author', 'genre', 'type'].map((k) => (
                  <th key={k}><input value={qcols[k] || ''} onChange={(e) => setQcols({ ...qcols, [k]: e.target.value })} placeholder={t('regex')} className={qbad.includes(k) ? 'bad' : ''} aria-label={t('Filter {column} (regular expression)', { column: QCOLS[k] })} /></th>
                ))}
                <th className="lj-qwords-f">
                  <input value={minW} onChange={(e) => setMinW(e.target.value)} placeholder={t('min k')} inputMode="numeric" aria-label={t('Minimum words, in thousands')} title={t('Minimum words, in thousands (e.g. 50 = 50,000)')} />
                  <input value={maxW} onChange={(e) => setMaxW(e.target.value)} placeholder={t('max k')} inputMode="numeric" aria-label={t('Maximum words, in thousands')} title={t('Maximum words, in thousands (e.g. 120 = 120,000)')} />
                </th>
                <th /><th />
                {['folder', 'file'].map((k) => (
                  <th key={k}><input value={qcols[k] || ''} onChange={(e) => setQcols({ ...qcols, [k]: e.target.value })} placeholder={t('regex')} className={qbad.includes(k) ? 'bad' : ''} aria-label={t('Filter {column} (regular expression)', { column: QCOLS[k] })} /></th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {fin.length > 0 && (
                <tr className="lj-q-finhead"><td colSpan={11}><button onClick={toggleFin} aria-expanded={!hideFin}>{hideFin ? '▸' : '▾'} ✓ {t('{n} finished', { n: fin.length })}</button></td></tr>
              )}
              {shownRows.map(({ book: b, pct: p, cols: c, words }) => {
                const isFin = readStatus(b) === 'finished';
                const i = isFin ? -1 : todo.indexOf(b);
                const w = WHERE[where[b.id]] || ['…', t('Checking')];
                const last = i === todo.length - 1;
                return (
                  <tr key={b.id} className={isFin ? 'done' : ''}>
                    <td className="lj-qrank">{isFin ? '✓' : i + 1}</td>
                    <td title={b.title}><button className="link-btn" onClick={() => onOpen(b.id)} title={t('Open in Library')}>{b.title}</button></td>
                    <td title={c.author}>{c.author}</td>
                    <td title={c.genre}>{c.genre}</td>
                    <td>{c.type}</td>
                    <td title={t('{n} words', { n: fmtNum(words) })}>{words ? `${Math.round(words / 1000)}k` : '—'}{estHours(b, wpm) != null ? <span className="lj-qdim"> · {t('{n} h', { n: estHours(b, wpm) })}</span> : ''}</td>
                    <td><Bar pct={p} cls={isFin ? 'fin' : ''} /><span className="lj-cand-pct">{pctTxt(p)}</span></td>
                    <td>{isFin ? (b.finishTime || '✓') : st.etaById[b.id] || '—'}</td>
                    <td title={c.folder}>{c.folder}</td>
                    <td title={c.file}><span className="lj-where" role="img" aria-label={w[1]} title={w[1]}>{w[0]}</span>{c.file}</td>
                    <td className="lj-qacts">
                      {csOf[b.id] && <button className="lj-queue-read" disabled={finding === b.id} onClick={() => openTheFile(b)} title={t('Read it')}>{finding === b.id ? '⟳' : '▶'}</button>}
                      {!isFin && <>
                        <button disabled={i === 0} onClick={() => move(b, 0)} aria-label={t('Move “{title}” to the top', { title: b.title })} title={t("To the top (of what's left)")}>⤒</button>
                        <button disabled={i === 0} onClick={() => move(b, i - 1)} aria-label={t('Move “{title}” up', { title: b.title })} title={t('Up one place in the full queue')}>↑</button>
                        <button disabled={last} onClick={() => move(b, i + 1)} aria-label={t('Move “{title}” down', { title: b.title })} title={t('Down one place in the full queue')}>↓</button>
                        <button disabled={last} onClick={() => move(b, todo.length)} aria-label={t('Move “{title}” to the bottom', { title: b.title })} title={t('To the bottom')}>⤓</button>
                      </>}
                      {others.length > 0 && (
                        <select className="lj-q-move" value="" aria-label={t('Move “{title}” to another queue', { title: b.title })} title={t('Move to another queue')}
                          onChange={(e) => { if (e.target.value) onEdit((qs) => addToQueue(qs, e.target.value, b.id)); }}>
                          <option value="">⇄</option>
                          {others.map((x) => <option key={x.id} value={x.id}>→ {x.name}</option>)}
                        </select>
                      )}
                      <button title={t('Remove from this queue')} aria-label={t('Remove “{title}” from this queue', { title: b.title })} onClick={() => onEdit((qs) => removeFromQueue(qs, queue.id, b.id))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {qfiltered && <p className="settings-note lj-cand-foot">{hideFin && fin.length
        ? t('Showing {n} of {total} ({fin} finished hidden) — numbers and moves still follow the full queue order.', { n: shownRows.length, total: qrows.length, fin: fin.length })
        : t('Showing {n} of {total} — numbers and moves still follow the full queue order.', { n: shownRows.length, total: qrows.length })}</p>}
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
    setIndexing(`⟳ ${t('Looking through your folders…')}`);
    const r = await indexFolders(dirs, wanted, { ask }).catch(() => null);
    if (!r) { setIndexing(t('Could not read the search folders.')); return; }
    // A walk that read every folder to the end and still missed a file: its remembered path is stale.
    rememberPaths(r.paths, r.complete ? wanted.map((w) => w.cs).filter((cs) => !r.paths[cs]) : []);
    setPaths(foundPaths());
    const foundMsg = { found: r.found, total: wanted.length, scanned: fmtNum(r.scanned) };
    setIndexing(ask || r.found ? (r.skipped
      ? t.n('Found {found} of {total} linked files ({scanned} entries looked at) · {n} folder needs permission — use Find folders.', 'Found {found} of {total} linked files ({scanned} entries looked at) · {n} folders need permission — use Find folders.', r.skipped, foundMsg)
      : t('Found {found} of {total} linked files ({scanned} entries looked at).', foundMsg)) : '');
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
  const filtered = Object.values(cols).some((v) => v?.trim()) || state !== 'unfinished';
  return (
    <section className="lj-q-pane" aria-label={t('Add books to {name}', { name: queue.name })}>
      <div className="rh-section-h lj-sh-row">
        <span>{t('Add books')}</span>
        <span className="lj-spacer" />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t('Completion')}>
          {Object.entries(CAND_STATES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {filtered && <button onClick={() => { setCols({}); setState('unfinished'); }}>{t('Clear filters')}</button>}
        <button disabled={!dirs.length || indexing.startsWith('⟳')} onClick={() => runIndex(true)}
          title={dirs.length ? t('Look through your search folders and record which folder each linked file is in') : t('Add a search folder first (📁 Where your documents live, under the queue)')}>📁 {t('Find folders')}</button>
        <button disabled={!rows.length} onClick={() => onAdd(shown.map((r) => r.book.id), t('add {n}', { n: shown.length }))}
          title={t('Add the {n} books shown to “{name}”, in this order', { n: shown.length, name: queue.name })}>＋ {t('All shown ({n})', { n: shown.length })}</button>
      </div>
      {indexing && <p className="settings-note lj-findmsg">{indexing}</p>}
      <div className="lj-q-box lj-cand-box">
        <table className="lj-cand">
          <colgroup><col className="c-add" /><col className="c-title" /><col className="c-author" /><col className="c-genre" /><col className="c-type" /><col className="c-status" /><col className="c-folder" /><col className="c-file" /><col className="c-prog" /><col className="c-size" /></colgroup>
          <thead>
            <tr><th aria-label={t('Add')} />{Object.values(CAND_COLS).map((l) => <th key={l}>{l}</th>)}<th>{t('Read')}</th><th>{t('Size')}</th></tr>
            <tr className="lj-cand-filters">
              <th />
              {Object.entries(CAND_COLS).map(([k, l]) => (
                <th key={k}>
                  <input value={cols[k] || ''} onChange={(e) => setCols({ ...cols, [k]: e.target.value })} placeholder={t('regex')}
                    className={bad.includes(k) ? 'bad' : ''} aria-label={t('Filter {column} (regular expression)', { column: l })}
                    title={bad.includes(k) ? t('Not a valid regular expression — matching it as plain text') : t('Filter {column} — a regular expression, case-insensitive (e.g. ^the|war$)', { column: l })} />
                </th>
              ))}
              <th /><th />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ book: b, pct, cols: c, open }) => (
              <tr key={b.id} className={open ? 'open' : ''}>
                <td><button className="lj-cand-add" onClick={() => onAdd([b.id])} aria-label={t('Add “{title}” to {name}', { title: b.title, name: queue.name })} title={t('Add to {name}', { name: queue.name })}>＋</button></td>
                <td title={c.title}><button className="link-btn" onClick={() => onOpen(b.id)} title={t('Open in Library')}>{c.title}</button>{open ? ' 📂' : ''}</td>
                <td title={c.author}>{c.author}</td>
                <td title={c.genre}>{c.genre}</td>
                <td>{c.type}</td>
                <td>{c.status}</td>
                <td title={c.folder}>{c.folder}</td>
                <td title={c.file}>{c.file}</td>
                <td><Bar pct={pct} /><span className="lj-cand-pct">{pctTxt(pct)}</span></td>
                <td>{estHours(b, wpm) != null ? t('~{n} h', { n: estHours(b, wpm) }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="settings-note">{filtered ? t('No books match these filters.') : t('No books match — everything unfinished is already queued.')}</p>}
      </div>
      <p className="settings-note lj-cand-foot">
        {rows.length > CAND_SHOW ? t('Showing {n} of {total} — filter to narrow.', { n: CAND_SHOW, total: rows.length }) : t.n('{n} book.', '{n} books.', rows.length)}{' '}
        {t('Books already in a queue aren’t listed (a book sits in one queue — use ⇄ on its row to move it).')}{' '}
        {t('Folder comes from your search folders (the browser doesn’t say where a file was opened from) — 📁 Find folders fills it in; File is the linked document’s name.')}
      </p>
    </section>
  );
}

// ── Series view ──────────────────────────────────────────────────────────────────────────────────
// Every multi-book series: volume chips coloured by read status, progress count, and the next unread
// volume with a one-tap queue. Active series (started, unfinished) sort first.
function SeriesView({ books, crossNotes = [], onDeleteCross, onShelve, onOpen }) {
  const series = useMemo(() => seriesProgress(books), [books]);
  if (!series.length) return <p className="settings-note">{t('No multi-book series in your tracker yet — set the Series field (and #) on books to group them here.')}</p>;
  const active = series.filter((s) => s.active).length;
  const done = series.filter((s) => s.done).length;
  return (
    <div className="lj-series">
      <p className="settings-note">{t('{n} series · {active} in progress · {done} completed. Click a volume to open it.', { n: series.length, active, done })}</p>
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
              <span className="settings-note" style={{ margin: 0 }}>{t('Next up:')}</span> <b>{s.next.title}</b>
              {readStatus(s.next) === 'queue'
                ? <span className="settings-note" style={{ margin: 0 }}>· {t('on deck')} 📋</span>
                : <button onClick={() => onShelve(s.next, 'queue')}>📋 {t('Queue it')}</button>}
            </div>
          )}
          {crossNotes.filter((n) => n.series === s.series).map((n) => (
            <div key={n.id} className="lj-ainote lj-xnote">
              <span className="lj-xnote-span"><em className="lj-xnote-type">{AI_NOTE_TYPES[n.type] || t('Note')}{n.source === 'ai' ? ` · ${t('AI')}` : ''} · {t('series note')}</em>
                <button className="close-x" title={t('Delete this series note')} onClick={() => onDeleteCross?.(n.id)}>×</button></span>
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
    setMsg(n ? `${t('Marked {n} fully-read component(s) finished.', { n })} ✅` : t('No fully-read unfinished components to mark.'));
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
  const forgetGrp = (id) => { onGroups(groups.filter((g) => g.id !== id)); setEditGrp(null); setMsg(t('Group forgotten on this device — its files keep their own progress.')); };
  // Create a group right here (same makeGroup as Settings → Book Groups).
  const [newSel, setNewSel] = useState(() => new Set());
  const [newName, setNewName] = useState('');
  function createGroup() {
    const g = makeGroup(newName, [...newSel], Date.now());
    if (!g) { setMsg(t('Pick at least two files to group as one book.')); return; }
    onGroups([...groups, g]);
    setNewSel(new Set()); setNewName('');
    setMsg(t('Grouped {n} files as “{name}”.', { n: g.members.length, name: g.name }));
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
    if (!rows.length) setMsg(`${t('Every opened file is already linked.')} ✅`);
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
      setBusy({ done: i, total: todo.length, label: making ? t('Creating “{title}”', { title: r.title }) : t('Linking “{title}” → {to}', { title: r.title, to }) });
      mark(r.cs, { state: 'busy' });
      try {
        let id = r.target;
        if (making) { const book = newBookFor(r, id.slice(4)); await onSaveBook(book); id = book.id; created++; } else linked++;
        await onBind(r.cs, id);
        mark(r.cs, { state: making ? 'created' : 'linked', outcome: making ? t('created “{title}”', { title: to }) : t('linked to “{title}”', { title: to }), target: 'skip' });
      } catch (e) {
        failed++;
        if (making) created--; else linked--;
        mark(r.cs, { state: 'failed', outcome: t('failed: {error}', { error: e?.message || e }) });
      }
    }
    setBusy(null);
    setMsg(failed
      ? t('Linked {linked} file(s) to existing books and created {created} new book(s). {failed} failed — see the table.', { linked, created, failed })
      : t('Linked {linked} file(s) to existing books and created {created} new book(s).', { linked, created }));
    // Everything worked → the table has nothing left to say. A failure keeps it up, marked.
    if (!failed) { setBulk(null); setPick(null); }
  }

  return (
    <div className="lj-groupsview">
      <div className="rh-section-h">{t('Book groups ↔ tracker books')}</div>
      {groups.length === 0 && <p className="settings-note">{t('No book groups yet — group edition files under Settings → Book Groups, then link each group to its tracker book here.')}</p>}
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
                ? <input value={g.name} onChange={(e) => renameGrp(g.id, e.target.value)} aria-label={t('Group name')} />
                : <b>{g.name}</b>}
              <em>{t('{n} file(s) · master: {file}', { n: (g.members || []).length, file: nameOf(master) })}</em>
            </span>
            {linked ? (
              <span className="lj-grp-acts">
                <span className="rh-link-chip on">🔗 {linked.title}</span>
                <button onClick={() => onOpen(linked.id)}>↗ {t('Open')}</button>
                <button title={t("Remove the link between this group's master file and the tracker book")} onClick={() => onBind(null, linked.id)}>{t('Unlink')}</button>
              </span>
            ) : (
              <span className="lj-grp-acts">
                <span className="rh-link-chip">○ {t('not linked')}</span>
                {sugg && <button className="toggle-on" onClick={() => onBind(master, sugg.id)}>{t('Link “{title}”', { title: sugg.title })}</button>}
                <button title={t('Create a tracker book named after the group and link it')} onClick={async () => { const book = { id: deriveId({ title: g.name }), title: g.name }; await onSaveBook(book); await onBind(master, book.id); }}>＋ {t('New book')}</button>
              </span>
            )}
            <span className="lj-grp-acts">
              <button title={t('Rename, change the master, add/remove files, or forget this group')} onClick={() => setEditGrp(editing ? null : g.id)}>{editing ? t('Done') : `✎ ${t('Edit')}`}</button>
            </span>
            {editing && (
              <div className="lj-grp-edit">
                {(g.members || []).map((cs) => (
                  <div key={cs} className="lj-grp-member">
                    <label title={cs === master ? t('Master (canonical) copy') : t('Make this the master copy')}>
                      <input type="radio" name={`ljm-${g.id}`} checked={cs === master} onChange={() => setGrpMaster(g.id, cs)} />
                      <span>{cs === master ? '★' : '☆'}</span>
                    </label>
                    <span className="lj-grp-member-name" title={cs}>{nameOf(cs)}</span>
                    <button title={t('Remove this file from the group')} onClick={() => removeGrpMember(g.id, cs)}>×</button>
                  </div>
                ))}
                <div className="lj-inline" style={{ margin: '4px 0 0' }}>
                  {ungroupedFiles.length > 0 && (
                    <form className="lj-q-new" onSubmit={(e) => { e.preventDefault(); const m = /\[([^\]]+)\]$/.exec(grpAddQ.trim()); if (m) { addGrpMember(g.id, m[1]); setGrpAddQ(''); } }}>
                      <input list="lj-grp-files" value={grpAddQ} onChange={(e) => setGrpAddQ(e.target.value)} placeholder={t('＋ Add a file — type to search…')} aria-label={t('Add a file to this group')} title={t('Add another edition/file to this group (type part of its name)')} />
                      <button type="submit" disabled={!/\[[^\]]+\]$/.test(grpAddQ.trim())}>{t('Add')}</button>
                      <datalist id="lj-grp-files">
                        {ungroupedFiles.map(([cs, f]) => <option key={cs} value={`${f.fileName || cs.slice(0, 8)} [${cs}]`} />)}
                      </datalist>
                    </form>
                  )}
                  <button className="lj-danger" title={t('Delete the group (files keep their own progress)')} onClick={() => forgetGrp(g.id)}>🗑 {t('Forget group')}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {ungroupedFiles.length >= 2 && (
        <details className="lj-newgrp">
          <summary>＋ {t('New group — pick 2+ files that are the same book')}</summary>
          <TextF value={grpQ} onChange={setGrpQ} label={t('file name')} />
          <div className="lj-newgrp-list">
            {ungroupedFiles.filter(([cs, f]) => newSel.has(cs) || !textMatcher(grpQ).test || textMatcher(grpQ).test(f.fileName || '')).map(([cs, f]) => (
              <label key={cs} className="inline-check">
                <input type="checkbox" checked={newSel.has(cs)} onChange={(e) => setNewSel((prev) => { const n = new Set(prev); e.target.checked ? n.add(cs) : n.delete(cs); return n; })} />
                {f.fileName || cs.slice(0, 8)}
              </label>
            ))}
          </div>
          <div className="lj-inline">
            <input placeholder={t('Book name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="toggle-on" disabled={newSel.size < 2} onClick={createGroup}>{newSel.size >= 2 ? t('Group {n} as one book', { n: newSel.size }) : t('Group as one book')}</button>
          </div>
        </details>
      )}
      {msg && !anth && <p className="settings-note">{msg}</p>}

      <div className="rh-section-h">{t('Unlinked files — bulk link')}</div>
      <p className="settings-note">
        {t('Find every opened file with no tracker book. Each gets a best guess — an existing book when the title and length really fit, a new AI-generated book when nothing comes close, or leave unlinked when it is only a partial match — and every guess is a dropdown away from being changed before anything is written.')}
      </p>
      <div className="lj-inline">
        <button disabled={!!busy} onClick={scanUnlinked}>🔍 {t('Scan opened files')}</button>
        {bulk && <span className="settings-note" style={{ margin: 0 }}>{t('{n} unlinked · {sure} sure · {weak} to review · {none} new', { n: bulk.length, sure: tierCount.strong, weak: tierCount.weak, none: tierCount.none })}</span>}
      </div>
      {bulk && (
        <div className="lj-cleanup">
          <div className="lj-tablewrap">
            <table className="lj-table lj-bulk">
              <thead>
                <tr><th>{t('File')}</th><th>{t('Words')}</th><th>{t('Read')}</th><th>{t('Match')}</th><th>{t('Link to')}</th><th></th></tr>
                <tr className="lj-filter-row">
                  <th><TextF value={bulkF.file} onChange={(v) => setBulkF({ ...bulkF, file: v })} label={t('file')} /></th>
                  <th><RangeF value={bulkF.words} onChange={(v) => setBulkF({ ...bulkF, words: v })} label={t('words')} unit="k" /></th>
                  <th><RangeF value={bulkF.read} onChange={(v) => setBulkF({ ...bulkF, read: v })} label={t('% read')} /></th>
                  <th>
                    <select value={bulkF.tier} onChange={(e) => setBulkF({ ...bulkF, tier: e.target.value })} aria-label={t('Filter by match')}>
                      <option value="all">{t('all')}</option><option value="strong">✓ {t('sure')}</option><option value="weak">? {t('review')}</option><option value="none">– {t('none')}</option>
                    </select>
                  </th>
                  <th colSpan={2} />
                </tr>
              </thead>
              <tbody>
                {bulk.filter((r) => { const mt = textMatcher(bulkF.file).test; return (!mt || mt(`${r.title} ${r.fileName || ''}`)) && inRange(r.words, ...bulkF.words, 1000) && inRange(r.coverage * 100, ...bulkF.read) && (bulkF.tier === 'all' || r.tier === bulkF.tier); }).map((r) => {
                  const toBook = r.target !== 'skip' && !r.target.startsWith('new:');
                  const dupe = toBook && bulk.some((o) => o !== r && o.target === r.target);
                  const taken = toBook ? fileOf[r.target] : null;
                  return (
                    <Fragment key={r.cs}>
                      <tr className={`${r.state ? `st-${r.state}` : ''} ${!r.state && r.target === 'skip' ? 'skip' : ''}`.trim()}>
                        <td className="lj-bulk-name" title={r.fileName}>{r.title}</td>
                        <td>{r.words ? fmtNum(r.words) : '—'}</td>
                        <td>{Math.round(r.coverage * 100)}%</td>
                        <td>{r.state
                          ? <span className={`lj-tier t-${r.state}`} title={r.outcome || ''}>{r.state === 'busy' ? `⟳ ${t('working…')}` : r.state === 'linked' ? `✓ ${t('linked')}` : r.state === 'created' ? `✓ ${t('created')}` : `✕ ${t('failed')}`}</span>
                          : <span className={`lj-tier t-${r.tier}`} title={r.why}>{r.tier === 'strong' ? `✓ ${t('sure')}` : r.tier === 'weak' ? `? ${t('review')}` : `– ${t('none')}`}</span>}</td>
                        <td>
                          {r.state === 'linked' || r.state === 'created' ? <span className="lj-bulk-done">{r.outcome}</span> : (
                          <select disabled={!!busy} value={r.target} onChange={(e) => setTarget(r.cs, e.target.value)} aria-label={t('Link {title} to', { title: r.title })}>
                            <option value="skip">— {t('leave unlinked')}</option>
                            <optgroup label={t('Create a new tracker book')}>
                              <option value="new:ai-gen">＋ {t('AI-generated')}</option>
                              <option value="new:long">＋ {t('Long-form book')}</option>
                              <option value="new:short">＋ {t('Short-form')}</option>
                              <option value="new:article">＋ {t('Article')}</option>
                            </optgroup>
                            {r.cands.length > 0 && (
                              <optgroup label={t('Existing books')}>
                                {r.cands.map((c) => <option key={c.book.id} value={c.book.id}>{Math.round(c.score * 100)}% · {c.book.title}{c.book.author ? ` — ${c.book.author}` : ''}{fileOf[c.book.id] ? ' 🔗' : ''}</option>)}
                              </optgroup>
                            )}
                          </select>)}
                          {r.state === 'failed' && <span className="lj-bulk-warn" title={r.outcome}>⚠ {r.outcome}</span>}
                          {dupe && !r.state && <span className="lj-bulk-warn" title={t('Another row targets the same book. A book keeps one linked file, so only the last one applied stays linked — group editions under Settings → Book Groups instead.')}>⚠ {t('twice')}</span>}
                          {taken && !dupe && !r.state && <span className="lj-bulk-warn" title={t('Already linked to “{file}” — applying moves that link to this file (group editions under Settings → Book Groups instead)', { file: nameOf(taken) })}>⚠ {t('relink')}</span>}
                        </td>
                        <td className="lj-bulk-acts">{r.state !== 'linked' && r.state !== 'created' && <button disabled={!!busy} onClick={() => setPick(pick?.cs === r.cs ? null : { cs: r.cs, q: '' })} title={t('Search the whole library for the right book')}>🔍</button>}</td>
                      </tr>
                      {pick?.cs === r.cs && (
                        <tr className="lj-bulk-pickrow"><td colSpan={6}>
                          <span className="lj-anth-pick">
                            <input autoFocus placeholder={t('Search title or author…')} value={pick.q} onChange={(e) => setPick({ cs: r.cs, q: e.target.value })} aria-label={t('Search books')} />
                            {pickMatches.map((b) => <button key={b.id} onClick={() => chooseBook(r, b)}>{b.title}{b.author ? ` — ${b.author}` : ''}</button>)}
                            {pick.q.trim() && !pickMatches.length && <em className="settings-note" style={{ margin: 0 }}>{t('no book matches')}</em>}
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
            <button className="toggle-on" disabled={!!busy || (!nLink && !nNew)} onClick={applyBulk}>{busy ? `⟳ ${t('Applying {done}/{total}…', { done: busy.done, total: busy.total })}` : `✓ ${t('Apply — link {link}, create {create}', { link: nLink, create: nNew })}`}</button>
            <button disabled={!!busy} onClick={() => { setBulk(null); setPick(null); }}>{t('Dismiss')}</button>
          </div>
        </div>
      )}

      <div className="rh-section-h">{t('Anthologies & collections — components map to sections')}</div>
      <p className="settings-note">{t('Pick a stored document (the anthology file); each ToC section can bind to its own tracker book. Reading a section fully lets you mark that component finished.')}</p>
      <div className="lj-inline">
        <select value={anthCs} onChange={(e) => pickDoc(e.target.value)}>
          <option value="">{t('Pick a document…')}</option>
          {docMeta.map((d) => <option key={d.checksum} value={d.checksum}>{d.fileName}</option>)}
        </select>
        {anth && anth.sections.some((s) => mappedFor(s)) && <button className="toggle-on" onClick={finishComponents}>✓ {t('Mark fully-read components finished')}</button>}
        {msg && <span className="settings-note" style={{ margin: 0 }}>{msg}</span>}
      </div>
      {anth && anth.sections.length === 0 && <p className="settings-note">{t('“{file}” has no stored Table of Contents — open it and run the ToC wizard first.', { file: anth.fileName })}</p>}
      {anth && anth.sections.length > 0 && (
        <div className="lj-anth">
          {anth.sections.map((sec) => {
            const m = mappedFor(sec);
            const book = m ? books.find((b) => b.id === m[0]) : null;
            return (
              <div key={sec.start} className="lj-anth-row" style={{ paddingInlineStart: 8 + sec.level * 14 }}>
                <span className="lj-anth-title">{sec.title}</span>
                <span className="lj-series-bar" title={t('{pct}% of this section read', { pct: Math.round(sec.frac * 100) })}><i style={{ width: `${sec.frac * 100}%` }} /></span>
                <span className="lj-anth-pct">{Math.round(sec.frac * 100)}%</span>
                {m ? (
                  <span className="lj-grp-acts">
                    <span className="rh-link-chip on" title={book ? STATUS_LABEL[readStatus(book)] : ''}>🔗 {book?.title || m[0]}{book && readStatus(book) === 'finished' ? ' ✅' : ''}</span>
                    {book && <button onClick={() => onOpen(book.id)}>↗</button>}
                    <button title={t('Unlink this section')} onClick={() => onSecBind(anthCs, m[0], null)}>✕</button>
                  </span>
                ) : (
                  <span className="lj-grp-acts">
                    <button title={t('Create a tracker book named after this section and bind it')} onClick={() => newBookForSection(sec)}>＋ {t('Book')}</button>
                    <button title={t('Bind an existing tracker book to this section')} onClick={() => { setLinkFor(linkFor === sec.start ? null : sec.start); setQ(''); }}>🔗 {t('Link…')}</button>
                  </span>
                )}
                {linkFor === sec.start && (
                  <span className="lj-anth-pick">
                    <input autoFocus placeholder={t('Search your library…')} value={q} onChange={(e) => setQ(e.target.value)} />
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
  const cum = useMemo(() => cumulativeFinishes(withRereads(books)), [books]);
  const hm = useMemo(() => finishHeatmap(withRereads(books)), [books]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [monthPick, setMonthPick] = useState(null); // { y, m } — clicked heat tile → that month's finishes
  useEffect(() => { setIdx(cum.length); setPlaying(false); }, [cum.length]); // default to present
  useEffect(() => {
    if (!playing) return undefined;
    if (idx >= cum.length) { setPlaying(false); return undefined; }
    const tm = setInterval(() => setIdx((i) => Math.min(cum.length, i + 1)), 250);
    return () => clearInterval(tm);
  }, [playing, idx, cum.length]);

  if (cum.length === 0) return <p className="settings-note">{t('No dated finishes yet — add finish dates to your finished books to build the timeline.')}</p>;

  const pos = Math.min(cum.length, Math.max(1, idx));
  const shown = cum.slice(0, pos);
  const cur = cum[pos - 1];
  const W = 640, H = 150, pad = 6;
  const t0 = cum[0].t, span = Math.max(1, cum[cum.length - 1].t - t0), maxN = cum[cum.length - 1].n;
  const px = (tv) => pad + ((tv - t0) / span) * (W - 2 * pad);
  const py = (n) => H - pad - (n / maxN) * (H - 2 * pad);
  const path = shown.map((r, i) => `${i === 0 ? 'M' : 'L'}${px(r.t).toFixed(1)},${py(r.n).toFixed(1)}`).join(' ');
  const play = () => { if (idx >= cum.length) setIdx(0); setPlaying((p) => !p); };
  const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return (
    <div className="lj-timeline">
      <div className="rh-section-h">{t('Reading replay')}</div>
      <div className="lj-replay-card">
        <div className="lj-replay-now">
          <span className="lj-replay-count">{cur.n}</span>
          <span className="settings-note">{t('books finished by {date}', { date: cur.date })}</span>
          <div className="lj-replay-book"><b>{cur.title}</b><em>{cur.author} · {cur.genre}</em></div>
          <div className="settings-note">{t('{words}M words · {pages} pages cumulatively', { words: fmtNum(cur.words / 1e6, 2, 2), pages: fmtNum(cur.pages) })}</div>
        </div>
        <svg className="lj-growth" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path className="lj-growth-line" d={path} />
          <circle className="lj-growth-dot" cx={px(cur.t)} cy={py(cur.n)} r="4" />
        </svg>
      </div>
      <div className="lj-replay-ctl">
        <button onClick={play}>{playing ? `⏸ ${t('Pause')}` : (idx >= cum.length ? `↻ ${t('Replay')}` : `▶ ${t('Play')}`)}</button>
        <input type="range" min="1" max={cum.length} value={pos} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
        <span className="settings-note">{pos} / {cum.length}</span>
      </div>

      <div className="rh-section-h">{t('Finishes by month')}</div>
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
                  title={t('{month}: {n} finished — click to list them', { month: `${y}-${String(mi + 1).padStart(2, '0')}`, n: c })}
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
            <div className="lj-month-fins-head"><b>{key}</b> — {t.n('{n} finish', '{n} finishes', fins.length)} <button className="close-x" onClick={() => setMonthPick(null)}>×</button></div>
            {fins.length === 0 && <p className="settings-note">{t('Nothing finished this month.')}</p>}
            <ul className="lj-recent">
              {fins.map((r) => <li key={r.id}><b>{r.title}</b> — {r.author} <em>{r.date}</em></li>)}
            </ul>
          </div>
        );
      })()}
      <p className="settings-note">{t.n("{total} dated finishes across {n} year — click a tile to see that month's books.", "{total} dated finishes across {n} years — click a tile to see that month's books.", hm.years.length, { total: hm.total })}</p>
    </div>
  );
}

// One year's wrap-up card — Goodreads-style "Year in Books" superlatives, per selectable year.
function YearWrap({ books, years }) {
  const [year, setYear] = useState(years[years.length - 1]);
  const w = useMemo(() => yearInBooks(withRereads(books), year), [books, year]);
  if (!w) return null;
  return (
    <div className="lj-wrap">
      <div className="lj-wrap-head">
        <b>{t('Your {year} in books', { year })}</b>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
      </div>
      <div className="rh-stat-grid">
        <Stat v={w.books} l={t('finished')} sub={t('{fiction} fiction · {nonfiction} non-fiction', { fiction: w.fiction, nonfiction: w.nonfiction })} />
        <Stat v={w.pages ? fmtNum(w.pages) : '—'} l={t('pages')} sub={w.words ? t('{n}M words', { n: fmtNum(w.words / 1e6, 1, 1) }) : null} />
        <Stat v={w.topGenre ? w.topGenre[0] : '—'} l={t('top genre')} sub={w.topGenre ? t('{n} book(s)', { n: w.topGenre[1] }) : null} />
        <Stat v={w.topAuthor ? w.topAuthor[0] : '—'} l={t('top author')} sub={w.topAuthor ? t('{n} book(s)', { n: w.topAuthor[1] }) : null} />
        {w.avgRating != null && <Stat v={`★${w.avgRating}`} l={t('avg rating')} sub={w.avgDifficulty ? t('avg difficulty {n}', { n: w.avgDifficulty }) : null} />}
      </div>
      <div className="lj-wrap-superls">
        {w.longest && <span title={t('{n} pages', { n: w.longest.pages })}>📏 {t('Longest:')} <b>{w.longest.title}</b></span>}
        {w.hardest && <span title={t('Difficulty {n}', { n: w.hardest.difficultyLevel })}>🧗 {t('Hardest:')} <b>{w.hardest.title}</b></span>}
        {w.favorite && <span title={t('Rated {n}★', { n: bookRating(w.favorite) })}>❤️ {t('Favorite:')} <b>{w.favorite.title}</b></span>}
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
      <div className="rh-section-h">{t('Weekly summaries')}</div>
      <p className="settings-note">{t('Completed weeks (Mon–Sun), generated from your reading history. The AI / Cowork tab can “dress up” any week — dressed weeks show ✨.')}</p>
      <div className="lj-weeklies">
        {weeks.map((w) => {
          const d = dressed[w.week];
          return (
            <div key={w.week} className="lj-weekly">
              <div className="lj-weekly-head">
                <b>{w.start} → {w.end}</b>
                {w.words > 0 && <em>{t('{n} words', { n: fmtNum(w.words) })} · {t.n('{n} day', '{n} days', w.daysActive)}{w.wpm ? ` · ${t('{n} WPM', { n: w.wpm })}` : ''}</em>}
                {w.finished.length > 0 && <em>✅ {w.finished.length}</em>}
                {d && <span className="lj-weekly-ai" title={t("Written by the cowork AI from this week's numbers")}>✨ {t('AI')}</span>}
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
  const pace = useMemo(() => paceByYear(withRereads(books)), [books]);
  const gt = useMemo(() => genreTrend(books, 6), [books]);
  const rb = useMemo(() => recommenderBreakdown(books), [books]);
  if (pace.length === 0 && rb.length <= 1 && !dayAgg.length) return <p className="settings-note">{t('Not much to chart yet — mark some books finished (with dates) and attribute a few recommendations.')}</p>;
  const maxBooks = Math.max(1, ...pace.map((p) => p.books));
  const maxGT = Math.max(1, ...gt.rows.map((r) => r.total));
  const maxRec = Math.max(1, ...rb.map((r) => r.total));
  return (
    <div className="lj-analytics">
      <label className="inline-check" title={t('Break the numbers out by long-form vs short-form/articles vs AI-generated content (shared with the Dashboard toggle)')}>
        <input type="checkbox" checked={splitTypes} onChange={(e) => onSplitTypes?.(e.target.checked)} /> {t('Split by content type')}
      </label>
      {splitTypes && <TypeSplit books={books} />}
      <WeeklySummaries books={books} dayAgg={dayAgg} ai={ai} />
      {pace.length > 0 && <YearWrap books={books} years={pace.map((p) => p.year)} />}
      <div className="rh-section-h">{t('Pace by year')}</div>
      {pace.length === 0 ? <p className="settings-note">{t('No dated finishes.')}</p> : (
        <div className="lj-bars">
          {pace.map((p) => (
            <div key={p.year} className="lj-bar" title={`${t('{year}: {books} books · {pages} pages', { year: p.year, books: p.books, pages: fmtNum(p.pages) })}${p.avgDifficulty ? ` · ${t('avg difficulty {n}', { n: p.avgDifficulty })}` : ''}${p.avgRating ? ` · ${t('avg ★{n}', { n: p.avgRating })}` : ''}`}>
              <span className="lj-bar-fill" style={{ height: `${(p.books / maxBooks) * 100}%` }}><i>{p.books}</i></span>
              <em>{String(p.year).slice(2)}</em>
            </div>
          ))}
        </div>
      )}

      <div className="rh-section-h">{t('Genre mix over time')}</div>
      {gt.rows.length === 0 ? <p className="settings-note">{t('No dated finishes.')}</p> : (
        <>
          <div className="lj-stack">
            {gt.rows.map((r) => (
              <div key={r.year} className="lj-stack-col" title={t('{year}: {n} books', { year: r.year, n: r.total })}>
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

      <div className="rh-section-h">{t('Recommenders')}</div>
      <div className="lj-recgrid">
        {rb.map((r) => (
          <div key={r.name} className="lj-recrow">
            <span className="lj-rec-name"><b>{r.name}</b> <em>{t.n('{n} book', '{n} books', r.total)}</em></span>
            <span className="lj-rec-bar" style={{ width: `${(r.total / maxRec) * 100}%` }}>
              {[['finished', t('finished')], ['reading', t('reading')], ['queue', t('on deck')], ['toread', t('to read')], ['abandoned', t('abandoned')]].map(([k, kl]) => (r[k] ? <i key={k} className={`lj-seg lj-seg-${k}`} style={{ flex: r[k] }} title={`${r[k]} ${kl}`} /> : null))}
            </span>
            <span className="lj-rec-rate">{r.finishRate != null ? `${r.finishRate}%` : '—'}</span>
          </div>
        ))}
      </div>
      <p className="settings-note">{t('Bars are sized by pile; segments show finished/reading/on-deck/to-read/abandoned. Finish rate is over resolved (finished + abandoned). Unattributed seed picks count as “Claude”.')}</p>
    </div>
  );
}

// ── AI / Cowork view ─────────────────────────────────────────────────────────────────────────────
// The cowork files live in the reader's private cloud folder (features/coworkCloud.js), where the AI
// runner answers them; `dir` is that folder once the reader is signed in on this device.

function AiView({ books, ai, global, onPatchGlobal, bindMap = {}, onReload, onReloadAi = onReload }) {
  // Reading-progress bundle (daily/weekly totals, streak, in-flight books) attached to every export,
  // so cowork daily/weekly summary tasks have the data. Built fresh at call time from the file records.
  // The algorithmic weekly summaries ride along so a cowork task can return dressed-up `weeklies`.
  const datasetWithProgress = async (light, ops = []) => {
    const progress = buildProgress(await allFiles().catch(() => []), { books, bindMap, days: 63 });
    progress.weeklySummaries = weeklySummaries(progress.days, books, { weeks: 8 });
    const ds = buildDataset(books, { light, progress });
    ds.queues = queuesForDataset(await getLibraryRef('queues').catch(() => []), books); // for queue advice
    ds.vocabWords = (global?.vocabDeck || []).map((c) => c.word); // so vocabulary suggestions skip known words
    ds.requeueSkip = (ai?.requeueSkip || []).map(({ bookId, toQueueId }) => ({ bookId, toQueueId })); // re-queue pairs already declined
    if (ops.includes('cw-session-review')) ds.sessions = sessionsForReview(await allTypingRuns().catch(() => []), await getSpeechLog().catch(() => []), ai?.sessionReviews);
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
  // Everything the AI has written for you, in one sortable table.
  const outputs = useMemo(() => [
    ...Object.entries(ai?.briefs || {}).map(([date, b]) => ({ key: `b:${date}`, at: b.at || parseDay(date), date, kind: t('brief'), op: 'cw-brief', title: t('Morning brief {date}', { date }), text: b.text })),
    ...(ai?.reports || []).map((r, i) => ({ key: `r:${r.at}:${i}`, at: r.at, kind: t('report · {kind}', { kind: r.kind }), op: opForReport(r.kind), title: r.title || r.kind, text: r.text })),
    ...Object.entries(ai?.sessionReviews || {}).map(([id, r]) => ({ key: `sr:${id}`, at: r.at, kind: t('session review'), op: 'cw-session-review', title: t('{session} — AI grade {grade}', { session: sessionLabel(id), grade: r.grade }), text: reviewText(r) })),
    ...(ai?.answers || []).map((a, i) => ({ key: `a:${a.at}:${i}`, at: a.at, kind: t('answer'), op: 'cw-ask', title: a.question || t('Answer'), text: a.text })),
    ...(ai?.analysis ? [{ key: 'an:current', at: ai.updatedAt || 0, kind: t('analysis (current)'), op: 'cw-light', title: t('Dashboard analysis'), text: ai.analysis }] : []),
    ...(ai?.analysisHistory || []).map((h, i) => ({ key: `ah:${h.at}:${i}`, at: h.at, kind: t('analysis (archived)'), op: 'cw-light', title: t('Earlier analysis'), text: h.text, analysisIndex: i })),
  ], [ai]);
  // Subtasks in play — ticked, scheduled, or answered by the reply under review — each a chip that
  // narrows the page to that one operation: its row, its share of the reply, its outputs, its runs.
  const [task, setTask] = useState('all');
  const tasks = useMemo(() => {
    const live = new Set([...sel, ...Object.keys(schedules).filter((id) => schedules[id] && schedules[id] !== 'off'), ...(review?.ops || [])]);
    return SYNC_ACTION_GROUPS[0].actions.map((a) => a.id).filter((id) => COWORK_OPS[id] && live.has(id));
  }, [sel, schedules, review]);
  const focus = tasks.includes(task) ? task : 'all';
  const focusOp = focus === 'all' ? null : COWORK_OPS[focus];
  const inFocus = (ids) => focus === 'all' || (ids || []).includes(focus);
  const revRows = useMemo(() => (review ? review.rows.filter((r) => focus === 'all' || opForRow(r, review.ops) === focus) : []), [review, focus]);
  const outs = outputs.filter((o) => focus === 'all' || o.op === focus);
  const [opQ, setOpQ] = useState('');
  const [opGroup, setOpGroup] = useState('all');
  const coworkTarget = dir?.label || '';

  const loadDir = () => { cloudCoworkDir().then(setDir).catch(() => {}); };
  useEffect(loadDir, []);

  // Related-activity feed entries (kept for compatibility — the merged history displays them).
  const actEntry = (kind, text) => ({ at: Date.now(), kind, text });
  async function logActivity(kind, text) {
    await saveJourneyAi({ ...(ai || {}), activity: [...(ai?.activity || []), actEntry(kind, text)].slice(-40) });
    onReloadAi();
  }

  // AI-record-only changes re-read just that record (onReloadAi). The schedule dropdowns, question
  // and folder path used to trigger the whole dialog's reload — every book and file record — and a
  // dropdown sat on its old value until that finished.
  const persistAi = async (patch) => { await saveJourneyAi({ ...(ai || {}), ...patch }); onReloadAi(); };
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setSched = (id, v) => persistAi({ schedules: { ...schedules, [id]: v } });
  const designate = () => persistAi({ syncMachine: { deviceId, name: (global?.deviceName || '').trim() || deviceKind(), at: Date.now() } });
  const releaseRole = () => persistAi({ syncMachine: null });

  // Every reply — folder, paste or API — is filtered by the operations it was REQUESTED for
  // (coworkOps.sanitizeOutput: anything else is dropped, with the reason) and staged as review rows.
  async function stageReply(text, ops, source, extra = {}) {
    const hash = contentHash(text);
    if ((ai?.ledger || []).includes(hash) || await wasApplied(hash)) { setMsg(t('That reply was already applied.')); return; }
    const queues = (await getLibraryRef('queues').catch(() => null)) || [];
    const queuedIds = new Set(liveQueues(queues).flatMap((q) => q.ids || []));
    const [runs, speech] = await Promise.all([allTypingRuns().catch(() => []), getSpeechLog().catch(() => [])]);
    const { output, dropped } = sanitizeOutput(parseAiOutput(text), ops, { booksById, bindMap, queuedIds, queues, vocabWords: (global?.vocabDeck || []).map((c) => c.word), requeueSkip: ai?.requeueSkip || [], sessionIds: allSessionIds(runs, speech) });
    const files = Object.fromEntries((await allFiles().catch(() => [])).map((f) => [f.checksum, f]));
    const goals = (await getLibraryRef('goals').catch(() => null)) || {};
    const rows = planRows(output, { booksById, files, goals, queues, scores: appScores(runs, speech) }); // scores: the app's own, shown beside AI grades
    setReview({ rows, dropped, ops, source, hash, ...extra });
    setPicked(new Set(rows.slice(0, APPLY_CAP).map((r) => r.key))); // a huge reply goes in pages, never one click
    setMsg(rows.length
      ? (dropped.length
        ? t('Reply ready for review: {n} proposed change(s), {dropped} out-of-scope item(s) discarded. Nothing is written until you apply.', { n: rows.length, dropped: dropped.length })
        : t('Reply ready for review: {n} proposed change(s). Nothing is written until you apply.', { n: rows.length }))
      : (dropped.length
        ? t('Nothing in that reply is allowed by the requested operation(s) — {dropped} item(s) discarded.', { dropped: dropped.length })
        : t('Nothing in that reply is allowed by the requested operation(s).')));
  }
  async function applyReview() {
    if (!review) return;
    const rows = review.rows.filter((r) => picked.has(r.key));
    if (!rows.length) { setMsg(t('Nothing ticked.')); return; }
    if (rows.length > APPLY_CAP) { setMsg(t('At most {n} changes per apply — untick some, apply, then do the rest.', { n: APPLY_CAP })); return; }
    setBusy(true);
    try {
      const base = { ...(ai || {}), ledger: [...(ai?.ledger || []), review.hash].slice(-50) };
      markApplied(review.hash); // every device: never applied twice (applied.json in the cloud)
      const r = await commitRows(rows, { books, ai: base, ops: review.ops, source: review.source, global, patchGlobal: onPatchGlobal, reviewed: review.rows });
      const left = review.rows.filter((x) => !picked.has(x.key));
      // Rows not applied this time stay up for the next page (only for big replies split by the cap).
      if (left.length && review.rows.length > APPLY_CAP) {
        setReview({ ...review, rows: left, hash: `${review.hash}+${Date.now()}` });
        setPicked(new Set(left.slice(0, APPLY_CAP).map((x) => x.key)));
        setMsg(t('Applied: {summary}. {n} more change(s) still to review below.', { summary: r.summary, n: left.length }));
        onReload(); setBusy(false); return;
      }
      if (review.inboxFile) await moveInbox(dir, review.inboxFile).catch(() => {});
      setMsg(t('Applied: {summary}. ↶ Undo puts it all back.', { summary: r.summary }));
      setReview(null);
      refreshInbox();
      onReload();
    } catch (e) { setMsg(t('Apply failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }
  async function undoApply(at = null) {
    setBusy(true);
    try { const r = await undoLastApply(ai, at, { global, patchGlobal: onPatchGlobal }); setMsg(r.summary); onReload(); }
    catch (e) { setMsg(t('Undo failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }
  // Agent inbox (inbox/*.json): suggestions dropped without a request — same filter, same review.
  const [inbox, setInbox] = useState([]);
  const refreshInbox = () => { if (dir) listInbox(dir).then(setInbox).catch(() => {}); };
  useEffect(() => { refreshInbox(); }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  async function reviewInbox(name) {
    try {
      const json = JSON.parse(await readInbox(dir, name));
      const ops = (Array.isArray(json?.ops) ? json.ops : []).filter((id) => COWORK_OPS[id]);
      if (!ops.length) { await moveInbox(dir, name, 'rejected'); setMsg(t('{file}: no known operations declared ("ops") — moved to inbox/rejected/.', { file: name })); refreshInbox(); return; }
      const { ops: _o, ...reply } = json; // eslint-disable-line no-unused-vars
      await stageReply(JSON.stringify(reply), ops, `inbox: ${name}`, { inboxFile: name });
    } catch (e) {
      await moveInbox(dir, name, 'rejected').catch(() => {});
      setMsg(t("{file} couldn't be read ({error}) — moved to inbox/rejected/.", { file: name, error: e?.message || e })); refreshInbox();
    }
  }
  async function snapshotNow() {
    if (!dir) { setMsg(t('Sign in to your cloud first.')); return; }
    setBusy(true);
    try {
      const n = await writeSnapshot(dir);
      const cur = recordRun((await getJourneyAi().catch(() => null)) || ai || {}, ['cw-snapshot'], { at: Date.now(), kind: 'cowork', target: coworkTarget, ok: true, note: t('wrote snapshot ({n} files)', { n }) });
      await saveJourneyAi(cur); onReloadAi();
      setMsg(t('Snapshot written: {n} files in {folder}/snapshot/ (read-only for agents — see its README.md).', { n, folder: coworkTarget }));
    } catch (e) { setMsg(t('Snapshot failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }

  async function chooseFolder() {
    const d = await cloudCoworkDir({ ask: true });
    if (d) setDir(d); else setMsg(t('Cloud sign-in didn’t finish — try again.'));
  }

  // Run everything checked in the tree, in transport order: API first (its apply saves the ai
  // record), then re-read the record and fold in the cowork write + cloud syncs + run stamps.
  async function runSelected(only = null) { // only: an explicit id list (a focused subtask) instead of the ticked set
    const ids = (only || [...sel]).filter((id) => actionById(id));
    if (!ids.length) { setMsg(t('Nothing checked — tick at least one action in the tree.')); return; }
    setBusy(true); setMsg(t('Running selected actions…'));
    const now = Date.now();
    const parts = [];
    let apiTried = false; let apiOk = true; let apiNote = '';
    if (ids.includes('api-light')) {
      apiTried = true;
      if (!keyOk) { apiOk = false; apiNote = t('skipped — no Anthropic API key'); }
      else {
        try {
          const dataset = await datasetWithProgress(true); // API path is always the compact subset
          const instr = opsInstruction(['cw-light']);
          const { system, messages } = buildApiMessages(dataset, instr);
          const reply = await askClaude(messages, { key: global.anthropicKey, model, system, maxTokens: 2048, source: 'trackyread-ai' });
          await stageReply(reply, instr.ops, `API (${model})`);
          apiNote = t('ran — reply staged for review'); parts.push(t('API reply ready for review below'));
        } catch (e) { apiOk = false; apiNote = String(e?.message || e); parts.push(t('API failed')); }
      }
    }
    let cur = (await getJourneyAi().catch(() => null)) || ai || {};
    if (ids.includes('cw-snapshot') && dir) {
      try { const n = await writeSnapshot(dir); cur = recordRun(cur, ['cw-snapshot'], { at: now, kind: 'cowork', target: coworkTarget, ok: true, note: t('wrote snapshot ({n} files)', { n }) }); parts.push(t('snapshot written')); }
      catch (e) { cur = recordRun(cur, ['cw-snapshot'], { at: now, kind: 'cowork', target: coworkTarget, ok: false, note: String(e?.message || e) }); parts.push(t('snapshot failed')); }
    }
    const coworkIds = ids.filter((id) => COWORK_OPS[id]);
    if (coworkIds.length) {
      let ok = true; let note;
      if (!dir) { ok = false; note = t('not signed in to your cloud'); parts.push(t('cowork skipped (not signed in)')); }
      else {
        try {
          const ci = combineCoworkInstruction(coworkIds, { question });
          if (!ci) throw new Error(t('nothing to send — “Ask a question” needs a question'));
          const dataset = await datasetWithProgress(ci.mode === 'light', ci.ops);
          if (!ids.includes('cw-snapshot')) await writeSnapshot(dir); // the agent reads snapshot/ too
          const req = buildCoworkRequest(dataset, ci);
          await dir.write('journey-cowork-request.json', JSON.stringify(req, null, 2));
          await dir.write('journey-instructions.md', buildDigest(dataset, ci));
          cur = logRequest({ ...cur, instruction: { ...ci, updatedAt: now } }, { hash: req.requestHash, ops: ci.ops, at: now }); // replies are matched back to this
          note = t('wrote request ({mode})', { mode: ci.mode }); parts.push(t('cowork request written ({mode})', { mode: ci.mode }));
        } catch (e) { ok = false; note = String(e?.message || e); parts.push(t('cowork write failed')); }
      }
      cur = recordRun(cur, coworkIds, { at: now, kind: 'cowork', target: coworkTarget, ok, note });
    }
    for (const id of ids.filter((d) => d.startsWith('cloud-'))) {
      let ok = true; let note;
      const cfg = global?.sync || {};
      const p = getSyncProvider(cfg.provider);
      const target = p?.label || cfg.provider || t('no provider');
      try {
        if (!p || !p.supported()) { ok = false; note = t('no sync provider configured (Data → Cloud sync)'); }
        else if (id === 'cloud-progress') { const r = await syncWithProvider(cfg.provider, cfg); note = t('progress synced ({kb} KB)', { kb: Math.round((r.bytes || 0) / 1024) }); }
        else { const r = await syncLibraryWithProvider(cfg.provider, cfg); note = r.skipped ? t('library already in sync') : t('library synced ({n} books)', { n: r.books ?? '?' }); }
      } catch (e) { ok = false; note = String(e?.message || e); }
      parts.push(id === 'cloud-progress' ? t('progress: {note}', { note }) : t('library: {note}', { note }));
      cur = recordRun(cur, [id], { at: now, kind: 'cloud', target, ok, note });
    }
    if (apiTried) cur = recordRun(cur, ['api-light'], { at: now, kind: 'api', target: model, ok: apiOk, note: apiNote });
    await saveJourneyAi(cur);
    if (ids.some((d) => d.startsWith('cloud-'))) onReload(); else onReloadAi(); // only a cloud sync can change books
    setMsg(parts.length ? parts.join(' · ') : t('Done.'));
    setBusy(false);
  }

  async function readResponse() {
    if (!dir) return; setBusy(true); setMsg(t('Reading response…'));
    try {
      const txt = await dir.read('journey-cowork-response.json');
      if (!txt) { setMsg(t('No reply in your cloud yet ({file}).', { file: 'journey-cowork-response.json' })); }
      else {
        // Filtered by the operations of the request this reply answers (matched by its echoed
        // requestHash; otherwise every request from the last 3 days — still reviewed row by row).
        let parsed = null; try { parsed = parseAiOutput(txt); } catch { /* stageReply reports it */ }
        const m = opsForReply(parsed, ai);
        const how = m.how === 'matched' ? t('matched to your request of {when}', { when: fmtDateTime(m.at) })
          : m.how === 'recent' ? t('no request id in the reply — checked against your {n} request(s) from the last 3 days', { n: m.count })
            : t('checked against your last request');
        await stageReply(txt, m.ops, t('cloud · {how}', { how }));
        await saveJourneyAi({ ...((await getJourneyAi().catch(() => null)) || ai || {}), lastReplyAt: Date.now() }); onReloadAi(); // scheduler: request answered
      }
    } catch (e) { setMsg(t('Read failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }
  async function copyDigest() {
    try {
      const ci = combineCoworkInstruction([...sel], { question }) || opsInstruction(['cw-light']);
      await navigator.clipboard.writeText(buildDigest(await datasetWithProgress(ci.mode === 'light', ci.ops), ci));
      await logActivity('digest', t('Copied {mode} digest to clipboard', { mode: ci.mode }));
      setMsg(t('Digest copied — paste it into a Claude chat, then paste the JSON reply below.'));
    } catch { setMsg(t('Clipboard blocked — use the cowork folder instead.')); }
  }
  async function applyPasted() {
    setBusy(true);
    const ticked = [...sel].filter((id) => COWORK_OPS[id]);
    try {
      let parsed = null; try { parsed = parseAiOutput(pasted); } catch { /* stageReply reports it */ }
      await stageReply(pasted, ticked.length ? ticked : opsForReply(parsed, ai).ops, t('pasted reply')); setPasted('');
    }
    catch (e) { setMsg(t('Could not parse that reply: {error}', { error: e?.message || e })); }
    setBusy(false);
  }

  const targetOf = (g) => (g.kind === 'cowork' ? (coworkTarget || t('no folder chosen'))
    : g.kind === 'api' ? model
      : (getSyncProvider(global?.sync?.provider)?.label || global?.sync?.provider || t('no provider')));
  const focusHistory = focus === 'all' ? history : history.filter((h) => inFocus(h.ids));
  const filteredHistory = dayFilter ? focusHistory.filter((h) => dayKey(h.at) === dayFilter) : focusHistory;

  return (
    <div className="lj-ai">
      {/* Sync-machine role: once designated, only that device builds/runs — the rest watch. */}
      <div className={`cw-role cw-role-${role}`}>
        {role === 'machine' && (
          <><span>🖥 <b>{t('This device is the sync machine')}</b> — {t('requests and schedules run here; other devices are view-only.')}</span>
            <button onClick={releaseRole}>{t('Release role')}</button></>
        )}
        {role === 'viewer' && (
          <><span>👁 <b>{t('View-only.')}</b> {t('{device} is the sync machine (designated {when}). Status and history stay live via tracker sync.', { device: machine.name || t('Another device'), when: fmtDateTime(machine.at) })}</span>
            <button onClick={designate}>{t('Take over as sync machine')}</button></>
        )}
        {role === 'open' && (
          <><span>{t('No sync machine designated — every device currently has full sync controls.')}</span>
            <button onClick={designate}>🖥 {t('Make this device the sync machine')}</button>
            <span className="settings-note">{t('Typically the desktop; other devices then become view-only status monitors.')}</span></>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="lj-queue-pick cw-tasks" role="tablist" aria-label={t('Subtasks')}>
          <button role="tab" aria-selected={focus === 'all'} className={`lj-qcat${focus === 'all' ? ' on' : ''}`} onClick={() => { setTask('all'); setOpenExplain(null); }} title={t('Every operation, the whole reply and the full history')}>{t('All')}</button>
          {tasks.map((id) => {
            const op = COWORK_OPS[id];
            const n = review ? review.rows.filter((r) => opForRow(r, review.ops) === id).length : 0;
            const run = actionRuns[id];
            return (
              <button key={id} role="tab" aria-selected={focus === id} className={`lj-qcat${focus === id ? ' on' : ''}`} onClick={() => { setTask(id); setOpenExplain(id); }}
                title={run ? t('{op}: its request, its share of the reply, its outputs and runs · last run {ago}', { op: op.label, ago: fmtAgo(run.at) }) : t('{op}: its request, its share of the reply, its outputs and runs', { op: op.label })}>
                {op.icon} {op.label}{n ? ` · ${t('{n} to review', { n })}` : ''}
              </button>
            );
          })}
        </div>
      )}
      <div className="rh-section-h">{viewer ? t('Sync status (view-only)') : focusOp ? t('Request — {op}', { op: focusOp.label }) : t('Request builder')}</div>
      {!focusOp && (
        <div className="lj-inline cw-opfilter">
          <TextF value={opQ} onChange={setOpQ} label={t('operations (name or description)')} />
          <select value={opGroup} onChange={(e) => setOpGroup(e.target.value)} aria-label={t('Operation group')}>
            <option value="all">{t('All kinds')}</option><option value="snapshot">{t('Snapshot')}</option>{OP_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          {(opQ || opGroup !== 'all') && <button onClick={() => { setOpQ(''); setOpGroup('all'); }}>{t('Show all')}</button>}
        </div>
      )}
      {SYNC_ACTION_GROUPS.map((g) => {
        if (g.needsKey && !keyOk) return null; // no key → the whole group vanishes, no nagging note
        const opT = textMatcher(opQ).test;
        const shown = g.actions.filter((a) => {
          if (focusOp) return a.id === focus;
          const op = COWORK_OPS[a.id];
          return !((opT && !opT(`${a.label} ${a.desc || ''}`)) || (opGroup !== 'all' && g.id === 'cowork' && (op ? op.group : 'snapshot') !== opGroup));
        });
        if (!shown.length) return null;
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
              <span className="cwt-target" title={t("Where this group's actions land")}>→ {targetOf(g)}</span>
            </label>
            {shown.map((a, ai2) => {
              const run = actionRuns[a.id];
              const op = COWORK_OPS[a.id];
              const prevOp = COWORK_OPS[shown[ai2 - 1]?.id];
              const sub = op && op.group !== prevOp?.group ? OP_GROUPS.find((x) => x.id === op.group) : null;
              const ex = op ? op.explain : a.id === 'cw-snapshot' ? {
                sends: t("Nothing goes to an AI. Writes read-only files into the folder's snapshot/ subfolder: reading days, books, queues, goals, typing, reading aloud, narration quality, focus, an activity log and a README explaining every field."),
                changes: t('Nothing in Tachyread — the app never reads these files back. Files in snapshot/ are overwritten each time. No document text, audio or keys are written.'),
                review: t('Nothing to review. Also written automatically with every operation request.'),
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
                    title={run ? `${run.ok ? t('OK') : t('Failed')} — ${fmtDateTime(run.at)}${run.target ? ` → ${run.target}` : ''}${run.note ? ` · ${run.note}` : ''}` : t('Never run')}
                  >
                    {run ? `${run.ok ? '✓' : '⚠'} ${fmtAgo(run.at)}${run.auto ? ` · ${t('auto')}` : ''}` : `· ${t('never run')}`}
                  </span>
                  <select
                    className="cwt-sched" disabled={viewer} value={schedules[a.id] || 'off'}
                    title={t('Schedule this action — it then runs automatically on the sync machine')}
                    onChange={(e) => setSched(a.id, e.target.value)}
                  >
                    {SCHEDULE_OPTS.map((o) => <option key={o.id} value={o.id}>{o.id === 'off' ? `⏰ ${t('manual')}` : `⏰ ${o.label}`}</option>)}
                  </select>
                  {ex && <button type="button" className="cwt-explain-btn" aria-expanded={openExplain === a.id} onClick={() => setOpenExplain(openExplain === a.id ? null : a.id)} title={t('Exactly what this does and may change')}>{openExplain === a.id ? `▾ ${t('details')}` : `▸ ${t('details')}`}</button>}
                </div>
                {ex && openExplain === a.id && (
                  <div className="cwt-explain">
                    <div><b>{t('Sends / reads:')}</b> {ex.sends}</div>
                    <div><b>{t('May change:')}</b> {ex.changes}</div>
                    {op && <div><b>{t('Never changes:')}</b> {op.never || NEVER_CHANGED}</div>}
                    <div><b>{t('Review & undo:')}</b> {ex.review}</div>
                    {op && <div className="settings-note" style={{ margin: '2px 0 0' }}>{t('Enforced by the app, not left to the AI: when the reply comes back, anything outside this permission is discarded and listed.')}</div>}
                  </div>
                )}
                {a.id === 'cw-ask' && sel.has('cw-ask') && !viewer && (
                  <textarea className="lj-instr cwt-question" rows={2} placeholder={t('Your question — e.g. “Is my typing accuracy improving since I switched to word-backspace-only?”')}
                    value={question} onChange={(e) => setQuestion(e.target.value)} onBlur={() => persistAi({ question })} aria-label={t('Question for the agent')} />
                )}
                </Fragment>
              );
            })}
            {g.id === 'cowork' && (
              <div className="lj-inline cwt-foot">
                <button onClick={chooseFolder} disabled={viewer || !!dir} title={t('Requests, replies and snapshots go to your cloud’s private app folder, where your AI runner answers them — on any device.')}>{dir ? `☁ ${dir.label}` : `☁ ${t('Sign in to your cloud…')}`}</button>
              </div>
            )}
          </div>
        );
        return <Fragment key={g.id}>{groupEl}</Fragment>;
      })}
      {!viewer && (
        <div className="lj-inline">
          {focusOp
            ? <button className="toggle-on" disabled={busy} onClick={() => runSelected([focus])} title={t('Write a request for this one operation (the activity snapshot goes with it)')}>▶ {t('Run {op}', { op: focusOp.label })}</button>
            : null}
          {focus && COWORK_OPS[focus]?.group === 'report' && (
            <label className="inline-check" title={t('On: a scheduled reply for this operation waits in the review list below. Off: its report (analysis, read-next, briefs) is applied on its own, still logged and undoable.')}>
              <input type="checkbox" checked={reviewFirst(ai, [focus])} onChange={(e) => persistAi({ autoApply: { ...(ai?.autoApply || {}), [focus]: !e.target.checked } })} />
              {t('Review scheduled replies first')}
            </label>
          )}
          {focus === 'cw-requeue' && ai?.requeueSkip?.length > 0 && <button disabled={busy} onClick={() => persistAi({ requeueSkip: [] })} title={t('Reviewed re-queue suggestions are never made again — this clears that memory')}>{t.n('Forget {n} reviewed suggestion', 'Forget {n} reviewed suggestions', ai.requeueSkip.length)}</button>}
          {focusOp
            ? null
            : <button className="toggle-on" disabled={busy || sel.size === 0} onClick={() => runSelected()}>▶ {t('Run selected ({n})', { n: [...sel].filter((id) => actionById(id)).length })}</button>}
          {dir && <button disabled={busy} onClick={readResponse} title={t("Read the agent's reply — it is filtered and shown for review, never applied straight away")}>📥 {t('Read response')}</button>}
          {dir && <button disabled={busy} onClick={snapshotNow} title={t('Write the read-only activity snapshot now')}>📸 {t('Snapshot now')}</button>}
          <span className="settings-note">{t('Scheduled actions run automatically — on the sync machine only.')}</span>
        </div>
      )}

      {!viewer && dir && (
        <div className="lj-inline cw-inbox">
          <span className="settings-note" style={{ margin: 0 }} title={t("Agents can drop suggestion files into the folder's inbox/ at any time (format in inbox/README.md). Each is filtered by the operations it declares and reviewed here — nothing is applied automatically.")}>
            📬 {inbox.length ? t.n('Agent inbox: {n} suggestion file', 'Agent inbox: {n} suggestion files', inbox.length) : t('Agent inbox: empty')}
          </span>
          {inbox.slice(0, 5).map((n) => <button key={n} disabled={busy || !!review} onClick={() => reviewInbox(n)} title={t('Review {file}', { file: n })}>{t('Review {file}', { file: n })}</button>)}
          <button onClick={refreshInbox} title={t('Look in inbox/ again')}>⟳</button>
        </div>
      )}
      {!review && ai?.pendingReplies?.length > 0 && (
        <div className="settings-note" role="status">
          ⏳ {t.n('{n} scheduled reply is waiting for your review:', '{n} scheduled replies are waiting for your review:', ai.pendingReplies.length)}
          {ai.pendingReplies.map((p) => (
            <button key={p.hash} disabled={busy} style={{ marginInlineStart: 6 }} onClick={async () => { await stageReply(p.text, p.ops, `${p.source} · ${new Date(p.at).toLocaleString()}`); persistAi(unparkReply(ai, p.hash)); }}>
              {t('Review {ops} ({date})', { ops: p.ops.map((id) => COWORK_OPS[id]?.label || id).join(' + '), date: fmtDate(p.at) })}
            </button>
          ))}
        </div>
      )}
      {review && (
        <div className="cw-review">
          <div className="rh-section-h">{t('Review the reply — {source} · {ops}', { source: review.source, ops: (focusOp ? [focus] : review.ops).map((id) => COWORK_OPS[id]?.label || id).join(', ') })}</div>
          <p className="settings-note">{t('Nothing has been written yet. Untick anything you don’t want, then apply. Applied changes can be undone in one step.')}</p>
          {focusOp && !revRows.length && review.rows.length > 0 && <p className="settings-note">{t('Nothing in this reply for {op} — the other {n} change(s) are under their own subtasks (or All).', { op: focusOp.label, n: review.rows.length })}</p>}
          {revRows.length > 0 && (
            <DataTable stateKey="cw-review" rows={revRows} rowKey={(r) => r.key} maxRows={1000} className="cw-review-dt"
              lead={{ header: '', cell: (r) => <input type="checkbox" checked={picked.has(r.key)} aria-label={t('Apply: {change}', { change: r.label })} onChange={() => setPicked((s0) => { const s1 = new Set(s0); if (s1.has(r.key)) s1.delete(r.key); else s1.add(r.key); return s1; })} /> }}
              toolbar={(vis) => (<>
                <button onClick={() => setPicked((s0) => new Set([...s0, ...vis.map((r) => r.key)]))} title={t('Tick every row the filters show')}>{t('Tick shown ({n})', { n: vis.length })}</button>
                <button onClick={() => setPicked((s0) => { const s1 = new Set(s0); vis.forEach((r) => s1.delete(r.key)); return s1; })}>{t('Untick shown')}</button>
              </>)}
              columns={[
                { key: 'kind', label: t('Type'), type: 'select', get: (r) => r.kind, render: (r) => ROW_KIND[r.kind] || r.kind, options: [...new Set(revRows.map((r) => r.kind))].map((k) => [k, ROW_KIND[k] || k]) },
                { key: 'label', label: t('Change'), type: 'text', get: (r) => r.label },
                { key: 'from', label: t('Now'), type: 'text', get: (r) => (r.from == null || r.from === '' ? '—' : String(r.from)) },
                { key: 'to', label: t('Proposed'), type: 'text', get: (r) => String(r.to ?? '') },
              ]} />
          )}
          {review.dropped.length > 0 && (
            <details className="lj-fold" open={!review.rows.length}>
              <summary>{t('{n} item(s) in the reply were outside the requested operation(s) and were discarded', { n: review.dropped.length })}</summary>
              <DataTable stateKey="cw-dropped" rows={review.dropped.map((d, i) => ({ ...d, i }))} rowKey={(d) => d.i} maxRows={1000}
                columns={[
                  { key: 'what', label: t('Item'), type: 'text', get: (d) => d.what },
                  { key: 'why', label: t('Why it was discarded'), type: 'select', get: (d) => d.why, options: [...new Set(review.dropped.map((d) => d.why))].map((w) => [w, w]) },
                ]} />
            </details>
          )}
          <div className="lj-inline">
            <button className="toggle-on" disabled={busy || !picked.size || picked.size > APPLY_CAP} onClick={applyReview} title={picked.size > APPLY_CAP ? t('At most {n} per apply', { n: APPLY_CAP }) : undefined}>{focusOp ? t('Apply {n} ticked ({here} here)', { n: picked.size, here: revRows.filter((r) => picked.has(r.key)).length }) : t('Apply {n} ticked', { n: picked.size })}</button>
            {review.rows.length > APPLY_CAP && <span className="settings-note" style={{ margin: 0 }}>{t('{n} changes — applied in pages of up to {cap}', { n: review.rows.length, cap: APPLY_CAP })}</span>}
            <button onClick={() => setPicked((s0) => new Set([...s0, ...revRows.map((r) => r.key)]))}>{focusOp ? t('Tick all here') : t('Tick all')}</button>
            <button onClick={() => setPicked((s0) => { const s1 = new Set(s0); revRows.forEach((r) => s1.delete(r.key)); return s1; })}>{focusOp ? t('Untick all here') : t('Untick all')}</button>
            <button onClick={async () => { markApplied(review.hash); if (review.inboxFile) { await moveInbox(dir, review.inboxFile).catch(() => {}); refreshInbox(); } setReview(null); setMsg(t('Reply discarded — nothing was changed.')); }}>{t('Discard reply')}</button>
          </div>
        </div>
      )}
      {(ai?.lastApply || (ai?.applyLog || []).length > 0) && (
        <>
          <div className="rh-section-h">{t('Applied changes')}</div>
          {ai?.lastApply && !viewer && (
            <div className="lj-inline">
              <span className="settings-note" style={{ margin: 0 }}>{t('Last apply {when}: {summary}', { when: fmtDateTime(ai.lastApply.at), summary: ai.lastApply.summary })}</span>
              <button disabled={busy} onClick={() => undoApply()} title={t('Restore every book, link, note and AI field the last apply changed (books you edited since are left alone)')}>↶ {t('Undo last apply')}</button>
            </div>
          )}
          <details className="lj-fold">
            <summary>{focusOp ? t('Apply log ({n} — {op})', { n: (ai?.applyLog || []).filter((e) => inFocus(e.ops)).length, op: focusOp.label }) : t('Apply log ({n})', { n: (ai?.applyLog || []).filter((e) => inFocus(e.ops)).length })}</summary>
            <DataTable stateKey="cw-applylog" rows={(ai?.applyLog || []).map((e, i) => ({ ...e, i })).filter((e) => inFocus(e.ops))} rowKey={(e) => `${e.at}-${e.i}`}
              columns={[
                { key: 'at', label: t('When'), type: 'date', get: (e) => e.at, render: (e) => fmtDateTime(e.at) },
                { key: 'summary', label: t('What was applied'), type: 'text', get: (e) => e.summary },
                { key: 'source', label: t('Source'), type: 'text', get: (e) => e.source || '' },
                { key: 'auto', label: t('Auto'), type: 'select', get: (e) => (e.auto ? 'yes' : 'no'), options: [['yes', t('auto')], ['no', t('manual')]] },
                { key: 'undo', label: t('Undo'), type: 'select', get: (e) => ((ai?.undoStack || []).some((u) => u.at === e.at) ? 'available' : '—'), options: [['available', t('available')]],
                  render: (e) => (!viewer && (ai?.undoStack || []).some((u) => u.at === e.at) ? <button className="link-btn" disabled={busy} onClick={() => undoApply(e.at)} title={t('Undo this apply (books you or a later apply changed since are left alone)')}>↶ {t('undo')}</button> : '—') },
              ]} />
          </details>
        </>
      )}
      {outs.length > 0 && (
        <>
          <div className="rh-section-h">{focusOp ? t('Outputs — {op}', { op: focusOp.label }) : t('AI outputs — briefs, reports, answers, analyses')}</div>
          <DataTable stateKey="cw-outputs" rows={outs} rowKey={(o) => o.key}
            columns={[
              { key: 'at', label: t('When'), type: 'date', get: (o) => o.at, render: (o) => (o.date || fmtDateTime(o.at)) },
              { key: 'kind', label: t('Type'), type: 'select', get: (o) => o.kind, options: [...new Set(outs.map((o) => o.kind))].map((k) => [k, k]) },
              { key: 'text', label: t('Text (click to expand)'), type: 'text', get: (o) => `${o.title} ${o.text}`,
                render: (o) => (
                  <details className="cw-out">
                    <summary><b>{o.title}</b> <span className="lj-qdim">{String(o.text).slice(0, 110)}{String(o.text).length > 110 ? '…' : ''}</span></summary>
                    <p className="lj-analysis cw-brief">{o.text}</p>
                    {o.analysisIndex != null && !viewer && <button className="grab-trash" title={t('Delete this archived analysis')} onClick={async () => { await saveJourneyAi({ ...ai, analysisHistory: ai.analysisHistory.filter((_, j) => j !== o.analysisIndex) }); onReloadAi(); }}>🗑 {t('Delete')}</button>}
                  </details>
                ) },
            ]} />
        </>
      )}

      <div className="rh-section-h cw-hist-h">
        <span>{focusOp ? t('Sync history ({n} — {op})', { n: focusHistory.length, op: focusOp.label }) : t('Sync history ({n})', { n: focusHistory.length })}</span>
        <span className="cw-hist-toggle">
          <button className={histView === 'list' ? 'toggle-on' : ''} onClick={() => { setHistView('list'); setDayFilter(null); }}>☰ {t('List')}</button>
          <button className={histView === 'cal' ? 'toggle-on' : ''} onClick={() => setHistView('cal')}>📅 {t('Calendar')}</button>
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
            {calendarCells(calCursor.y, calCursor.m, focusHistory).map((c) => (
              <button
                key={c.key}
                className={`cwcal-cell${c.inMonth ? '' : ' out'}${c.count ? ' has' : ''}${c.errs ? ' err' : ''}${dayFilter === c.key ? ' sel' : ''}`}
                title={c.count ? (c.errs ? t('{n} run(s), {errs} failed — click to see them', { n: c.count, errs: c.errs }) : t('{n} run(s) — click to see them', { n: c.count })) : undefined}
                onClick={() => setDayFilter(dayFilter === c.key ? null : (c.count ? c.key : dayFilter))}
              >
                <span>{c.day}</span>{c.count > 0 && <em>{c.count}</em>}
              </button>
            ))}
          </div>
        </div>
      )}
      {(histView === 'list' || dayFilter) && (
        <DataTable stateKey="cw-history" rows={filteredHistory.map((h, i) => ({ ...h, i }))} rowKey={(h) => `${h.at}-${h.i}`} empty={dayFilter ? t('No sync runs yet on that day.') : t('No sync runs yet.')}
          columns={[
            { key: 'at', label: t('When'), type: 'date', get: (h) => h.at, render: (h) => fmtDateTime(h.at) },
            { key: 'kind', label: t('Kind'), type: 'select', get: (h) => h.kind, render: (h) => `${{ cowork: '🤝', api: '🤖', cloud: '☁️', request: '📤', apply: '✅', digest: '📋' }[h.kind] || '·'} ${h.kind}`, options: [...new Set(history.map((h) => h.kind))].map((k) => [k, k]) },
            { key: 'ids', label: t('Actions'), type: 'text', get: (h) => (h.ids?.length ? h.ids.map((id) => actionById(id)?.label || id).join(', ') : '') },
            { key: 'note', label: t('Note'), type: 'text', get: (h) => h.note || '' },
            { key: 'target', label: t('Target'), type: 'text', get: (h) => h.target || '' },
            { key: 'auto', label: t('Auto'), type: 'select', get: (h) => (h.auto ? 'yes' : 'no'), options: [['yes', t('auto')], ['no', t('manual')]] },
            { key: 'ok', label: t('Result'), type: 'select', get: (h) => (h.ok ? 'ok' : 'failed'), render: (h) => (h.ok ? '✓' : <span className="cw-herr">{t('failed')}</span>), options: [['ok', t('ok')], ['failed', t('failed')]] },
          ]} />
      )}

      {!viewer && (
        <details className="lj-fold">
          <summary>{t('Copy / paste (manual chat fallback)')}</summary>
          <div className="lj-inline"><button onClick={copyDigest}>{t('Copy digest to clipboard')}</button></div>
          <textarea className="lj-instr" rows={3} placeholder={t("Paste Claude's JSON reply here…")} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <div className="lj-inline"><button disabled={busy || !pasted.trim()} onClick={applyPasted}>{t('Review pasted reply')}</button><span className="settings-note" style={{ margin: 0 }}>{t('Filtered by the ticked operations (or the last request’s).')}</span></div>
        </details>
      )}

      {msg && <p className="settings-note lj-aimsg">{msg}</p>}
    </div>
  );
}
