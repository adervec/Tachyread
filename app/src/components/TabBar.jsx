import { Fragment, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { groupForChecksum, masterOf } from '../features/bookGroups.js';
import { finishedNotRereading } from '../features/recentFilter.js';
import { getBinding, getLibraryBook, getLibraryBooks, getLibraryRef, getPresencePeers, loadFile, saveLibraryBook, setBinding } from '../state/storage.js';
import { queueOf, queueBooks, nextInQueue } from '../features/readingQueues.js';
import { openBookFile } from '../features/openBook.js';
import { getSearchDirs } from '../features/fileLocator.js';
import { contentType, readStatus } from '../features/journeyLibrary.js';
import { sortTabIds, tabInfo, TAB_SORT_KEYS } from '../features/tabSort.js';
import { bookFromOpenedDoc } from '../features/trackyreadAdd.js';
import { bookCoverSrc, proceduralCover } from '../features/bookCovers.js';
import { bookCoverUrl } from '../features/openLibrary.js';
import { presenceByChecksum, presenceLabel } from '../features/presence.js';
import { t } from '../i18n.js';

// Short labels for the dialog tabs (menus use longer "…" titles). Fallback is the raw kind.
const PANEL_LABELS = {
  'tab-settings': t('Tab Settings'), 'typing-settings': t('Typing Settings'), 'audio-settings': t('Audio Settings'),
  'font-manager': t('Fonts'), 'help': t('Help'), 'def-settings': t('Default Settings'), 'app-settings': t('App Settings'),
  'biometric-settings': t('Biometric Controls'), 'comfort-settings': t('Comfort'), 'data': t('Data'), 'book-groups': t('Book Groups'),
  'stats': t('Statistics'), 'history': t('History'), 'literary-journey': t('Trackyread'), 'proper-names': t('Proper Names'),
  'audiobook': t('Audiobook Centre'), 'notes': t('Notes'), 'tts-popup': t('Text-to-Speech'), 'face-library': t('Avatars'),
  'typing-progress': t('Typing Progress'), 'span-drill': t('Span Drill'), 'eye-warmup': t('Eye Warmup'),
  'flow-writer': t('Flow Writer'), 'dictation': t('Dictation'), 'ambient': t('Ambient'), 'vocab': t('Vocabulary'),
  'regressions': t('Regressions'), 'progress-detail': t('Progress'), 'attention': t('Attention'), 'typing-plan': t('Typing Plans'),
  'crosshairs': t('Crosshairs'),
};

// COMPLETION, not cursor position (0–100). A lazy tab has no tracker, so it falls back to the
// persisted read count (the same number the tracker would report).
function tabPct(tab) {
  const total = tab.lazy ? (tab.settings.totalWords || 0) : tab.doc.words.length;
  if (tab.lazy) return total ? Math.min(100, ((tab.settings.persistentWordsRead || 0) / total) * 100) : 0;
  return tab.tracker ? tab.tracker.coverageExcluding(tab.settings.skipRanges) * 100 : 0;
}

export default function TabBar() {
  const { state, setActiveTab, closeTab, closeTabs, closeAllTabs, setActivePanel, closePanel, reorderTabs, sortTabs, updateGlobal, setStatus, openDialog, openRecent, openFiles } = useApp();
  const { panels, activePanelId, tabs } = state;
  const groups = state.global.bookGroups || [];
  const multiRow = !!state.global.tabBarMultiRow;
  const tiles = !!state.global.tabTiles; // desktop: tabs as a scrollable cover-tile row
  const noDocs = tabs.length === 0;
  const dragId = useRef(null);                 // document tab being dragged
  const [dropId, setDropId] = useState(null);  // tab the drop indicator is on
  // Right-click menu (desktop): Notepad++-style close actions for the tab under the cursor.
  const [menu, setMenu] = useState(null);      // { x, y, tabId } | null
  // The menu tab's queue (if its book is queued): { queue, next: { book, cs } | null } — looked up
  // when the menu opens, for "Open next in queue" / "Go to queue".
  const [menuQ, setMenuQ] = useState(null);
  async function lookupQueue(tab) {
    setMenuQ(null);
    const cs = tab.lazy ? tab.settings?.contentChecksum : tab.doc?.contentChecksum;
    const bookId = cs && bindings[cs];
    if (!bookId) return;
    const [queues, books] = await Promise.all([getLibraryRef('queues').catch(() => null), getLibraryBooks().catch(() => [])]);
    const q = queueOf(queues || [], bookId);
    if (!q) return;
    const csOf = {};
    for (const [c, id] of Object.entries(bindings)) if (!csOf[id]) csOf[id] = c;
    // Books already open in a tab (any of their linked files — editions included) aren't "next": skip them.
    const openBookIds = new Set(tabs.map((tb) => bindings[tb.lazy ? tb.settings?.contentChecksum : tb.doc?.contentChecksum]).filter(Boolean));
    const { book } = await nextInQueue(queueBooks(q, books), bookId, (b) => !!csOf[b.id] && !openBookIds.has(b.id));
    setMenuQ({ tabId: tab.id, queue: q, next: book ? { book, cs: csOf[book.id] } : null });
  }
  async function openQueueNext() {
    const n = menuQ?.next;
    if (!n) return;
    const openChecksums = tabs.map((tb) => (tb.lazy ? tb.settings?.contentChecksum : tb.doc?.contentChecksum)).filter(Boolean);
    const r = await openBookFile({ cs: n.cs, name: n.book.title, openChecksums, dirs: await getSearchDirs().catch(() => []), openRecent, openFiles })
      .catch((e) => ({ ok: false, msg: e?.message || String(e) }));
    if (!r.ok) setStatus?.(r.msg);
  }
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // Trackyread link status per tab: the `binding` map (checksum → tracker book id). Loaded once and
  // refreshed when a link changes (setBinding / library import fire tachyread-bindings-changed). The
  // dot only appears once you've linked at least one document, so it's silent for non-tracker users.
  const [bindings, setBindings] = useState({});
  useEffect(() => {
    let live = true;
    const load = () => getBinding().then((m) => { if (live) setBindings(m || {}); }).catch(() => {});
    load();
    window.addEventListener('tachyread-bindings-changed', load);
    return () => { live = false; window.removeEventListener('tachyread-bindings-changed', load); };
  }, []);
  const hasBindings = Object.keys(bindings).length > 0;

  // …and which of the OPEN tabs' books are finished, so their dot becomes a ★. Only those few books
  // are read, and the state is replaced only when the set really changes — a library import fires a
  // change event per book and must not thrash the tab bar.
  const [finishedBooks, setFinishedBooks] = useState(() => new Set());
  const finishedKey = useRef('');
  const boundKey = [...new Set(tabs.map((tb) => bindings[tb.lazy ? tb.settings?.contentChecksum : tb.doc?.contentChecksum]).filter(Boolean))].sort().join(',');
  useEffect(() => {
    let live = true;
    const load = async () => {
      const done = [];
      for (const id of boundKey ? boundKey.split(',') : []) {
        const b = await getLibraryBook(id).catch(() => null);
        if (b && !b.deleted && readStatus(b) === 'finished') done.push(id);
      }
      const key = done.join(',');
      if (live && key !== finishedKey.current) { finishedKey.current = key; setFinishedBooks(new Set(done)); }
    };
    load();
    window.addEventListener('tachyread-library-changed', load);
    return () => { live = false; window.removeEventListener('tachyread-library-changed', load); };
  }, [boundKey]);

  // Cross-device presence: checksum → other devices that have it open (from the last sync pull).
  // Reloaded when a sync merges new presence (tachyread-presence-changed).
  const [presence, setPresence] = useState({});
  useEffect(() => {
    let live = true;
    const load = () => getPresencePeers().then((peers) => { if (live) setPresence(presenceByChecksum(peers)); }).catch(() => {});
    load();
    window.addEventListener('tachyread-presence-changed', load);
    return () => { live = false; window.removeEventListener('tachyread-presence-changed', load); };
  }, []);

  // In tile mode, resolve each open file's cover (checksum → bound book → master cover). Loaded only
  // while tiles are on. ponytail: reloads on binding changes, not on every cover edit — toggle tiles
  // off/on (or reopen) to pick up a freshly-added cover.
  const [coverByCs, setCoverByCs] = useState({});
  useEffect(() => {
    if (!tiles) return undefined;
    let live = true;
    const load = async () => {
      try {
        const [bind, books] = await Promise.all([getBinding(), getLibraryBooks()]);
        const byId = {};
        for (const b of books) { const src = bookCoverSrc(b) || bookCoverUrl(b, 'M'); if (src) byId[b.id] = src; }
        const map = {};
        for (const [cs, id] of Object.entries(bind || {})) if (byId[id]) map[cs] = byId[id];
        if (live) setCoverByCs(map);
      } catch { /* ignore */ }
    };
    load();
    window.addEventListener('tachyread-bindings-changed', load);
    return () => { live = false; window.removeEventListener('tachyread-bindings-changed', load); };
  }, [tiles]);

  // A doc-scoped panel (its docTabId names a file tab) renders in a GROUP right after that file's
  // tab, titled with the file / book-group name; unscoped panels stay leftmost.
  const docLabelOf = (tab) => {
    const cs = tab.lazy ? tab.settings?.contentChecksum : tab.doc?.contentChecksum;
    const grp = groupForChecksum(groups, cs);
    const name = (grp && grp.name && grp.name !== 'Untitled book' ? grp.name : (tab.lazy ? tab.fileName : tab.doc.fileName)) || '';
    return name.replace(/\.[a-z0-9]+$/i, '');
  };
  const renderPanel = (p, docLabel) => {
    const base = PANEL_LABELS[p.kind] || p.kind;
    const label = docLabel ? `${base} · ${docLabel}` : base;
    return (
      <div
        key={`panel-${p.id}`}
        className={`tab dialog-tab${docLabel ? ' grouped' : ''} ${p.id === activePanelId ? 'active' : ''}`}
        onClick={() => setActivePanel(p.id)}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closePanel(p.id); } }}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }} // stop the browser's middle-click autoscroll
        title={p.id === activePanelId ? t('{label} — tap to minimize', { label }) : label}
      >
        <span className="name">{label}</span>
        <button className="close" onClick={(e) => { e.stopPropagation(); closePanel(p.id); }} title={t('Close')}>×</button>
      </div>
    );
  };

  // Track a tab's document from its own right-click menu, without a detour through the tracker: the
  // same one-tap add as the open-a-document nudge, so a tab you meant to track is two clicks away.
  async function addTabToTrackyread(tab, open) {
    const cs = tab.lazy ? tab.settings?.contentChecksum : tab.doc?.contentChecksum;
    if (!cs) return;
    const fileName = (tab.lazy ? tab.fileName : tab.doc?.fileName) || 'Document';
    const words = tab.lazy ? (tab.settings?.totalWords || 0) : (tab.doc?.words.length || 0);
    const book = bookFromOpenedDoc({ fileName, words });
    try {
      await saveLibraryBook(book);
      await setBinding(cs, book.id); // fires tachyread-bindings-changed → this bar's dot refreshes
      setStatus?.(t('Added “{title}” to Trackyread.', { title: book.title }));
      if (open) openDialog?.({ kind: 'literary-journey', tab: 'library', focusBookId: book.id });
    } catch (e) { setStatus?.(t('Could not add to Trackyread: {error}', { error: e?.message || e })); }
  }

  // Sort the whole strip by one key. Reads each tab's SAVED record (lazy tabs carry only a shell),
  // with the live settings on top for loaded tabs, plus its Trackyread book for status/type.
  async function sortBy(key, dir) {
    const recent = state.global.recentFiles || [];
    const entries = await Promise.all(tabs.map(async (tb) => {
      const cs = tb.lazy ? tb.settings?.contentChecksum : tb.doc?.contentChecksum;
      const saved = cs ? await loadFile(cs).catch(() => null) : null;
      const rec = { ...(saved || {}), ...(tb.lazy ? {} : tb.settings), totalWords: tb.lazy ? (saved?.totalWords || tb.settings?.totalWords) : tb.doc.words.length };
      const book = bindings[cs] ? await getLibraryBook(bindings[cs]).catch(() => null) : null;
      const live = book && !book.deleted ? book : null;
      return { id: tb.id, info: tabInfo({
        fileName: tb.lazy ? tb.fileName : tb.doc.fileName, rec, book: live,
        status: live && readStatus(live), type: live && contentType(live),
        opened: recent.find((r) => r.checksum === cs)?.lastOpened ?? null,
      }) };
    }));
    sortTabs(sortTabIds(entries, key, dir));
    // i18n-keys: Name | Length | Completion | Position | Time left | Last read | Opened | Trackyread status | Content type | File type
    // i18n-keys: A → Z | Z → A | shortest | longest | least read | most read | least far | furthest | least | most | newest | oldest | reading first | untracked first | long-form first
    setStatus?.(t('Tabs sorted by {key} ({order}).', { key: t(TAB_SORT_KEYS[key][0]).toLowerCase(), order: t(TAB_SORT_KEYS[key][dir === 'desc' ? 3 : 2]) }));
  }

  // Build the right-click menu's actions from the tab it was opened on. Left/right are relative to
  // that tab's position among the document tabs; each entry is disabled when it would close nothing.
  const renderMenu = () => {
    const i = tabs.findIndex((tb) => tb.id === menu.tabId);
    if (i < 0) return null;
    const leftIds = tabs.slice(0, i).map((tb) => tb.id);
    const rightIds = tabs.slice(i + 1).map((tb) => tb.id);
    const otherIds = tabs.filter((tb) => tb.id !== menu.tabId).map((tb) => tb.id);
    // Finished (and not being reread) tabs — same heuristic that hides them from Open Recent.
    const shelves = state.global.readingList?.shelves || {};
    const finishedIds = tabs.filter((tb) => {
      const cs = tb.lazy ? tb.settings?.contentChecksum : tb.doc?.contentChecksum;
      const rec = { ...tb.settings, totalWords: tb.lazy ? (tb.settings?.totalWords || 0) : tb.doc.words.length };
      return finishedNotRereading(rec, shelves[cs]);
    }).map((tb) => tb.id);
    // Tracked = bound to a Trackyread book. Untouched = under 2% read (same completion the tab's bar shows).
    const csOf = (tb) => (tb.lazy ? tb.settings?.contentChecksum : tb.doc?.contentChecksum);
    const trackedIds = tabs.filter((tb) => bindings[csOf(tb)]).map((tb) => tb.id);
    const untrackedIds = tabs.filter((tb) => !bindings[csOf(tb)]).map((tb) => tb.id);
    const untouchedIds = tabs.filter((tb) => tabPct(tb) < 2).map((tb) => tb.id);
    const menuTab = tabs[i];
    const menuCs = menuTab.lazy ? menuTab.settings?.contentChecksum : menuTab.doc?.contentChecksum;
    const untracked = !!menuCs && !bindings[menuCs];
    // Sort submenu: one row per key, each with its two directions.
    if (menu.sort) {
      return (
        <>
          <div className="word-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="word-menu tab-sort-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label={t('Sort tabs')}>
            <div className="item" onClick={() => setMenu({ ...menu, sort: false })}>‹ {t('Back')}</div>
            <div className="sep" />
            {Object.entries(TAB_SORT_KEYS).map(([k, [label, , a, b]]) => (
              <div key={k} className="tab-sort-row">
                <span>{t(label)}</span>
                <button type="button" onClick={() => { sortBy(k, 'asc'); setMenu(null); }}>{t(a)}</button>
                <button type="button" onClick={() => { sortBy(k, 'desc'); setMenu(null); }}>{t(b)}</button>
              </div>
            ))}
          </div>
        </>
      );
    }
    const items = [
      { label: t('Sort tabs') + ' ›', n: tabs.length > 1 ? undefined : 0, keep: true, fn: () => setMenu({ ...menu, sort: true }) },
      { sep: true },
      ...(menuQ && menuQ.tabId === menu.tabId ? [
        menuQ.next
          ? { label: '▶ ' + t('Open next in “{queue}”: {title}', { queue: menuQ.queue.name, title: menuQ.next.book.title }), fn: openQueueNext }
          : { label: '▶ ' + t('Nothing else to open in “{queue}” (the rest are finished, already open, or have no file)', { queue: menuQ.queue.name }), n: 0, fn: () => {} },
        { label: '↗ ' + t('Go to queue “{queue}” in Trackyread', { queue: menuQ.queue.name }), fn: () => openDialog?.({ kind: 'literary-journey', tab: 'queue', focusQueueId: menuQ.queue.id }) },
        { sep: true },
      ] : []),
      ...(untracked ? [
        { label: '＋ ' + t('Add to Trackyread'), fn: () => addTabToTrackyread(menuTab, false) },
        { label: '＋ ' + t('Add to Trackyread & open it'), fn: () => addTabToTrackyread(menuTab, true) },
        { sep: true },
      ] : []),
      { label: t('Close'), fn: () => closeTab(menu.tabId) },
      { label: t('Close others'), n: otherIds.length, fn: () => closeTabs(otherIds) },
      { label: t('Close to the left'), n: leftIds.length, fn: () => closeTabs(leftIds) },
      { label: t('Close to the right'), n: rightIds.length, fn: () => closeTabs(rightIds) },
      { label: t('Close finished'), n: finishedIds.length, fn: () => closeTabs(finishedIds) },
      { label: t('Close untouched'), n: untouchedIds.length, fn: () => closeTabs(untouchedIds) },
      { label: t('Close tracked'), n: trackedIds.length, fn: () => closeTabs(trackedIds) },
      { label: t('Close untracked'), n: untrackedIds.length, fn: () => closeTabs(untrackedIds) },
      { label: t('Close all'), n: tabs.length, fn: () => closeAllTabs() },
      { sep: true },
      { label: multiRow ? '✓ ' + t('Multi-row tabs') : t('Multi-row tabs'), fn: () => updateGlobal({ tabBarMultiRow: !multiRow }) },
      { label: tiles ? '✓ ' + t('Tab tiles (covers)') : t('Tab tiles (covers)'), fn: () => updateGlobal({ tabTiles: !tiles }) },
    ];
    return (
      <>
        <div className="word-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
        <div className="word-menu" style={{ left: menu.x, top: menu.y }}>
          {items.map((it, k) => it.sep
            ? <div key={`sep-${k}`} className="sep" />
            : (
              <div
                key={it.label}
                className={`item${it.n === 0 ? ' disabled' : ''}`}
                onClick={it.n === 0 ? undefined : () => { it.fn(); if (!it.keep) setMenu(null); }}
              >
                {it.label}
              </div>
            ))}
        </div>
      </>
    );
  };

  return (
    <div className={`tab-bar${multiRow ? ' multi-row' : ''}${tiles ? ' tiles' : ''}`}>
      {/* Unscoped dialog tabs first (leftmost); doc-scoped ones render inside their file's group below. */}
      {panels.filter((p) => p.docTabId == null).map((p) => renderPanel(p, null))}
      {noDocs && panels.length === 0 && (
        <span className="empty">{t('No documents open — File → Open or drop a file')}</span>
      )}
      {tabs.map((tab) => {
        // Lazy (restored, not-yet-opened) tabs have no parsed doc — read name/progress from the
        // lightweight placeholder fields instead.
        const fileName = tab.lazy ? tab.fileName : tab.doc.fileName;
        // COMPLETION, not cursor position: read the 1st, 2nd and 4th quarters of a book and this
        // sits at 75%, where the cursor alone would claim 100%.
        const pct = tabPct(tab);
        // If this file is part of a NAMED book group, the tab shows the group name with a marker:
        // ★ for the master (canonical) copy, or a number for each of the other editions.
        const cs = tab.lazy ? tab.settings?.contentChecksum : tab.doc?.contentChecksum;
        const grp = groupForChecksum(groups, cs);
        const named = grp && grp.name && grp.name !== 'Untitled book' ? grp : null;
        let mark = null;
        if (named) {
          const master = masterOf(named);
          mark = cs === master ? '★' : String((named.members || []).filter((m) => m !== master).indexOf(cs) + 1);
        }
        const label = named ? named.name : fileName;
        const scopedPanels = panels.filter((p) => p.docTabId === tab.id);
        return (
          <Fragment key={tab.id}>
          <div
            className={`tab ${tab.id === state.activeTabId ? 'active' : ''} ${tab.lazy ? 'lazy' : ''}${dropId === tab.id ? ' drop-target' : ''}${scopedPanels.length ? ' has-group' : ''}`}
            draggable
            onClick={() => setActiveTab(tab.id)}
            // Chrome-style: middle-click closes the tab. mousedown is swallowed so the browser
            // doesn't start its autoscroll on the way.
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id }); lookupQueue(tab); }}
            onDragStart={(e) => { dragId.current = tab.id; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragId.current && dragId.current !== tab.id) { e.preventDefault(); setDropId(tab.id); } }}
            onDragLeave={() => setDropId((d) => (d === tab.id ? null : d))}
            onDrop={(e) => { e.preventDefault(); if (dragId.current && dragId.current !== tab.id) reorderTabs(dragId.current, tab.id); dragId.current = null; setDropId(null); }}
            onDragEnd={() => { dragId.current = null; setDropId(null); }}
            title={`${named ? (cs === masterOf(named) ? t('{group} — {file} (master)', { group: named.name, file: fileName }) : `${named.name} — ${fileName}`) : (tab.lazy ? t('{file} — tap to load', { file: fileName }) : fileName)}\n${t('{pct}% of the text read (completion, not position)', { pct: pct.toFixed(1) })}`}
          >
            {tiles && (
              <img
                className="tab-tile-cover"
                src={coverByCs[cs] || proceduralCover({ title: label })}
                alt=""
                loading="lazy"
                onError={(e) => { e.target.style.opacity = 0.2; }}
              />
            )}
            {hasBindings && (
              cs && finishedBooks.has(bindings[cs])
                ? <span className="tab-track done" title={t('Finished in Trackyread')} aria-label={t('Finished in Trackyread')} role="img">★</span>
                : (
                  <span
                    className={`tab-track ${cs && bindings[cs] ? 'in' : 'out'}`}
                    title={cs && bindings[cs] ? t('Tracked in Trackyread') : t('Not in Trackyread')}
                  />
                )
            )}
            {cs && presence[cs]?.length > 0 && (
              <span className="tab-elsewhere" title={t('Also open on {devices} (as of the last sync)', { devices: presenceLabel(presence[cs]) })} aria-label={t('Also open on another device')}>🖥</span>
            )}
            <span className="name">{label}{mark && <sup className="tab-grp-mark">{mark}</sup>}</span>
            <button
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title={t('Close tab')}
            >
              ×
            </button>
            <div className="progress" style={{ width: `${pct}%` }} />
          </div>
          {/* This file's dialog tabs (settings / audiobook / notes / …) grouped right after it. */}
          {scopedPanels.map((p) => renderPanel(p, docLabelOf(tab)))}
          </Fragment>
        );
      })}
      {menu && renderMenu()}
    </div>
  );
}
