import { useEffect, useMemo, useState } from 'react';
import { useSessionState } from '../state/useSessionState.js';
import { textMatcher, inRange, inDates, anySet } from '../features/tableFilter.js';
import { TextF, RangeF, DateF } from '../components/ColFilter.jsx';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { allFiles, allDocMeta, allFocusSessions, getBinding, setBinding, getLibraryBooks } from '../state/storage.js';
import { fmtDate } from '../features/dateFmt.js';
import { MAX_REAL_WPM } from '../engine/readingTracker.js';
import { t, fmtNum } from '../i18n.js';

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function fmtInt(n) { return fmtNum(Math.round(n) || 0); }
function fmtDur(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return t('{h}h {m}m', { h, m });
  if (m) return t('{m}m {s}s', { m, s: s % 60 });
  return t('{s}s', { s });
}
// LOCAL day key — the streak cursor anchors on local midnight, so the key must be local too, or the
// streak drops "today" for anyone off UTC (the confirmed bug).
function dayKey(d) { return fmtDate(d); }
function wpmOf(words, secs) { return secs > 0 ? Math.min(MAX_REAL_WPM, Math.round((words / secs) * 60)) : 0; }
// "pages 1–42 of 300" (PDF/grabbed images) or "sections …" (EPUB/HTML), from the source-page summary.
function sourcePageLabel(b) {
  const sections = b.sourceKind === 'epub' || b.sourceKind === 'html';
  const reached = Math.min(b.sourcePages, (b.sourceMaxSeg || 0) + 1);
  const total = b.sourcePages;
  if (reached >= total) return sections ? t.n('all {n} section', 'all {n} sections', total) : t.n('all {n} page', 'all {n} pages', total);
  return sections ? t('sections 1–{reached} of {total}', { reached, total }) : t('pages 1–{reached} of {total}', { reached, total });
}

