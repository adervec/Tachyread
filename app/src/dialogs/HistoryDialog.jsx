import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { allFiles, allDocMeta, allFocusSessions, getBinding, getLibraryBooks } from '../state/storage.js';
import { MAX_REAL_WPM } from '../engine/readingTracker.js';

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function fmtInt(n) { return (Math.round(n) || 0).toLocaleString(); }
function fmtDur(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function dayKey(d) { return d.toISOString().slice(0, 10); }
function wpmOf(words, secs) { return secs > 0 ? Math.min(MAX_REAL_WPM, Math.round((words / secs) * 60)) : 0; }
// "pages 1–42 of 300" (PDF/grabbed images) or "sections …" (EPUB/HTML), from the source-page summary.
function sourcePageLabel(b) {
  const noun = b.sourceKind === 'epub' || b.sourceKind === 'html' ? 'section' : 'page';
  const reached = Math.min(b.sourcePages, (b.sourceMaxSeg || 0) + 1);
  return reached >= b.sourcePages
    ? `all ${b.sourcePages} ${noun}s`
    : `${noun}s 1–${reached} of ${b.sourcePages}`;
}

const SHELVES = [
  { id: 'reading', label: 'Reading', icon: '📖' },
  { id: 'finished', label: 'Finished', icon: '✅' },
  { id: 'toread', label: 'To read', icon: '🔖' },
  { id: 'paused', label: 'Paused', icon: '⏸' },
];
const SHELF_BY_ID = Object.fromEntries(SHELVES.map((s) => [s.id, s]));

// Infer a shelf from progress when the user hasn't set one explicitly.
function inferShelf(b) {
  if (b.completions > 0 || b.readFrac >= 0.99 || b.posFrac >= 0.999) return 'finished';
  if (b.posFrac > 0 || b.wordsRead > 0) return 'reading';
  return 'toread';
}

function streaks(dateSet) {
  let current = 0;
  const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  if (!dateSet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1); // today not read yet → count from yesterday
  while (dateSet.has(dayKey(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); }
  let longest = 0, run = 0, prev = null;
  for (const ds of [...dateSet].sort()) {
    if (prev) {
      const pd = new Date(prev); pd.setDate(pd.getDate() + 1);
      run = dayKey(pd) === ds ? run + 1 : 1;
    } else run = 1;
    longest = Math.max(longest, run);
    prev = ds;
  }
  return { current, longest };
}

function Stat({ v, l, sub }) {
  return (
    <div className="rh-stat">
      <span className="rh-stat-v">{v}</span>
      <span className="rh-stat-l">{l}</span>
      {sub && <span className="rh-stat-sub">{sub}</span>}
    </div>
  );
}

// Tiny sparkline of daily words for a single book.
function Spark({ daily }) {
  if (!daily || daily.length < 2) return <div className="rh-spark rh-spark-empty" />;
  const W = 240, H = 40;
  const max = Math.max(1, ...daily.map((d) => d.wordsRead || 0));
  const pts = daily.map((d, i) => `${i ? 'L' : 'M'} ${((i / (daily.length - 1)) * W).toFixed(1)} ${(H - ((d.wordsRead || 0) / max) * H).toFixed(1)}`).join(' ');
  return (
    <svg className="rh-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={pts} />
    </svg>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
// The full reading-history view — rendered standalone below AND embedded as Trackyread's Reading
// History tab (the history was folded into the tracker). `onOpenBook` / `onLinkFile` come from the
// Trackyread embed (jump to / link a book in the same panel); standalone falls back to opening the
// Trackyread dialog itself.
export function HistoryView({ onOpenBook, onLinkFile } = {}) {
  const { state, updateGlobal, openRecent, closeDialog, openDialog } = useApp();
  const [files, setFiles] = useState(null);
  const [nameMap, setNameMap] = useState({});
  const [linkMap, setLinkMap] = useState({}); // checksum → { id, title } of the linked Trackyread book
  const [focus, setFocus] = useState(null);
  const [tab, setTab] = useState('overview'); // overview | calendar | library (the "Files" table)
  const [selected, setSelected] = useState(null); // checksum of the book being inspected
  const [shelfFilter, setShelfFilter] = useState('all');
  const [fq, setFq] = useState(''); // Files table: File-column text filter
  const [linkFilter, setLinkFilter] = useState('all'); // all | linked | unlinked
  const [fsort, setFsort] = useState({ key: 'recent', dir: 1 }); // Files table header sort

  const openBook = onOpenBook || ((id) => openDialog({ kind: 'literary-journey', tab: 'library', focusBookId: id }));
  const linkFile = onLinkFile || ((cs, name) => openDialog({ kind: 'literary-journey', tab: 'library', linkChecksum: cs, linkFileName: name }));

  useEffect(() => {
    allFiles().then(setFiles).catch(() => setFiles([]));
    allDocMeta().then((m) => {
      const map = {};
      for (const r of m) if (r.checksum) map[r.checksum] = r.fileName;
      setNameMap(map);
    }).catch(() => {});
    allFocusSessions().then(setFocus).catch(() => setFocus([]));
    // Which files are linked to a Trackyread book (checksum → book title), so the history can show it.
    Promise.all([getBinding().catch(() => ({})), getLibraryBooks().catch(() => [])]).then(([bind, lib]) => {
      const byId = Object.fromEntries(lib.map((b) => [b.id, b]));
      const map = {};
      for (const [cs, id] of Object.entries(bind || {})) if (byId[id]) map[cs] = { id, title: byId[id].title || 'Tracked book' };
      setLinkMap(map);
    }).catch(() => {});
  }, []);

  const focusAgg = useMemo(() => {
    if (!focus || !focus.length) return null;
    let watched = 0;
    let away = 0;
    let distractions = 0;
    for (const s of focus) { watched += s.watchedMs || 0; away += s.awayMs || 0; distractions += s.distractions || 0; }
    const total = watched + away;
    return { sessions: focus.length, watchedSecs: Math.round(watched / 1000), focusPct: total > 0 ? (watched / total) * 100 : 0, distractions };
  }, [focus]);

  const shelves = state.global.readingList?.shelves || {};
  function setShelf(checksum, shelf) {
    const next = { ...shelves };
    if (shelf) next[checksum] = shelf; else delete next[checksum];
    updateGlobal({ readingList: { ...(state.global.readingList || {}), shelves: next } });
  }

  // Build the per-book model + daily aggregation once files load.
  const model = useMemo(() => {
    if (!files) return null;
    const recentName = {};
    for (const r of state.global.recentFiles || []) if (r.checksum) recentName[r.checksum] = r.name;
    const books = [];
    const byDay = new Map(); // date -> { words, secs }
    for (const f of files) {
      const checksum = f.checksum || f.contentChecksum;
      if (!checksum) continue;
      const daily = (f.dailyHistory || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      for (const e of daily) {
        const cur = byDay.get(e.date) || { words: 0, secs: 0 };
        cur.words += e.wordsRead || 0;
        cur.secs += e.activeTimeSecs || 0;
        byDay.set(e.date, cur);
      }
      const totalWords = f.totalWords || 0;
      const wordsRead = f.persistentWordsRead || 0;
      const activeSecs = f.persistentActiveTimeSecs || 0;
      const dDates = daily.filter((d) => (d.wordsRead || 0) > 0 || (d.activeTimeSecs || 0) > 0);
      const tocStats = f.tocReadStats || {};
      const tocVals = Object.values(tocStats);
      const b = {
        checksum,
        name: f.fileName || nameMap[checksum] || recentName[checksum] || `Book ${checksum.slice(0, 6)}`,
        posDevice: f.posDevice || '', // which device last moved the reading position
        totalWords,
        wordIndex: f.wordIndex || 0,
        wordsRead,
        activeSecs,
        rating: f.rating || 0,
        completions: (f.completions || []).length,
        daily,
        posFrac: totalWords ? Math.min(1, (f.wordIndex || 0) / totalWords) : 0,
        readFrac: totalWords ? Math.min(1, wordsRead / totalWords) : 0,
        avgWpm: wpmOf(wordsRead, activeSecs),
        daysRead: dDates.length,
        firstRead: dDates[0]?.date || null,
        lastRead: dDates.length ? dDates[dDates.length - 1].date : null,
        tocStarted: tocVals.filter((t) => t?.started).length,
        tocCompleted: tocVals.filter((t) => t?.completed).length,
        tocTotal: tocVals.length,
        // Source pages read (where the doc has a page/section source): total + furthest reached.
        sourcePages: f.sourcePages || 0,
        sourceKind: f.sourceKind || '',
        sourceMaxSeg: f.sourceMaxSeg || 0,
      };
      b.shelf = shelves[checksum] || inferShelf(b);
      b.shelfExplicit = !!shelves[checksum];
      books.push(b);
    }
    const dateSet = new Set(byDay.keys());
    const totalWordsRead = books.reduce((a, b) => a + b.wordsRead, 0);
    const totalSecs = books.reduce((a, b) => a + b.activeSecs, 0);
    const finished = books.filter((b) => b.shelf === 'finished');
    const withPace = books.filter((b) => b.avgWpm > 0 && b.wordsRead > 500);
    const bestDay = [...byDay.entries()].sort((a, b) => b[1].words - a[1].words)[0] || null;
    return {
      books,
      byDay,
      dateSet,
      streaks: streaks(dateSet),
      agg: {
        totalWordsRead,
        totalSecs,
        avgWpm: wpmOf(totalWordsRead, totalSecs),
        booksOpened: books.length,
        booksFinished: finished.length,
        daysRead: dateSet.size,
        fastest: withPace.sort((a, b) => b.avgWpm - a.avgWpm)[0] || null,
        mostRead: [...books].sort((a, b) => b.wordsRead - a.wordsRead)[0] || null,
        bestDay: bestDay ? { date: bestDay[0], words: bestDay[1].words } : null,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, nameMap, shelves, state.global.recentFiles]);

  const heatmap = useMemo(() => {
    if (!model) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    let max = 0;
    for (let i = 181; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = dayKey(d);
      const words = model.byDay.get(key)?.words || 0;
      if (words > max) max = words;
      days.push({ key, dow: d.getDay(), words });
    }
    const weeks = [];
    let col = new Array(days[0].dow).fill(null); // pad first week so rows align to weekday
    for (const day of days) {
      col.push(day);
      if (col.length === 7) { weeks.push(col); col = []; }
    }
    if (col.length) { while (col.length < 7) col.push(null); weeks.push(col); }
    const level = (w) => (w <= 0 ? 0 : max <= 0 ? 0 : Math.min(4, 1 + Math.floor((w / max) * 3.999)));
    return { weeks, level };
  }, [model]);

  const milestones = useMemo(() => {
    if (!model) return [];
    const { agg, streaks: st } = model;
    const hours = agg.totalSecs / 3600;
    const defs = [
      { label: '10k words', ok: agg.totalWordsRead >= 10000, icon: '📚' },
      { label: '100k words', ok: agg.totalWordsRead >= 100000, icon: '📚' },
      { label: '1M words', ok: agg.totalWordsRead >= 1000000, icon: '🏆' },
      { label: '1 hour read', ok: hours >= 1, icon: '⏱' },
      { label: '10 hours', ok: hours >= 10, icon: '⏱' },
      { label: '100 hours', ok: hours >= 100, icon: '🏆' },
      { label: 'First book', ok: agg.booksFinished >= 1, icon: '🎉' },
      { label: '5 books', ok: agg.booksFinished >= 5, icon: '🎉' },
      { label: '7-day streak', ok: st.longest >= 7, icon: '🔥' },
      { label: '30-day streak', ok: st.longest >= 30, icon: '🔥' },
    ];
    return defs;
  }, [model]);

  const libraryBooks = useMemo(() => {
    if (!model) return [];
    let list = model.books;
    if (shelfFilter !== 'all') list = list.filter((b) => b.shelf === shelfFilter);
    if (linkFilter !== 'all') list = list.filter((b) => !!linkMap[b.checksum] === (linkFilter === 'linked'));
    const q = fq.trim().toLowerCase();
    if (q) list = list.filter((b) => `${b.name} ${linkMap[b.checksum]?.title || ''}`.toLowerCase().includes(q));
    const cmp = {
      recent: (a, b) => (b.lastRead || '').localeCompare(a.lastRead || ''),
      progress: (a, b) => b.posFrac - a.posFrac,
      words: (a, b) => b.wordsRead - a.wordsRead,
      time: (a, b) => b.activeSecs - a.activeSecs,
      wpm: (a, b) => b.avgWpm - a.avgWpm,
      rating: (a, b) => b.rating - a.rating,
      title: (a, b) => a.name.localeCompare(b.name),
      link: (a, b) => (linkMap[b.checksum] ? 1 : 0) - (linkMap[a.checksum] ? 1 : 0),
      shelf: (a, b) => (a.shelf || '').localeCompare(b.shelf || ''),
    }[fsort.key] || (() => 0);
    const sorted = [...list].sort(cmp);
    return fsort.dir < 0 ? sorted.reverse() : sorted;
  }, [model, shelfFilter, linkFilter, fq, fsort, linkMap]);
  const fsortBy = (key) => setFsort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const fsortMark = (key) => (fsort.key === key ? (fsort.dir > 0 ? ' ▾' : ' ▴') : '');

  const selBook = useMemo(() => model?.books.find((b) => b.checksum === selected) || null, [model, selected]);

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'library', label: `Files${model ? ` (${model.books.length})` : ''}` },
  ];

  return (
    <div className="history-view">
      {!files && <p>Loading…</p>}
      {files && model && model.books.length === 0 && (
        <p className="settings-note">No reading recorded yet — open a document and start reading to build your history.</p>
      )}
      {model && model.books.length > 0 && (
        <>
          <div className="rh-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`rh-tab${tab === t.id ? ' on' : ''}`} onClick={() => { setTab(t.id); setSelected(null); }}>{t.label}</button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="rh-overview">
              <div className="rh-stat-grid">
                <Stat v={fmtInt(model.agg.totalWordsRead)} l="words read" />
                <Stat v={fmtDur(model.agg.totalSecs)} l="time reading" />
                <Stat v={model.agg.avgWpm} l="avg WPM" />
                <Stat v={model.agg.booksFinished} l="books finished" sub={`of ${model.agg.booksOpened} opened`} />
                <Stat v={`${model.streaks.current}🔥`} l="day streak" sub={`best ${model.streaks.longest}`} />
                <Stat v={model.agg.daysRead} l="days read" />
              </div>

              <div className="rh-section-h">Highlights</div>
              <div className="rh-highlights">
                {model.agg.fastest && <div className="rh-hl"><b>{model.agg.fastest.avgWpm} WPM</b><span>fastest: {model.agg.fastest.name}</span></div>}
                {model.agg.mostRead && <div className="rh-hl"><b>{fmtInt(model.agg.mostRead.wordsRead)}</b><span>most read: {model.agg.mostRead.name}</span></div>}
                {model.agg.bestDay && <div className="rh-hl"><b>{fmtInt(model.agg.bestDay.words)}</b><span>best day: {model.agg.bestDay.date}</span></div>}
              </div>

              <div className="rh-section-h">Milestones</div>
              <div className="rh-badges">
                {milestones.map((m) => (
                  <span key={m.label} className={`rh-badge${m.ok ? ' on' : ''}`} title={m.ok ? 'Unlocked' : 'Locked'}>
                    <span className="rh-badge-i">{m.icon}</span>{m.label}
                  </span>
                ))}
              </div>

              {focusAgg && (
                <>
                  <div className="rh-section-h">Focus &amp; attention</div>
                  <div className="rh-stat-grid">
                    <Stat v={`${focusAgg.focusPct.toFixed(0)}%`} l="focus" sub="eyes on the page" />
                    <Stat v={fmtInt(focusAgg.distractions)} l="distractions" />
                    <Stat v={fmtDur(focusAgg.watchedSecs)} l="watched" />
                    <Stat v={focusAgg.sessions} l="tracked sessions" />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'calendar' && heatmap && (
            <div className="rh-calendar">
              <div className="rh-cal-meta">
                <Stat v={`${model.streaks.current}🔥`} l="current streak" />
                <Stat v={model.streaks.longest} l="longest streak" />
                <Stat v={model.agg.daysRead} l="days read" />
              </div>
              <div className="rh-heatmap" role="img" aria-label="Reading activity over the last 26 weeks">
                {heatmap.weeks.map((week, wi) => (
                  <div key={wi} className="rh-hm-col">
                    {week.map((day, di) => (
                      <div
                        key={di}
                        className={`rh-hm-cell lvl-${day ? heatmap.level(day.words) : 0}`}
                        title={day ? `${day.key}: ${fmtInt(day.words)} words` : ''}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="rh-hm-legend"><span>Less</span><i className="lvl-0" /><i className="lvl-1" /><i className="lvl-2" /><i className="lvl-3" /><i className="lvl-4" /><span>More</span></div>

              <div className="rh-section-h">Recent days</div>
              <table className="history-table">
                <thead><tr><th>Date</th><th>Words</th><th>Active</th><th>WPM</th></tr></thead>
                <tbody>
                  {[...model.byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30).map(([date, d]) => (
                    <tr key={date}><td>{date}</td><td>{fmtInt(d.words)}</td><td>{fmtDur(d.secs)}</td><td>{wpmOf(d.words, d.secs)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'library' && !selBook && (
            <div className="rh-library">
              <div className="rh-lib-controls">
                <span className="settings-note" style={{ margin: 0 }}>{libraryBooks.length} file{libraryBooks.length === 1 ? '' : 's'} — filters live under each column header</span>
              </div>
              <div className="lj-tablewrap">
                <table className="lj-table rh-files-table">
                  <thead>
                    <tr>
                      {[['shelf', ''], ['title', 'File'], ['link', 'Trackyread'], ['progress', '%'], ['words', 'Words'], ['time', 'Time'], ['wpm', 'WPM'], ['rating', '★'], ['recent', 'Last read']].map(([k, l]) => (
                        <th key={k} className={fsort.key === k ? 'on' : ''} onClick={() => fsortBy(k)} title="Click to sort (click again to flip)">{l}{fsortMark(k)}</th>
                      ))}
                      <th aria-label="Actions" />
                    </tr>
                    <tr className="lj-filter-row">
                      <th>
                        <select value={shelfFilter} onChange={(e) => setShelfFilter(e.target.value)} title="Filter by shelf">
                          <option value="all">all</option>
                          {SHELVES.map((s) => <option key={s.id} value={s.id}>{s.icon}</option>)}
                        </select>
                      </th>
                      <th><input placeholder="filter…" value={fq} onChange={(e) => setFq(e.target.value)} /></th>
                      <th>
                        <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value)} title="Filter by Trackyread link">
                          <option value="all">all</option><option value="linked">🔗 linked</option><option value="unlinked">○ not</option>
                        </select>
                      </th>
                      <th colSpan={7} />
                    </tr>
                  </thead>
                  <tbody>
                    {libraryBooks.map((b) => (
                      <tr key={b.checksum} onClick={() => setSelected(b.checksum)} title="Open this file's reading detail">
                        <td><span className="rh-shelf-dot" title={SHELF_BY_ID[b.shelf]?.label}>{SHELF_BY_ID[b.shelf]?.icon}</span></td>
                        <td className="lj-td-title">
                          <b>{b.name}</b>
                          {b.sourcePages > 0 && <em title="Source pages reached in the original document"> 📄 {sourcePageLabel(b)}</em>}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {linkMap[b.checksum]
                            ? <button className="rh-link-chip on" title={`Open “${linkMap[b.checksum].title}” in the Trackyread library`} onClick={() => openBook(linkMap[b.checksum].id)}>🔗 {linkMap[b.checksum].title}</button>
                            : <button className="rh-link-chip" title="Link this file to a Trackyread book" onClick={() => linkFile(b.checksum, b.name)}>○ link…</button>}
                        </td>
                        <td>
                          <div className="rh-td-prog" title={`${Math.round(b.posFrac * 100)}% through`}>
                            <span>{Math.round(b.posFrac * 100)}%</span>
                            <div className="rh-progress"><div className="rh-progress-fill" style={{ width: `${b.posFrac * 100}%` }} /></div>
                          </div>
                        </td>
                        <td>{fmtInt(b.wordsRead)}</td>
                        <td>{fmtDur(b.activeSecs)}</td>
                        <td>{b.avgWpm || ''}</td>
                        <td>{b.rating > 0 ? '★'.repeat(b.rating) : ''}</td>
                        <td>{b.lastRead || '—'}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            className="rh-open-file"
                            title="Open this document in the reader — uses the copy saved on this device (or focuses it if it's already open)"
                            onClick={async () => { if (await openRecent(b.checksum)) closeDialog?.(); }}
                          >▶</button>
                        </td>
                      </tr>
                    ))}
                    {libraryBooks.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 12 }}>No files match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'library' && selBook && (
            <div className="rh-detail">
              <button className="rh-back" onClick={() => setSelected(null)}>← Files</button>
              <h3 className="rh-detail-title">
                {selBook.name}
                <button
                  className="rh-open-file"
                  title="Open this document in the reader — uses the copy saved on this device (or focuses it if it's already open)"
                  onClick={async () => { if (await openRecent(selBook.checksum)) closeDialog?.(); }}
                >▶ Open file</button>
              </h3>
              <p className="rh-detail-link">
                {linkMap[selBook.checksum]
                  ? <span className="rh-link-chip on" title="This file is linked to a book in your Trackyread tracker">🔗 Linked to Trackyread: <b>{linkMap[selBook.checksum].title}</b></span>
                  : <span className="rh-link-chip" title="Link this file from the Trackyread Library (open a book → Linked document)">○ Not linked to Trackyread</span>}
              </p>

              <div className="rh-shelf-pick">
                {SHELVES.map((s) => (
                  <button key={s.id} className={`rh-shelf-btn${selBook.shelf === s.id ? ' on' : ''}`} onClick={() => setShelf(selBook.checksum, s.id)}>
                    {s.icon} {s.label}
                  </button>
                ))}
                {selBook.shelfExplicit && <button className="rh-shelf-btn rh-shelf-auto" onClick={() => setShelf(selBook.checksum, null)} title="Use the shelf inferred from progress">↺ Auto</button>}
              </div>

              <div className="rh-stat-grid">
                <Stat v={`${Math.round(selBook.posFrac * 100)}%`} l="position" sub={`${fmtInt(selBook.wordIndex)} / ${fmtInt(selBook.totalWords)}`} />
                <Stat v={`${Math.round(selBook.readFrac * 100)}%`} l="actually read" sub={`${fmtInt(selBook.wordsRead)} words`} />
                <Stat v={fmtDur(selBook.activeSecs)} l="time" />
                <Stat v={selBook.avgWpm} l="avg WPM" />
                <Stat v={selBook.daysRead} l="days read" />
                <Stat v={selBook.completions} l="times finished" />
              </div>

              <div className="rh-detail-2col">
                <div>
                  <div className="rh-section-h">Daily words</div>
                  <Spark daily={selBook.daily} />
                  <div className="rh-detail-meta">
                    {selBook.firstRead && <span>First: {selBook.firstRead}</span>}
                    {selBook.lastRead && <span>Last: {selBook.lastRead}</span>}
                    {selBook.rating > 0 && <span>Rating: {'★'.repeat(selBook.rating)}</span>}
                  </div>
                </div>
                <div>
                  <div className="rh-section-h">Chapters</div>
                  {selBook.tocTotal > 0 ? (
                    <p className="rh-toc-prog">{selBook.tocCompleted} completed · {selBook.tocStarted} started · of {selBook.tocTotal} tracked sections</p>
                  ) : (
                    <p className="settings-note">No chapter-level reading recorded for this book yet.</p>
                  )}
                </div>
              </div>

              <div className="rh-section-h">Sessions</div>
              <table className="history-table">
                <thead><tr><th>Date</th><th>Words</th><th>Active</th><th>WPM</th></tr></thead>
                <tbody>
                  {selBook.daily.slice().reverse().slice(0, 40).map((d) => (
                    <tr key={d.date}><td>{d.date}</td><td>{fmtInt(d.wordsRead)}</td><td>{fmtDur(d.activeTimeSecs)}</td><td>{wpmOf(d.wordsRead, d.activeTimeSecs)}</td></tr>
                  ))}
                  {selBook.daily.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 10 }}>No dated sessions recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HistoryDialog({ onClose }) {
  return (
    <Dialog title="Reading History" onClose={onClose} width={840} buttons={<button onClick={onClose}>Close</button>}>
      <HistoryView />
    </Dialog>
  );
}
