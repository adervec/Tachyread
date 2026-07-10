import { createContext, useContext, useEffect, useReducer, useRef, useCallback } from 'react';
import { defaultFileSettings, defaultGlobalSettings, isSyncedGlobalKey, tabDefaultsFrom } from './settings.js';
import { loadGlobal, saveGlobal, loadFile, saveFile, loadReadState, saveReadState, saveDocPayload, loadDocPayload, loadSession, saveSession } from './storage.js';
import { parseFile, parseClipboardText } from '../document/parsers.js';
import { readerDocFromText, attachChecksum } from '../document/readerDocument.js';
import { createReadingTracker } from '../engine/readingTracker.js';
import { groupForChecksum, bestGroupPercent } from '../features/bookGroups.js';
import { isCompactScreen } from './device.js';

const AppCtx = createContext(null);

let nextTabId = 1;

function makeTab(doc, settings, tracker) {
  return {
    id: nextTabId++,
    doc,
    settings: { ...settings, totalWords: doc.words.length, contentChecksum: doc.contentChecksum },
    tracker,
    sessionStartTs: Date.now(),
    sessionLinesRead: new Set(),
    sessionNavLinesRead: new Set(),
    readLinesAllTime: new Set(),
    // dialog state etc.
    findQuery: '',
    findResults: [],
    findIndex: -1,
  };
}

// A not-yet-loaded restored tab: it knows its name + checksum + stored progress (for the tab strip)
// but hasn't built the heavy parsed document or reading tracker. hydrateTab() fills those in the
// first time it's opened. Used on compact screens to keep several restored books off the heap.
function makeLazyTab({ checksum, fileName, wordIndex = 0, totalWords = 0 }) {
  return {
    id: nextTabId++,
    lazy: true,
    checksum,
    fileName,
    doc: null,
    tracker: null,
    // Enough of a settings shell that the tab strip can show a name + progress without loading.
    settings: { wordIndex, totalWords, contentChecksum: checksum },
  };
}

// On phones / portrait tablets the panes stack, so opening with several is a long scroll. Start
// compact screens with just the reader + lines; the rest are one tap away in the menu bar. Evaluated
// at load (these view toggles aren't persisted), so a reload picks the right default after a resize.
const compactStart = isCompactScreen(); // touch + short-side aware, so a phone booting in landscape still counts

const init = {
  global: defaultGlobalSettings(),
  globalHydrated: false, // true once stored global settings have loaded (guards boot-once prompts)
  tabs: [],
  activeTabId: null,
  appStatus: 'Ready.',
  // Dialogs come in two flavours. MODAL_KINDS (legal gate, confirmations, transient step-wizards)
  // stay as one blocking centered overlay in `modal`. Everything else opens as a dockable TAB in
  // `panels` — many can be open at once, shown leftmost in the tab bar, one focused (`activePanelId`)
  // as a non-blocking docked panel; null means all minimized (just reading).
  modal: null,        // { kind, ...props } — blocking overlay, one at a time
  panels: [],         // [{ id, kind, ...props }] — dialog tabs
  activePanelId: null,
  panelSeq: 0,        // monotonic id source for panels
  showRsvp: true,
  showLines: true,
  showToc: false,
  showStats: !compactStart, // reading-stats panel (faces are gated per-tab by settings.showEyes)
  showSource: false,
  showIndex: false,
  hideMode: 'None',
  // Incognito reading: when true, ALL tracking + persistence is paused — the app reads like a plain
  // text viewer and, from the reading history's point of view, was never even opened. Session-only.
  incognito: false,
  incognitoSnap: null, // { tabId: wordIndex } captured on entry, restored on exit (true "nothing happened")
};

// Dialogs that stay blocking modals rather than becoming tabs: the legal gate, quick confirmations,
// and step-wizards that act on a transient selection (leaving one half-done as a tab is worse than
// a modal). Everything else the menus open becomes a dockable dialog tab.
const MODAL_KINDS = new Set([
  'disclaimer', 'finished', 'save-tab', 'find', 'goto',
  'webcam-calib', 'hand-calib', 'grab', 'web-grab', 'html-structure', 'html-tools', 'toc-wizard', 'resource-wizard', 'api-usage',
]);