const SHELVES = [
  { id: 'reading', label: t('Reading'), icon: '📖' },
  { id: 'finished', label: t('Finished'), icon: '✅' },
  { id: 'toread', label: t('To read'), icon: '🔖' },
  { id: 'paused', label: t('Paused'), icon: '⏸' },
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
  const [shelfFilter, setShelfFilter] = useState(() => new Set()); // shelf ids to show; empty = every shelf
  // Files table column filters: regex on text, min/max on numbers, from/to on dates.
  const NO_FF = { file: '', link: '', pct: ['', ''], words: ['', ''], time: ['', ''], wpm: ['', ''], rating: ['', ''], last: ['', ''] };
  const [ff, setFf] = useSessionState('tr-files-ff', NO_FF);
  const setF = (k) => (v) => setFf((f) => ({ ...f, [k]: v }));
  // Rows drawn at once — hundreds of rows made the panel stutter; filter, or show more.
  const [fLimit, setFLimit] = useState(200);
  const [linkFilter, setLinkFilter] = useSessionState('tr-files-link', 'all'); // all | linked | unlinked
  const [fsort, setFsort] = useSessionState('tr-files-sort', { key: 'recent', dir: 1 }); // Files table header sort

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
      for (const [cs, id] of Object.entries(bind || {})) if (byId[id]) map[cs] = { id, title: byId[id].title || t('Tracked book') };
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

  // Cut a file loose from its tracker book. Reversible in one click (the chip turns back into
  // "○ link…"), so it just does it — and setBinding tells the rest of the app the link is gone.
  async function unlink(checksum) {
    await setBinding(checksum, null);
    setLinkMap((m) => { const next = { ...m }; delete next[checksum]; return next; });
  }
  const toggleShelf = (id) => setShelfFilter((f) => {
    const next = new Set(f);
    if (!next.delete(id)) next.add(id);
    return next;
  });

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
        const cur = byDay.get(e.date) || { words: 0, secs: 0, books: [] };
        cur.words += e.wordsRead || 0;
        cur.secs += e.activeTimeSecs || 0;
        if (e.wordsRead || e.activeTimeSecs) cur.books.push({ checksum, name: recentName[checksum] || f.fileName || f.name || t('Untitled'), words: e.wordsRead || 0, secs: e.activeTimeSecs || 0 });
        byDay.set(e.date, cur);
      }
      const totalWords = f.totalWords || 0;
      const wordsRead = f.persistentWordsRead || 0;
      // WPM divides only words actually read here (not sections ticked as read elsewhere). Older
      // records without the field fall back to coverage.
      const pacedWords = f.persistentPacedWords ?? wordsRead;
      const activeSecs = f.persistentActiveTimeSecs || 0;
      const dDates = daily.filter((d) => (d.wordsRead || 0) > 0 || (d.activeTimeSecs || 0) > 0);
      const tocStats = f.tocReadStats || {};
      const tocVals = Object.values(tocStats);
      const b = {
        checksum,
        name: f.fileName || nameMap[checksum] || recentName[checksum] || t('Book {id}', { id: checksum.slice(0, 6) }),
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
        pacedWords,
        avgWpm: wpmOf(pacedWords, activeSecs),
        daysRead: dDates.length,
        firstRead: dDates[0]?.date || null,
        lastRead: dDates.length ? dDates[dDates.length - 1].date : null,
        tocStarted: tocVals.filter((ts) => ts?.started).length,
        tocCompleted: tocVals.filter((ts) => ts?.completed).length,
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
    const totalPaced = books.reduce((a, b) => a + b.pacedWords, 0);
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
        avgWpm: wpmOf(totalPaced, totalSecs),
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

  const [calDay, setCalDay] = useState(null); // calendar day whose books are listed
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
      { label: t('10k words'), ok: agg.totalWordsRead >= 10000, icon: '📚' },
      { label: t('100k words'), ok: agg.totalWordsRead >= 100000, icon: '📚' },
      { label: t('1M words'), ok: agg.totalWordsRead >= 1000000, icon: '🏆' },
      { label: t('1 hour read'), ok: hours >= 1, icon: '⏱' },
      { label: t('10 hours'), ok: hours >= 10, icon: '⏱' },
      { label: t('100 hours'), ok: hours >= 100, icon: '🏆' },
      { label: t('First book'), ok: agg.booksFinished >= 1, icon: '🎉' },
      { label: t('5 books'), ok: agg.booksFinished >= 5, icon: '🎉' },
      { label: t('7-day streak'), ok: st.longest >= 7, icon: '🔥' },
      { label: t('30-day streak'), ok: st.longest >= 30, icon: '🔥' },
    ];
    return defs;
  }, [model]);

  const libraryBooks = useMemo(() => {
    if (!model) return [];
    let list = model.books;
    if (shelfFilter.size) list = list.filter((b) => shelfFilter.has(b.shelf));
    if (linkFilter !== 'all') list = list.filter((b) => !!linkMap[b.checksum] === (linkFilter === 'linked'));
    const fileT = textMatcher(ff.file).test, linkT = textMatcher(ff.link).test;
    list = list.filter((b) => (!fileT || fileT(b.name)) && (!linkT || linkT(linkMap[b.checksum]?.title || ''))
      && inRange(b.posFrac * 100, ...ff.pct) && inRange(b.wordsRead, ...ff.words, 1000) && inRange(b.activeSecs / 3600, ...ff.time)
      && inRange(b.avgWpm, ...ff.wpm) && inRange(b.rating, ...ff.rating) && inDates(b.lastRead, ...ff.last));
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
  }, [model, shelfFilter, linkFilter, ff, fsort, linkMap]);
  const fsortBy = (key) => setFsort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const fsortMark = (key) => (fsort.key === key ? (fsort.dir > 0 ? ' ▾' : ' ▴') : '');

  const selBook = useMemo(() => model?.books.find((b) => b.checksum === selected) || null, [model, selected]);

  const TABS = [
    { id: 'overview', label: t('Overview') },
    { id: 'calendar', label: t('Calendar') },
    { id: 'library', label: model ? t('Files ({n})', { n: model.books.length }) : t('Files') },
  ];

  return (
    <div className="history-view">
      {!files && <p>{t('Loading…')}</p>}
      {files && model && model.books.length === 0 && (
        <p className="settings-note">{t('No reading recorded yet — open a document and start reading to build your history.')}</p>
      )}
      {model && model.books.length > 0 && (
        <>
          <div className="rh-tabs">
            {TABS.map((tb) => (
              <button key={tb.id} className={`rh-tab${tab === tb.id ? ' on' : ''}`} onClick={() => { setTab(tb.id); setSelected(null); }}>{tb.label}</button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="rh-overview">
              <div className="rh-stat-grid">
                <Stat v={fmtInt(model.agg.totalWordsRead)} l={t('words read')} />
                <Stat v={fmtDur(model.agg.totalSecs)} l={t('time reading')} />
                <Stat v={model.agg.avgWpm} l={t('avg WPM')} />
                <Stat v={model.agg.booksFinished} l={t('books finished')} sub={t('of {n} opened', { n: model.agg.booksOpened })} />
                <Stat v={`${model.streaks.current}🔥`} l={t('day streak')} sub={t('best {n}', { n: model.streaks.longest })} />
                <Stat v={model.agg.daysRead} l={t('days read')} />
              </div>

              <div className="rh-section-h">{t('Highlights')}</div>
              <div className="rh-highlights">
                {model.agg.fastest && <div className="rh-hl"><b>{model.agg.fastest.avgWpm} WPM</b><span>{t('fastest: {name}', { name: model.agg.fastest.name })}</span></div>}
                {model.agg.mostRead && <div className="rh-hl"><b>{fmtInt(model.agg.mostRead.wordsRead)}</b><span>{t('most read: {name}', { name: model.agg.mostRead.name })}</span></div>}
                {model.agg.bestDay && <div className="rh-hl"><b>{fmtInt(model.agg.bestDay.words)}</b><span>{t('best day: {date}', { date: model.agg.bestDay.date })}</span></div>}
              </div>

              <div className="rh-section-h">{t('Milestones')}</div>
              <div className="rh-badges">
                {milestones.map((m) => (
                  <span key={m.label} className={`rh-badge${m.ok ? ' on' : ''}`} title={m.ok ? t('Unlocked') : t('Locked')}>
                    <span className="rh-badge-i">{m.icon}</span>{m.label}
                  </span>
                ))}
              </div>

              {focusAgg && (
                <>
                  <div className="rh-section-h">{t('Focus & attention')}</div>
                  <div className="rh-stat-grid">
                    <Stat v={`${fmtNum(focusAgg.focusPct, 0, 0)}%`} l={t('focus')} sub={t('eyes on the page')} />
                    <Stat v={fmtInt(focusAgg.distractions)} l={t('distractions')} />
                    <Stat v={fmtDur(focusAgg.watchedSecs)} l={t('watched')} />
                    <Stat v={focusAgg.sessions} l={t('tracked sessions')} />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'calendar' && heatmap && (
            <div className="rh-calendar">
              <div className="rh-cal-meta">
                <Stat v={`${model.streaks.current}🔥`} l={t('current streak')} />
                <Stat v={model.streaks.longest} l={t('longest streak')} />
                <Stat v={model.agg.daysRead} l={t('days read')} />
              </div>
              <div className="rh-heatmap" role="img" aria-label={t('Reading activity over the last 26 weeks')}>
                {heatmap.weeks.map((week, wi) => (
                  <div key={wi} className="rh-hm-col">
                    {week.map((day, di) => (
                      <button
                        type="button"
                        key={di}
                        disabled={!day}
                        className={`rh-hm-cell lvl-${day ? heatmap.level(day.words) : 0}${day && calDay === day.key ? ' sel' : ''}`}
                        title={day ? t('{date}: {words} words — click for the books', { date: day.key, words: fmtInt(day.words) }) : ''}
                        aria-label={day ? t('{date}: {words} words', { date: day.key, words: fmtInt(day.words) }) : undefined}
                        onClick={() => day && setCalDay(calDay === day.key ? null : day.key)}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="rh-hm-legend"><span>{t('Less')}</span><i className="lvl-0" /><i className="lvl-1" /><i className="lvl-2" /><i className="lvl-3" /><i className="lvl-4" /><span>{t('More')}</span></div>

              {calDay && (
                <>
                  <div className="rh-section-h">{t('{date} — what you read', { date: calDay })} <button className="link-btn" onClick={() => setCalDay(null)}>✕</button></div>
                  {(model.byDay.get(calDay)?.books || []).length ? (
                    <table className="history-table">
                      <thead><tr><th>{t('Book')}</th><th>{t('Words')}</th><th>{t('Active')}</th><th>WPM</th></tr></thead>
                      <tbody>
                        {[...model.byDay.get(calDay).books].sort((a, b) => b.secs - a.secs || b.words - a.words).map((bk) => (
                          <tr key={bk.checksum}><td>{bk.name}</td><td>{fmtInt(bk.words)}</td><td>{fmtDur(bk.secs)}</td><td>{wpmOf(bk.words, bk.secs)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="settings-note">{t('No reading recorded that day.')}</p>}
                </>
              )}
              <div className="rh-section-h">{t('Recent days')}</div>
              <table className="history-table">
                <thead><tr><th>{t('Date')}</th><th>{t('Words')}</th><th>{t('Active')}</th><th>WPM</th></tr></thead>
                <tbody>
                  {[...model.byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30).map(([date, d]) => (
                    <tr key={date} className={calDay === date ? 'sel' : ''}><td><button className="link-btn" onClick={() => setCalDay(calDay === date ? null : date)} title={t('Show the books read that day')}>{date}</button></td><td>{fmtInt(d.words)}</td><td>{fmtDur(d.secs)}</td><td>{wpmOf(d.words, d.secs)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'library' && !selBook && (
            <div className="rh-library">
              <div className="rh-lib-controls">
                <span className="settings-note" style={{ margin: 0 }}>{t.n('{n} of {total} file — every column has a filter under its header (text: regex · numbers: min/max · dates: from/to)', '{n} of {total} files — every column has a filter under its header (text: regex · numbers: min/max · dates: from/to)', libraryBooks.length, { total: model?.books.length || 0 })}</span>
                {(anySet(ff) || shelfFilter.size > 0 || linkFilter !== 'all') && <button onClick={() => { setFf(NO_FF); setShelfFilter(new Set()); setLinkFilter('all'); }}>{t('Clear filters')}</button>}
              </div>
              <div className="lj-tablewrap">
                <table className="lj-table rh-files-table">
                  <thead>
                    <tr>
                      {[['shelf', ''], ['title', t('File')], ['link', 'Trackyread'], ['progress', '%'], ['words', t('Words')], ['time', t('Time')], ['wpm', 'WPM'], ['rating', '★'], ['recent', t('Last read')]].map(([k, l]) => (
                        <th key={k} className={fsort.key === k ? 'on' : ''} onClick={() => fsortBy(k)} title={t('Click to sort (click again to flip)')}>{l}{fsortMark(k)}</th>
                      ))}
                      <th aria-label={t('Actions')} />
                    </tr>
                    <tr className="lj-filter-row">
                      <th>
                        <span className="rh-shelf-filter" title={t('Filter by shelf — tick as many as you like; none ticked shows every shelf')}>
                          {SHELVES.map((s) => (
                            <button
                              key={s.id} type="button" aria-pressed={shelfFilter.has(s.id)}
                              className={shelfFilter.has(s.id) ? 'on' : ''}
                              title={shelfFilter.has(s.id) ? t('{shelf} — showing, click to drop', { shelf: s.label }) : t('{shelf} — click to add to the filter', { shelf: s.label })}
                              onClick={() => toggleShelf(s.id)}
                            >{s.icon}</button>
                          ))}
                        </span>
                      </th>
                      <th><TextF value={ff.file} onChange={setF('file')} label={t('file name')} /></th>
                      <th>
                        <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value)} title={t('Filter by Trackyread link')}>
                          <option value="all">{t('all')}</option><option value="linked">🔗 {t('linked')}</option><option value="unlinked">○ {t('not')}</option>
                        </select>
                        <TextF value={ff.link} onChange={setF('link')} label={t('linked book title')} />
                      </th>
                      <th><RangeF value={ff.pct} onChange={setF('pct')} label={t('% through')} /></th>
                      <th><RangeF value={ff.words} onChange={setF('words')} label={t('words read')} unit="k" /></th>
                      <th><RangeF value={ff.time} onChange={setF('time')} label={t('active time')} unit="h" /></th>
                      <th><RangeF value={ff.wpm} onChange={setF('wpm')} label="WPM" /></th>
                      <th><RangeF value={ff.rating} onChange={setF('rating')} label={t('rating')} /></th>
                      <th><DateF value={ff.last} onChange={setF('last')} label={t('Last read')} /></th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {libraryBooks.slice(0, fLimit).map((b) => (
                      <tr key={b.checksum} onClick={() => setSelected(b.checksum)} title={t("Open this file's reading detail")}>
                        <td><span className="rh-shelf-dot" title={SHELF_BY_ID[b.shelf]?.label}>{SHELF_BY_ID[b.shelf]?.icon}</span></td>
                        <td className="lj-td-title">
                          <b>{b.name}</b>
                          {b.sourcePages > 0 && <em title={t('Source pages reached in the original document')}> 📄 {sourcePageLabel(b)}</em>}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {linkMap[b.checksum]
                            ? (
                              <span className="rh-link-cell">
                                <button className="rh-link-chip on" title={t('Open “{title}” in the Trackyread library', { title: linkMap[b.checksum].title })} onClick={() => openBook(linkMap[b.checksum].id)}>🔗 {linkMap[b.checksum].title}</button>
                                <button className="rh-unlink" aria-label={t('Unlink {file} from {title}', { file: b.name, title: linkMap[b.checksum].title })} title={t('Unlink this file from “{title}” — the book and its reading history both stay, only the link goes', { title: linkMap[b.checksum].title })} onClick={() => unlink(b.checksum)}>✕</button>
                              </span>
                            )
                            : <button className="rh-link-chip" title={t('Link this file to a Trackyread book')} onClick={() => linkFile(b.checksum, b.name)}>○ {t('link…')}</button>}
                        </td>
                        <td>
                          <div className="rh-td-prog" title={t('{pct}% through', { pct: Math.round(b.posFrac * 100) })}>
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
                            title={t("Open this document in the reader — uses the copy saved on this device (or focuses it if it's already open)")}
                            onClick={async () => { if (await openRecent(b.checksum)) closeDialog?.(); }}
                          >▶</button>
                        </td>
                      </tr>
                    ))}
                    {libraryBooks.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 12 }}>{t('No files match.')}</td></tr>}
                  </tbody>
                </table>
              </div>
              {libraryBooks.length > fLimit && (
                <div className="lj-inline">
                  <span className="settings-note" style={{ margin: 0 }}>{t('Showing {n} of {total} — filter to narrow, or', { n: fLimit, total: libraryBooks.length })}</span>
                  <button className="lj-more" onClick={() => setFLimit(fLimit + 200)}>{t('Show {n} more', { n: 200 })}</button>
                  <button className="lj-more" onClick={() => setFLimit(libraryBooks.length)}>{t('Show all {n}', { n: libraryBooks.length })}</button>
                </div>
              )}
            </div>
          )}

          {tab === 'library' && selBook && (
            <div className="rh-detail">
              <button className="rh-back" onClick={() => setSelected(null)}>← {t('Files')}</button>
              <h3 className="rh-detail-title">
                {selBook.name}
                <button
                  className="rh-open-file"
                  title={t("Open this document in the reader — uses the copy saved on this device (or focuses it if it's already open)")}
                  onClick={async () => { if (await openRecent(selBook.checksum)) closeDialog?.(); }}
                >▶ {t('Open file')}</button>
              </h3>
              <p className="rh-detail-link">
                {linkMap[selBook.checksum]
                  ? (
                    <span className="rh-link-cell">
                      <span className="rh-link-chip on" title={t('This file is linked to a book in your Trackyread tracker')}>🔗 {t('Linked to Trackyread: {title}', { title: linkMap[selBook.checksum].title })}</span>
                      <button className="rh-unlink" aria-label={t('Unlink this file from {title}', { title: linkMap[selBook.checksum].title })} title={t('Unlink this file from “{title}” — the book and its reading history both stay, only the link goes', { title: linkMap[selBook.checksum].title })} onClick={() => unlink(selBook.checksum)}>✕</button>
                    </span>
                  )
                  : <span className="rh-link-chip" title={t('Link this file from the Trackyread Library (open a book → Linked document)')}>○ {t('Not linked to Trackyread')}</span>}
              </p>

              <div className="rh-shelf-pick">
                {SHELVES.map((s) => (
                  <button key={s.id} className={`rh-shelf-btn${selBook.shelf === s.id ? ' on' : ''}`} onClick={() => setShelf(selBook.checksum, s.id)}>
                    {s.icon} {s.label}
                  </button>
                ))}
                {selBook.shelfExplicit && <button className="rh-shelf-btn rh-shelf-auto" onClick={() => setShelf(selBook.checksum, null)} title={t('Use the shelf inferred from progress')}>↺ {t('Auto')}</button>}
              </div>

              <div className="rh-stat-grid">
                <Stat v={`${Math.round(selBook.posFrac * 100)}%`} l={t('position')} sub={`${fmtInt(selBook.wordIndex)} / ${fmtInt(selBook.totalWords)}`} />
                <Stat v={`${Math.round(selBook.readFrac * 100)}%`} l={t('actually read')} sub={t('{words} words', { words: fmtInt(selBook.wordsRead) })} />
                <Stat v={fmtDur(selBook.activeSecs)} l={t('time')} />
                <Stat v={selBook.avgWpm} l={t('avg WPM')} />
                <Stat v={selBook.daysRead} l={t('days read')} />
                <Stat v={selBook.completions} l={t('times finished')} />
              </div>

              <div className="rh-detail-2col">
                <div>
                  <div className="rh-section-h">{t('Daily words')}</div>
                  <Spark daily={selBook.daily} />
                  <div className="rh-detail-meta">
                    {selBook.firstRead && <span>{t('First: {date}', { date: selBook.firstRead })}</span>}
                    {selBook.lastRead && <span>{t('Last: {date}', { date: selBook.lastRead })}</span>}
                    {selBook.rating > 0 && <span>{t('Rating: {stars}', { stars: '★'.repeat(selBook.rating) })}</span>}
                  </div>
                </div>
                <div>
                  <div className="rh-section-h">{t('Chapters')}</div>
                  {selBook.tocTotal > 0 ? (
                    <p className="rh-toc-prog">{t('{completed} completed · {started} started · of {total} tracked sections', { completed: selBook.tocCompleted, started: selBook.tocStarted, total: selBook.tocTotal })}</p>
                  ) : (
                    <p className="settings-note">{t('No chapter-level reading recorded for this book yet.')}</p>
                  )}
                </div>
              </div>

              <div className="rh-section-h">{t('Sessions')}</div>
              <table className="history-table">
                <thead><tr><th>{t('Date')}</th><th>{t('Words')}</th><th>{t('Active')}</th><th>WPM</th></tr></thead>
                <tbody>
                  {selBook.daily.slice().reverse().slice(0, 40).map((d) => (
                    <tr key={d.date}><td>{d.date}</td><td>{fmtInt(d.wordsRead)}</td><td>{fmtDur(d.activeTimeSecs)}</td><td>{wpmOf(d.wordsRead, d.activeTimeSecs)}</td></tr>
                  ))}
                  {selBook.daily.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 10 }}>{t('No dated sessions recorded.')}</td></tr>}
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
    <Dialog title={t('Reading History')} onClose={onClose} width={840} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <HistoryView />
    </Dialog>
  );
}
