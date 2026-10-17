import { Fragment, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { groupForChecksum, masterOf } from '../features/bookGroups.js';
import { finishedNotRereading } from '../features/recentFilter.js';
import { getBinding, getLibraryBook, getLibraryBooks, getPresencePeers, loadFile, saveLibraryBook, setBinding } from '../state/storage.js';
import { contentType, readStatus } from '../features/journeyLibrary.js';
import { sortTabIds, tabInfo, TAB_SORT_KEYS } from '../features/tabSort.js';
import { bookFromOpenedDoc } from '../features/trackyreadAdd.js';
import { bookCoverSrc, proceduralCover } from '../features/bookCovers.js';
import { bookCoverUrl } from '../features/openLibrary.js';
import { presenceByChecksum, presenceLabel } from '../features/presence.js';

// Short labels for the dialog tabs (menus use longer "…" titles). Fallback is the raw kind.
const PANEL_LABELS = {
  'tab-settings': 'Tab Settings', 'typing-settings': 'Typing Settings', 'audio-settings': 'Audio Settings',
  'font-manager': 'Fonts', 'help': 'Help', 'def-settings': 'Default Settings', 'app-settings': 'App Settings',
  'biometric-settings': 'Biometric Controls', 'comfort-settings': 'Comfort', 'data': 'Data', 'book-groups': 'Book Groups',
  'stats': 'Statistics', 'history': 'History', 'literary-journey': 'Trackyread', 'proper-names': 'Proper Names',
  'audiobook': 'Audiobook Centre', 'notes': 'Notes', 'tts-popup': 'Text-to-Speech', 'face-library': 'Avatars',
  'typing-progress': 'Typing Progress', 'span-drill': 'Span Drill', 'eye-warmup': 'Eye Warmup',
  'flow-writer': 'Flow Writer', 'dictation': 'Dictation', 'ambient': 'Ambient', 'vocab': 'Vocabulary',
  'regressions': 'Regressions', 'progress-detail': 'Progress', 'attention': 'Attention', 'typing-plan': 'Typing Plans',
  'crosshairs': 'Crosshairs',
};

// COMPLETION, not cursor position (0–100). A lazy tab has no tracker, so it falls back to the
// persisted read count (the same number the tracker would report).
function tabPct(tab) {
  const total = tab.lazy ? (tab.settings.totalWords || 0) : tab.doc.words.length;
  if (tab.lazy) return total ? Math.min(100, ((tab.settings.persistentWordsRead || 0) / total) * 100) : 0;
  return tab.tracker ? tab.tracker.coverageExcluding(tab.settings.skipRanges) * 100 : 0;
}

export default function TabBar() {
  const { state, setActiveTab, closeTab, closeTabs, closeAllTabs, setActivePanel, closePanel, reorderTabs, sortTabs, updateGlobal, setStatus, openDialog } = useApp();
  const { panels, activePanelId, tabs } = state;
  const groups = state.global.bookGroups || [];
  const multiRow = !!state.global.tabBarMultiRow;
  const tiles = !!state.global.tabTiles; // desktop: tabs as a scrollable cover-tile row
  const noDocs = tabs.length === 0;
  const dragId = useRef(null);                 // document tab being dragged
  const [dropId, setDropId] = useState(null);  // tab the drop indicator is on
  // Right-click menu (desktop): Notepad++-style close actions for the tab under the cursor.
  const [menu, setMenu] = useState(null);      // { x, y, tabId } | null
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
  const boundKey = [...new Set(tabs.map((t) => bindings[t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum]).filter(Boolean))].sort().join(',');
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
        title={p.id === activePanelId ? `${label} — tap to minimize` : label}
      >
        <span className="name">{label}</span>
        <button className="close" onClick={(e) => { e.stopPropagation(); closePanel(p.id); }} title="Close">×</button>
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
      setStatus?.(`Added “${book.title}” to Trackyread.`);
      if (open) openDialog?.({ kind: 'literary-journey', tab: 'library', focusBookId: book.id });
    } catch (e) { setStatus?.('Could not add to Trackyread: ' + (e?.message || e)); }
  }

  // Sort the whole strip by one key. Reads each tab's SAVED record (lazy tabs carry only a shell),
  // with the live settings on top for loaded tabs, plus its Trackyread book for status/type.
  async function sortBy(key, dir) {
    const recent = state.global.recentFiles || [];
    const entries = await Promise.all(tabs.map(async (t) => {
      const cs = t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum;
      const saved = cs ? await loadFile(cs).catch(() => null) : null;
      const rec = { ...(saved || {}), ...(t.lazy ? {} : t.settings), totalWords: t.lazy ? (saved?.totalWords || t.settings?.totalWords) : t.doc.words.length };
      const book = bindings[cs] ? await getLibraryBook(bindings[cs]).catch(() => null) : null;
      const live = book && !book.deleted ? book : null;
      return { id: t.id, info: tabInfo({
        fileName: t.lazy ? t.fileName : t.doc.fileName, rec, book: live,
        status: live && readStatus(live), type: live && contentType(live),
        opened: recent.find((r) => r.checksum === cs)?.lastOpened ?? null,
      }) };
    }));
    sortTabs(sortTabIds(entries, key, dir));
    setStatus?.(`Tabs sorted by ${TAB_SORT_KEYS[key][0].toLowerCase()} (${TAB_SORT_KEYS[key][dir === 'desc' ? 3 : 2]}).`);
  }

  // Build the right-click menu's actions from the tab it was opened on. Left/right are relative to
  // that tab's position among the document tabs; each entry is disabled when it would close nothing.
  const renderMenu = () => {
    const i = tabs.findIndex((t) => t.id === menu.tabId);
    if (i < 0) return null;
    const leftIds = tabs.slice(0, i).map((t) => t.id);
    const rightIds = tabs.slice(i + 1).map((t) => t.id);
    const otherIds = tabs.filter((t) => t.id !== menu.tabId).map((t) => t.id);
    // Finished (and not being reread) tabs — same heuristic that hides them from Open Recent.
    const shelves = state.global.readingList?.shelves || {};
    const finishedIds = tabs.filter((t) => {
      const cs = t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum;
      const rec = { ...t.settings, totalWords: t.lazy ? (t.settings?.totalWords || 0) : t.doc.words.length };
      return finishedNotRereading(rec, shelves[cs]);
    }).map((t) => t.id);
    // Tracked = bound to a Trackyread book. Untouched = under 2% read (same completion the tab's bar shows).
    const csOf = (t) => (t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum);
    const trackedIds = tabs.filter((t) => bindings[csOf(t)]).map((t) => t.id);
    const untrackedIds = tabs.filter((t) => !bindings[csOf(t)]).map((t) => t.id);
    const untouchedIds = tabs.filter((t) => tabPct(t) < 2).map((t) => t.id);
    const menuTab = tabs[i];
    const menuCs = menuTab.lazy ? menuTab.settings?.contentChecksum : menuTab.doc?.contentChecksum;
    const untracked = !!menuCs && !bindings[menuCs];
    // Sort submenu: one row per key, each with its two directions.
    if (menu.sort) {
      return (
        <>
          <div className="word-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="word-menu tab-sort-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label="Sort tabs">
            <div className="item" onClick={() => setMenu({ ...menu, sort: false })}>‹ Back</div>
            <div className="sep" />
            {Object.entries(TAB_SORT_KEYS).map(([k, [label, , a, b]]) => (
              <div key={k} className="tab-sort-row">
                <span>{label}</span>
                <button type="button" onClick={() => { sortBy(k, 'asc'); setMenu(null); }}>{a}</button>
                <button type="button" onClick={() => { sortBy(k, 'desc'); setMenu(null); }}>{b}</button>
              </div>
            ))}
          </div>
        </>
      );
    }
    const items = [
      { label: 'Sort tabs ›', n: tabs.length > 1 ? undefined : 0, keep: true, fn: () => setMenu({ ...menu, sort: true }) },
      { sep: true },
      ...(untracked ? [
        { label: '＋ Add to Trackyread', fn: () => addTabToTrackyread(menuTab, false) },
        { label: '＋ Add to Trackyread & open it', fn: () => addTabToTrackyread(menuTab, true) },
        { sep: true },
      ] : []),
      { label: 'Close', fn: () => closeTab(menu.tabId) },
      { label: 'Close others', n: otherIds.length, fn: () => closeTabs(otherIds) },
      { label: 'Close to the left', n: leftIds.length, fn: () => closeTabs(leftIds) },
      { label: 'Close to the right', n: rightIds.length, fn: () => closeTabs(rightIds) },
      { label: 'Close finished', n: finishedIds.length, fn: () => closeTabs(finishedIds) },
      { label: 'Close untouched', n: untouchedIds.length, fn: () => closeTabs(untouchedIds) },
      { label: 'Close tracked', n: trackedIds.length, fn: () => closeTabs(trackedIds) },
      { label: 'Close untracked', n: untrackedIds.length, fn: () => closeTabs(untrackedIds) },
      { label: 'Close all', n: tabs.length, fn: () => closeAllTabs() },
      { sep: true },
      { label: multiRow ? '✓ Multi-row tabs' : 'Multi-row tabs', fn: () => updateGlobal({ tabBarMultiRow: !multiRow }) },
      { label: tiles ? '✓ Tab tiles (covers)' : 'Tab tiles (covers)', fn: () => updateGlobal({ tabTiles: !tiles }) },
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
        <span className="empty">No documents open — File → Open or drop a file</span>
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
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id }); }}
            onDragStart={(e) => { dragId.current = tab.id; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragId.current && dragId.current !== tab.id) { e.preventDefault(); setDropId(tab.id); } }}
            onDragLeave={() => setDropId((d) => (d === tab.id ? null : d))}
            onDrop={(e) => { e.preventDefault(); if (dragId.current && dragId.current !== tab.id) reorderTabs(dragId.current, tab.id); dragId.current = null; setDropId(null); }}
            onDragEnd={() => { dragId.current = null; setDropId(null); }}
            title={`${named ? `${named.name} — ${fileName}${cs === masterOf(named) ? ' (master)' : ''}` : (tab.lazy ? `${fileName} — tap to load` : fileName)}\n${pct.toFixed(1)}% of the text read (completion, not position)`}
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
                ? <span className="tab-track done" title="Finished in Trackyread" aria-label="Finished in Trackyread" role="img">★</span>
                : (
                  <span
                    className={`tab-track ${cs && bindings[cs] ? 'in' : 'out'}`}
                    title={cs && bindings[cs] ? 'Tracked in Trackyread' : 'Not in Trackyread'}
                  />
                )
            )}
            {cs && presence[cs]?.length > 0 && (
              <span className="tab-elsewhere" title={`Also open on ${presenceLabel(presence[cs])} (as of the last sync)`} aria-label="Also open on another device">🖥</span>
            )}
            <span className="name">{label}{mark && <sup className="tab-grp-mark">{mark}</sup>}</span>
            <button
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close tab"
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