// Dialog-tab kinds whose subject is ONE document. Opening one stamps the active doc tab's id onto
// the panel: it stays locked to that file (switching doc tabs doesn't retarget it), shows the file's
// name in its title, renders grouped next to its file tab, and closes when the file tab closes.
export const DOC_SCOPED_KINDS = new Set([
  'tab-settings', 'typing-settings', 'audio-settings', 'font-manager', 'proper-names',
  'audiobook', 'notes', 'tts-popup', 'regressions', 'progress-detail', 'attention',
]);

function reducer(state, action) {
  switch (action.type) {
    case 'SET_GLOBAL':
      return { ...state, global: action.global, globalHydrated: true };
    case 'ADD_TAB': {
      const tabs = [...state.tabs, action.tab];
      return { ...state, tabs, activeTabId: action.tab.id };
    }
    case 'RESTORE_TABS': {
      // Append a batch of (usually lazy) tabs and set the active tab in one shot, without the
      // per-add activation ADD_TAB does — so a restore can leave no tab active (landing page).
      const tabs = [...state.tabs, ...action.tabs];
      return { ...state, tabs, activeTabId: action.activeId ?? null };
    }
    case 'CLOSE_TAB': {
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const active = state.activeTabId === action.id
        ? (tabs[tabs.length - 1]?.id ?? null)
        : state.activeTabId;
      // A file's doc-scoped dialog tabs (its settings/audiobook/notes/…) close with the file.
      const panels = state.panels.filter((p) => p.docTabId !== action.id);
      const activePanelId = panels.some((p) => p.id === state.activePanelId) ? state.activePanelId : null;
      return { ...state, tabs, activeTabId: active, panels, activePanelId };
    }
    case 'CLOSE_ALL_TABS': {
      const panels = state.panels.filter((p) => p.docTabId == null);
      return { ...state, tabs: [], activeTabId: null, panels,
        activePanelId: panels.some((p) => p.id === state.activePanelId) ? state.activePanelId : null };
    }
    case 'REORDER_TABS': {
      const from = state.tabs.findIndex((t) => t.id === action.fromId);
      const to = state.tabs.findIndex((t) => t.id === action.toId);
      if (from < 0 || to < 0 || from === to) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...state, tabs };
    }
    case 'SET_ACTIVE_TAB':
      // Going to read a document minimizes any focused dialog overlay (its tab stays in the strip).
      return { ...state, activeTabId: action.id, activePanelId: null };
    case 'PATCH_TAB': {
      const tabs = state.tabs.map((t) =>
        t.id === action.id ? { ...t, ...action.patch } : t
      );
      return { ...state, tabs };
    }
    case 'PATCH_SETTINGS': {
      const tabs = state.tabs.map((t) =>
        t.id === action.id ? { ...t, settings: { ...t.settings, ...action.patch } } : t
      );
      return { ...state, tabs };
    }
    case 'SET_STATUS':
      return { ...state, appStatus: action.text };
    case 'SET_IMPORT':
      return { ...state, importing: action.payload };
    case 'OPEN_DIALOG': {
      const d = action.dialog;
      if (!d) return state;
      if (MODAL_KINDS.has(d.kind)) return { ...state, modal: d };
      // Doc-scoped dialogs lock to the file they were opened for.
      const scoped = DOC_SCOPED_KINDS.has(d.kind);
      const docTabId = scoped ? state.activeTabId : undefined;
      // Dedupe: same kind refocuses (per FILE for doc-scoped kinds — Audiobook for book A and for
      // book B are two different tabs; there's still never two Audiobook tabs for the same book).
      const existing = state.panels.find((p) => p.kind === d.kind && (!scoped || p.docTabId === docTabId));
      if (existing) {
        return { ...state, activePanelId: existing.id,
          panels: state.panels.map((p) => (p.id === existing.id ? { ...p, ...d } : p)) };
      }
      const id = state.panelSeq + 1;
      return { ...state, panels: [...state.panels, { ...d, id, docTabId }], activePanelId: id, panelSeq: id };
    }
    case 'CLOSE_DIALOG': {
      // A dialog's own ×/Esc closes whatever is focused: a modal first, else the active panel tab.
      if (state.modal) return { ...state, modal: null };
      if (state.activePanelId == null) return state;
      return { ...state, activePanelId: null,
        panels: state.panels.filter((p) => p.id !== state.activePanelId) };
    }
    case 'SET_ACTIVE_PANEL':
      return { ...state, activePanelId: action.id };
    case 'CLOSE_PANEL':
      return { ...state, panels: state.panels.filter((p) => p.id !== action.id),
        activePanelId: state.activePanelId === action.id ? null : state.activePanelId };
    case 'TOGGLE_SHOW_RSVP':
      return { ...state, showRsvp: !state.showRsvp };
    case 'TOGGLE_LINES':
      return { ...state, showLines: !state.showLines };
    case 'TOGGLE_TOC':
      return { ...state, showToc: !state.showToc };
    case 'TOGGLE_STATS':
      return { ...state, showStats: !state.showStats };
    case 'TOGGLE_SOURCE':
      return { ...state, showSource: !state.showSource };
    case 'TOGGLE_INDEX':
      return { ...state, showIndex: !state.showIndex };
    case 'SET_HIDE_MODE':
      return { ...state, hideMode: action.mode };
    case 'TOGGLE_INCOGNITO': {
      if (!state.incognito) {
        // Entering: snapshot every open tab's reading position so it can be rewound on exit.
        const snap = {};
        for (const t of state.tabs) if (!t.lazy) snap[t.id] = t.settings.wordIndex;
        return { ...state, incognito: true, incognitoSnap: snap };
      }
      // Exiting: rewind each tab to where it was — incognito reading leaves no trace at all.
      const snap = state.incognitoSnap || {};
      const tabs = state.tabs.map((t) =>
        (!t.lazy && snap[t.id] != null && snap[t.id] !== t.settings.wordIndex)
          ? { ...t, settings: { ...t.settings, wordIndex: snap[t.id] } }
          : t
      );
      return { ...state, incognito: false, incognitoSnap: null, tabs };
    }
    case 'SNAP_INCOGNITO_TAB': {
      // Capture a tab's position the first time it's loaded during incognito, so exit rewinds it too.
      if (!state.incognito) return state;
      const snap = { ...(state.incognitoSnap || {}) };
      if (snap[action.id] == null) snap[action.id] = action.wordIndex;
      return { ...state, incognitoSnap: snap };
    }
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, init);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionReady = useRef(false); // gate session saves until the restore pass finishes
  const didRestore = useRef(false);

  // Load global settings on mount
  useEffect(() => {
    (async () => {
      const g = await loadGlobal();
      // Scroll-to-read never survives a restart: booting with it on silently credits whatever the
      // restored scroll position passes (phantom "read" text). It's an explicitly-armed mode.
      g.scrollAdvances = false;
      dispatch({ type: 'SET_GLOBAL', global: g });
    })();
  }, []);

  // Persist tab settings on changes (debounced). Only tabs whose settings object actually changed
  // since the last save are written — during reading just the active tab changes, so this avoids
  // re-serialising every open document's settings to IndexedDB on each word step (a real cost with
  // several large books open on a phone).
  const saveTimer = useRef(null);
  const savedSettingsRef = useRef(new Map()); // tab.id -> last-saved settings reference
  // Sync stamps per tab: what was last persisted, so a change can be DATED. `updatedAt` dates the
  // reusable (appearance/behaviour) settings — without it the cloud LWW never accepts them on another
  // device (the reported "theme reset to default"); `posUpdatedAt`/`posDevice` date the reading
  // position so the cross-device merge can prefer the NEWEST progress, not just the furthest.
  const saveMetaRef = useRef(new Map()); // tab.id -> { wordIndex, reuse, updatedAt, posUpdatedAt, posDevice }
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (stateRef.current.incognito) return; // incognito: don't persist tab settings / progress
      const live = new Set();
      for (const tab of state.tabs) {
        live.add(tab.id);
        if (tab.lazy) continue; // placeholder — its settings shell must not overwrite the stored record
        if (savedSettingsRef.current.get(tab.id) === tab.settings) continue; // unchanged → skip
        savedSettingsRef.current.set(tab.id, tab.settings);
        const s = tab.settings;
        let meta = saveMetaRef.current.get(tab.id);
        if (!meta) {
          // Seed from the loaded settings (stored stamps ride in via buildTabData's spread).
          meta = { wordIndex: s.wordIndex, reuse: JSON.stringify(tabDefaultsFrom(s)), updatedAt: s.updatedAt || 0, posUpdatedAt: s.posUpdatedAt || 0, posDevice: s.posDevice || '' };
        }
        const reuse = JSON.stringify(tabDefaultsFrom(s));
        if (reuse !== meta.reuse) { meta.updatedAt = Date.now(); meta.reuse = reuse; }
        if (s.wordIndex !== meta.wordIndex) { meta.posUpdatedAt = Date.now(); meta.posDevice = stateRef.current.global.deviceName || ''; meta.wordIndex = s.wordIndex; }
        // Source-page summary for the reading history (PDF pages / EPUB·HTML sections / grabbed
        // images). O(1) per save: the word→segment map is on the doc; the furthest page reached is a
        // running max so a rewind doesn't shrink it.
        let src = {};
        const w2s = tab.doc?.wordToSegment;
        if (w2s && tab.doc.segmentCount) {
          const curSeg = w2s[Math.min(s.wordIndex, w2s.length - 1)] || 0;
          if (meta.srcMax == null) meta.srcMax = s.sourceMaxSeg || 0;
          meta.srcMax = Math.max(meta.srcMax, curSeg);
          src = { sourcePages: tab.doc.segmentCount, sourceKind: tab.doc.source?.kind || '', sourceCurSeg: curSeg, sourceMaxSeg: meta.srcMax };
        }
        saveMetaRef.current.set(tab.id, meta);
        saveFile({ ...s, ...src, updatedAt: meta.updatedAt, posUpdatedAt: meta.posUpdatedAt, posDevice: meta.posDevice }).catch(() => {});
      }
      for (const id of [...savedSettingsRef.current.keys()]) if (!live.has(id)) { savedSettingsRef.current.delete(id); saveMetaRef.current.delete(id); }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [state.tabs]);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) || null;
  const hydratingRef = useRef(new Set()); // tab ids currently being hydrated (dedupe double-opens)

  // The heavy part of opening a document: merge stored settings, build the reading tracker, and
  // apply book-group catch-up. Shared by openDoc (new tab) and hydrateTab (lazy restore).
  const buildTabData = useCallback(async (doc) => {
    // Merge stored per-file settings (lookup by checksum)
    const stored = await loadFile(doc.contentChecksum);
    const baseSettings = {
      ...defaultFileSettings(),
      ...(stateRef.current.global.fileDefaults || {}),
      ...(stored || {}),
    };
    // Migrate the old 3000ms line long-press default (way too long — it just needs to reject
    // accidental taps) down to the new 450ms default. ponytail: also remaps a deliberate 3000, which
    // nobody sets; anyone wanting a different hold just uses the slider.
    if (baseSettings.lineLongPressMs === 3000) baseSettings.lineLongPressMs = 450;
    // Record the book's name on its settings so the reading history can label it without a payload load.
    baseSettings.fileName = doc.fileName || baseSettings.fileName || '';
    // Markdown/HTML parsing yields an EXACT TOC (the document's real headings). Seed it once for
    // files with no stored TOC, so the ToC pane doesn't fall back to text heuristics; after that
    // the persisted (possibly user-edited) entries win.
    if (doc.tocEntries?.length && !stored?.tocEntries?.length) baseSettings.tocEntries = doc.tocEntries;
    // Clamp wordIndex if it overruns the new doc length
    if (baseSettings.wordIndex >= doc.words.length)
      baseSettings.wordIndex = Math.max(0, doc.words.length - 1);
    // Reading tracker, seeded from the persisted read mask + lifetime active time.
    const rs = await loadReadState(doc.contentChecksum);
    // Paragraph boundaries (first word index of each paragraph) for the paragraph-resolution timeline.
    const paragraphStarts = [];
    { let inPara = false; for (const ln of doc.lines) { if (ln.isEmpty) { inPara = false; continue; } if (!inPara) { paragraphStarts.push(ln.startWordIndex); inPara = true; } } }
    const tracker = createReadingTracker({
      wordCount: doc.words.length,
      maskB64: rs?.maskB64 || '',
      wpmB64: rs?.wpmB64 || '',
      srcB64: rs?.srcB64 || '',
      lifetimeActiveMs: rs?.lifetimeActiveMs || 0,
      daily: rs?.daily || [],
      paragraphStarts,
      paraTsB64: rs?.paraTsB64 || '',
    });
    // Book-group catch-up: if this file is grouped with other editions, resume at the furthest
    // percent any of them reached (progress shared as a fraction, since masks can't cross editions).
    let groupNote = '';
    const group = groupForChecksum(stateRef.current.global.bookGroups, doc.contentChecksum);
    if (group && doc.words.length > 0) {
      const sibs = [];
      for (const m of group.members) {
        if (m === doc.contentChecksum) continue;
        const rec = await loadFile(m);
        if (rec) sibs.push(rec);
      }
      const best = bestGroupPercent(baseSettings.wordIndex / doc.words.length, sibs);
      const target = Math.min(doc.words.length - 1, Math.round(best * doc.words.length));
      if (target > baseSettings.wordIndex) {
        baseSettings.wordIndex = target;
        tracker.markPrefixRead(target); // keep "% read" consistent with the resumed position
        if (!stateRef.current.incognito) {
          saveReadState(doc.contentChecksum, {
            maskB64: tracker.serializeMask(), wpmB64: tracker.serializeWpm(), srcB64: tracker.serializeSrc(),
            lifetimeActiveMs: tracker.lifetimeActiveMs, daily: tracker.dailyArray(),
            paraTsB64: tracker.serializeParaTs(),
          }).catch(() => {});
        }
        groupNote = ` — caught up to ${Math.round(best * 100)}% from “${group.name}”`;
      }
    }
    return { baseSettings, tracker, groupNote };
  }, []);

  const openDoc = useCallback(async (doc, opts = {}) => {
    const { silent = false, persist = true } = opts;
    const { baseSettings, tracker, groupNote } = await buildTabData(doc);
    const tab = makeTab(doc, baseSettings, tracker);
    dispatch({ type: 'ADD_TAB', tab });
    if (!silent) dispatch({ type: 'SET_STATUS', text: `Opened ${doc.fileName} (${doc.words.length} words)${groupNote}` });
    // Persist a rebuildable payload so this tab can be reconnected next session (never in incognito).
    if (persist && !stateRef.current.incognito) {
      saveDocPayload({
        checksum: doc.contentChecksum,
        fileName: doc.fileName,
        fullText: doc.fullText,
        source: doc.source || null,
        wordToSegment: doc.wordToSegment || null,
        segmentCount: doc.segmentCount || 0,
      }).catch(() => {});
      // Record it in the Open-Recent list (most-recent first, deduped, capped). recentFiles is a data
      // key (not a synced setting), so save directly without stamping the settings-sync clock.
      const g = stateRef.current.global;
      const recentFiles = [{ name: doc.fileName, checksum: doc.contentChecksum, lastOpened: Date.now() },
        ...(g.recentFiles || []).filter((r) => r.checksum !== doc.contentChecksum)].slice(0, 20);
      // Opening a file also disarms scroll-to-read (like a fresh boot) — the initial scroll/restore
      // of a newly opened document must never count as reading.
      const ng = { ...g, recentFiles, scrollAdvances: false };
      dispatch({ type: 'SET_GLOBAL', global: ng });
      saveGlobal(ng).catch(() => {});
    }
    return tab;
  }, [buildTabData]);

  // Turn a lazy placeholder into a real tab, in place (same id/position), the first time it's
  // opened. Builds the parsed doc from the stored payload + the tracker, then patches the tab.
  const hydrateTab = useCallback(async (id) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id);
    if (!tab || !tab.lazy || hydratingRef.current.has(id)) return;
    hydratingRef.current.add(id);
    dispatch({ type: 'SET_STATUS', text: `Opening ${tab.fileName}…` });
    try {
      const rec = await loadDocPayload(tab.checksum);
      if (!rec?.fullText) {
        dispatch({ type: 'SET_STATUS', text: `Couldn’t load ${tab.fileName} — its saved copy is missing.` });
        return;
      }
      const doc = readerDocFromText(rec.fullText, rec.fileName || tab.fileName || 'Document');
      if (rec.source) doc.source = rec.source;
      if (rec.wordToSegment) doc.wordToSegment = rec.wordToSegment;
      if (rec.segmentCount) doc.segmentCount = rec.segmentCount;
      await attachChecksum(doc);
      const { baseSettings, tracker, groupNote } = await buildTabData(doc);
      dispatch({
        type: 'PATCH_TAB',
        id,
        patch: {
          lazy: false,
          doc,
          settings: { ...baseSettings, totalWords: doc.words.length, contentChecksum: doc.contentChecksum },
          tracker,
          sessionStartTs: Date.now(),
          sessionLinesRead: new Set(),
          sessionNavLinesRead: new Set(),
          readLinesAllTime: new Set(),
          findQuery: '', findResults: [], findIndex: -1,
        },
      });
      if (stateRef.current.incognito) dispatch({ type: 'SNAP_INCOGNITO_TAB', id, wordIndex: baseSettings.wordIndex });
      dispatch({ type: 'SET_STATUS', text: `Opened ${doc.fileName} (${doc.words.length} words)${groupNote}` });
    } catch (e) {
      dispatch({ type: 'SET_STATUS', text: `Couldn’t open ${tab.fileName}: ${e?.message || e}` });
    } finally {
      hydratingRef.current.delete(id);
    }
  }, [buildTabData]);

  // Open a file from the Open-Recent list: focus it if already open/restored, else rebuild it from
  // the persisted doc payload. Returns silently if the saved copy is gone. (Declared after hydrateTab
  // because it calls it.)
  const openRecent = useCallback(async (checksum) => {
    const existing = stateRef.current.tabs.find((t) => (t.lazy ? t.checksum : t.doc?.contentChecksum) === checksum);
    if (existing) { dispatch({ type: 'SET_ACTIVE_TAB', id: existing.id }); if (existing.lazy) await hydrateTab(existing.id); return; }
    const rec = await loadDocPayload(checksum);
    if (!rec?.fullText) { dispatch({ type: 'SET_STATUS', text: 'That file’s saved copy is no longer available.' }); return; }
    const doc = readerDocFromText(rec.fullText, rec.fileName || 'Document');
    if (rec.source) doc.source = rec.source;
    if (rec.wordToSegment) doc.wordToSegment = rec.wordToSegment;
    if (rec.segmentCount) doc.segmentCount = rec.segmentCount;
    await attachChecksum(doc);
    await openDoc(doc);
  }, [openDoc, hydrateTab]);

  // Throttled persistence of reading state: mask → readstate store, counters/daily → settings
  // (so the Statistics / History dialogs, which read FileSettings, see real data).
  const flushReadState = useCallback((tab) => {
    if (stateRef.current.incognito) return; // incognito: never write reading state
    const tr = tab?.tracker;
    if (!tr || !tr.dirty) return;
    saveReadState(tab.doc.contentChecksum, {
      maskB64: tr.serializeMask(),
      wpmB64: tr.serializeWpm(),
      srcB64: tr.serializeSrc(),
      lifetimeActiveMs: tr.lifetimeActiveMs,
      daily: tr.dailyArray(),
      paraTsB64: tr.serializeParaTs(),
    }).catch(() => {});
    dispatch({
      type: 'PATCH_SETTINGS',
      id: tab.id,
      patch: {
        persistentWordsRead: tr.readCount,
        persistentActiveTimeSecs: Math.round(tr.lifetimeActiveMs / 1000),
        dailyHistory: tr.dailyArray().map((d) => ({
          date: d.date,
          wordsRead: d.words,
          activeTimeSecs: Math.round(d.ms / 1000),
        })),
      },
    });
    tr.markSaved();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      for (const tab of stateRef.current.tabs) flushReadState(tab);
    }, 5000);
    const onUnload = () => {
      for (const tab of stateRef.current.tabs) flushReadState(tab);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [flushReadState]);

  // Reconnect to the previous session: reopen the tabs that were open last time. Runs once,
  // only in the primary instance (a duplicate tab never mounts this provider).
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    (async () => {
      try {
        // Read the persisted globals directly so the restore decision doesn't race the separate
        // global-load effect. startOnLanding: leave no tab active (don't reveal text on launch).
        // lazyTabsMobile + compact screen: build placeholders and defer the heavy parse until open.
        const g = await loadGlobal();
        const startLanding = g.startOnLanding !== false;
        const lazy = g.lazyTabsMobile !== false && isCompactScreen();
        const sess = await loadSession();
        if (!sess || !Array.isArray(sess.open) || !sess.open.length) return;

        if (lazy) {
          const placeholders = [];
          for (const entry of sess.open) {
            if (!entry?.checksum) continue;
            const stored = await loadFile(entry.checksum); // small settings record only — no doc parse
            placeholders.push(makeLazyTab({
              checksum: entry.checksum,
              fileName: entry.fileName || stored?.fileName || 'Document',
              wordIndex: stored?.wordIndex || 0,
              totalWords: stored?.totalWords || 0,
            }));
          }
          if (!placeholders.length) return;
          let activeId = null;
          if (!startLanding) {
            const act = placeholders.find((p) => p.checksum === sess.active) || placeholders[placeholders.length - 1];
            activeId = act?.id ?? null; // App hydrates this lazy tab on render
          }
          dispatch({ type: 'RESTORE_TABS', tabs: placeholders, activeId });
          dispatch({ type: 'SET_STATUS', text: `Reconnected — ${placeholders.length} file(s) ready. Open a tab to load it.` });
          return;
        }

        const opened = [];
        for (const entry of sess.open) {
          try {
            const rec = await loadDocPayload(entry.checksum);
            if (!rec?.fullText) continue;
            const doc = readerDocFromText(rec.fullText, rec.fileName || 'Document');
            if (rec.source) doc.source = rec.source;
            if (rec.wordToSegment) doc.wordToSegment = rec.wordToSegment;
            if (rec.segmentCount) doc.segmentCount = rec.segmentCount;
            await attachChecksum(doc);
            const tab = await openDoc(doc, { silent: true, persist: false });
            opened.push({ checksum: doc.contentChecksum, id: tab.id });
          } catch { /* skip a doc that can't be rebuilt */ }
        }
        if (opened.length) {
          if (startLanding) {
            dispatch({ type: 'SET_ACTIVE_TAB', id: null }); // openDoc activated each — reset to landing
            dispatch({ type: 'SET_STATUS', text: `Reconnected — restored ${opened.length} file(s). Pick a tab to start.` });
          } else {
            const act = opened.find((o) => o.checksum === sess.active) || opened[opened.length - 1];
            dispatch({ type: 'SET_ACTIVE_TAB', id: act.id });
            dispatch({ type: 'SET_STATUS', text: `Reconnected — restored ${opened.length} file(s).` });
          }
        }
      } finally {
        sessionReady.current = true;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the open-tab session whenever it changes (after the restore pass completes, so the
  // initial empty state can't wipe a saved session before it's read back).
  useEffect(() => {
    if (!sessionReady.current) return;
    if (state.incognito) return; // incognito: don't record the open-tab session
    const open = state.tabs.map((t) => (
      t.lazy ? { checksum: t.checksum, fileName: t.fileName } : { checksum: t.doc.contentChecksum, fileName: t.doc.fileName }
    ));
    const activeT = state.tabs.find((t) => t.id === state.activeTabId) || null;
    const active = activeT ? (activeT.lazy ? activeT.checksum : activeT.doc.contentChecksum) : null;
    saveSession({ open, active }).catch(() => {});
  }, [state.tabs, state.activeTabId]);

  const openFile = useCallback(async (file) => {
    dispatch({ type: 'SET_STATUS', text: `Parsing ${file.name}…` });
    // Import wizard: stream parser phases into state.importing; end on a summary card with the
    // detected structure + suggested next steps (or clear on failure).
    dispatch({ type: 'SET_IMPORT', payload: { fileName: file.name, phase: 'Reading file' } });
    try {
      const doc = await parseFile(file, (p) => dispatch({ type: 'SET_IMPORT', payload: { fileName: file.name, ...p } }));
      dispatch({ type: 'SET_IMPORT', payload: { fileName: file.name, phase: 'Opening tab' } });
      await openDoc(doc);
      const exactToc = !!doc.tocEntries?.length;
      dispatch({
        type: 'SET_IMPORT',
        payload: {
          fileName: file.name,
          complete: true, // NOT `done` — parsers report page/section progress as { done: n, total },
          words: doc.words.length,
          lines: doc.lines.length,
          tocCount: exactToc ? doc.tocEntries.length : 0,
          exactToc,
          hasSource: !!doc.source,
          sections: doc.segmentCount || 0,
        },
      });
    } catch (e) {
      console.error(e);
      dispatch({ type: 'SET_IMPORT', payload: null });
      dispatch({ type: 'SET_STATUS', text: `Failed to open ${file.name}: ${e.message}` });
    }
  }, [openDoc]);

  // Open one or many files. A single file keeps the full import wizard (structure summary + suggested
  // processing). Multiple files open as their own tabs behind one combined progress bar — no per-file
  // summary card to click through — then activate the first opened tab.
  const openFiles = useCallback(async (fileList) => {
    const files = (fileList instanceof File ? [fileList] : [...(fileList || [])]).filter(Boolean);
    if (files.length === 0) return;
    if (files.length === 1) { await openFile(files[0]); return; }
    let firstTab = null, opened = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const prog = (p) => dispatch({ type: 'SET_IMPORT', payload: { fileName: f.name, phase: `${i + 1}/${files.length} · ${(p && p.phase) || f.name}`, done: i, total: files.length } });
      prog(null);
      try {
        const doc = await parseFile(f, prog);
        const tab = await openDoc(doc, { silent: true });
        if (!firstTab) firstTab = tab;
        opened++;
      } catch (e) { console.error(e); }
    }
    dispatch({ type: 'SET_IMPORT', payload: null });
    if (firstTab) dispatch({ type: 'SET_ACTIVE_TAB', id: firstTab.id });
    dispatch({ type: 'SET_STATUS', text: `Opened ${opened} of ${files.length} document${files.length === 1 ? '' : 's'}.` });
  }, [openFile, openDoc]);

  const openClipboard = useCallback(async () => {
    try {
      const doc = await parseClipboardText();
      await openDoc(doc);
    } catch (e) {
      console.error(e);
      dispatch({ type: 'SET_STATUS', text: `Clipboard read failed: ${e.message}` });
    }
  }, [openDoc]);

  const closeTab = useCallback((id) => {
    dispatch({ type: 'CLOSE_TAB', id });
  }, []);

  const closeAllTabs = useCallback(() => {
    dispatch({ type: 'CLOSE_ALL_TABS' });
  }, []);

  const setActiveTab = useCallback(async (id) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id);
    if (tab?.lazy) await hydrateTab(id); // build the document the first time this tab is opened
    dispatch({ type: 'SET_ACTIVE_TAB', id });
  }, [hydrateTab]);

  const patchSettings = useCallback((id, patch) => {
    dispatch({ type: 'PATCH_SETTINGS', id, patch });
  }, []);

  const patchTab = useCallback((id, patch) => {
    dispatch({ type: 'PATCH_TAB', id, patch });
  }, []);

  const setStatus = useCallback((text) => dispatch({ type: 'SET_STATUS', text }), []);

  const openDialog = useCallback((dialog) => dispatch({ type: 'OPEN_DIALOG', dialog }), []);
  const closeDialog = useCallback(() => dispatch({ type: 'CLOSE_DIALOG' }), []);
  const setActivePanel = useCallback((id) => {
    // Clicking the already-focused tab minimizes it (back to reading); otherwise focus it.
    dispatch({ type: 'SET_ACTIVE_PANEL', id: stateRef.current.activePanelId === id ? null : id });
  }, []);
  const closePanel = useCallback((id) => dispatch({ type: 'CLOSE_PANEL', id }), []);
  const reorderTabs = useCallback((fromId, toId) => dispatch({ type: 'REORDER_TABS', fromId, toId }), []);

  const updateGlobal = useCallback(async (patch) => {
    const g = { ...stateRef.current.global, ...patch };
    // Stamp the settings-sync clock only when a synced setting actually changed (not on sync metadata
    // or data-library churn) — otherwise lastSync writes would keep this device "newest" forever and
    // it would never adopt another device's settings.
    if (Object.keys(patch).some(isSyncedGlobalKey)) g.settingsUpdatedAt = Date.now();
    dispatch({ type: 'SET_GLOBAL', global: g });
    await saveGlobal(g);
  }, []);

  const value = {
    state,
    activeTab,
    dispatch,
    openFile,
    openFiles,
    openClipboard,
    openDoc,
    openRecent,
    hydrateTab,
    closeTab,
    closeAllTabs,
    setActiveTab,
    patchSettings,
    patchTab,
    setStatus,
    openDialog,
    closeDialog,
    setActivePanel,
    closePanel,
    reorderTabs,
    updateGlobal,
    flushReadState,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
