import { createContext, useContext, useEffect, useReducer, useRef, useCallback } from 'react';
import { defaultFileSettings, defaultGlobalSettings } from './settings.js';
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
const compactStart = typeof window !== 'undefined' && window.innerWidth <= 860;

const init = {
  global: defaultGlobalSettings(),
  tabs: [],
  activeTabId: null,
  appStatus: 'Ready.',
  dialog: null, // {kind, props}
  showRsvp: true,
  showToc: false,
  showDash: !compactStart,
  showSource: false,
  showIndex: false,
  hideMode: 'None',
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_GLOBAL':
      return { ...state, global: action.global };
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
      return { ...state, tabs, activeTabId: active };
    }
    case 'CLOSE_ALL_TABS':
      return { ...state, tabs: [], activeTabId: null };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabId: action.id };
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
    case 'OPEN_DIALOG':
      return { ...state, dialog: action.dialog };
    case 'CLOSE_DIALOG':
      return { ...state, dialog: null };
    case 'TOGGLE_SHOW_RSVP':
      return { ...state, showRsvp: !state.showRsvp };
    case 'TOGGLE_TOC':
      return { ...state, showToc: !state.showToc };
    case 'TOGGLE_DASH':
      return { ...state, showDash: !state.showDash };
    case 'TOGGLE_SOURCE':
      return { ...state, showSource: !state.showSource };
    case 'TOGGLE_INDEX':
      return { ...state, showIndex: !state.showIndex };
    case 'SET_HIDE_MODE':
      return { ...state, hideMode: action.mode };
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
      dispatch({ type: 'SET_GLOBAL', global: g });
    })();
  }, []);

  // Persist tab settings on changes (debounced). Only tabs whose settings object actually changed
  // since the last save are written — during reading just the active tab changes, so this avoids
  // re-serialising every open document's settings to IndexedDB on each word step (a real cost with
  // several large books open on a phone).
  const saveTimer = useRef(null);
  const savedSettingsRef = useRef(new Map()); // tab.id -> last-saved settings reference
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const live = new Set();
      for (const tab of state.tabs) {
        live.add(tab.id);
        if (tab.lazy) continue; // placeholder — its settings shell must not overwrite the stored record
        if (savedSettingsRef.current.get(tab.id) === tab.settings) continue; // unchanged → skip
        savedSettingsRef.current.set(tab.id, tab.settings);
        saveFile(tab.settings).catch(() => {});
      }
      for (const id of [...savedSettingsRef.current.keys()]) if (!live.has(id)) savedSettingsRef.current.delete(id);
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
    // Clamp wordIndex if it overruns the new doc length
    if (baseSettings.wordIndex >= doc.words.length)
      baseSettings.wordIndex = Math.max(0, doc.words.length - 1);
    // Reading tracker, seeded from the persisted read mask + lifetime active time.
    const rs = await loadReadState(doc.contentChecksum);
    const tracker = createReadingTracker({
      wordCount: doc.words.length,
      maskB64: rs?.maskB64 || '',
      wpmB64: rs?.wpmB64 || '',
      lifetimeActiveMs: rs?.lifetimeActiveMs || 0,
      daily: rs?.daily || [],
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
        saveReadState(doc.contentChecksum, {
          maskB64: tracker.serializeMask(), wpmB64: tracker.serializeWpm(),
          lifetimeActiveMs: tracker.lifetimeActiveMs, daily: tracker.dailyArray(),
        }).catch(() => {});
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
    // Persist a rebuildable payload so this tab can be reconnected next session.
    if (persist) {
      saveDocPayload({
        checksum: doc.contentChecksum,
        fileName: doc.fileName,
        fullText: doc.fullText,
        source: doc.source || null,
        wordToSegment: doc.wordToSegment || null,
        segmentCount: doc.segmentCount || 0,
      }).catch(() => {});
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
      dispatch({ type: 'SET_STATUS', text: `Opened ${doc.fileName} (${doc.words.length} words)${groupNote}` });
    } catch (e) {
      dispatch({ type: 'SET_STATUS', text: `Couldn’t open ${tab.fileName}: ${e?.message || e}` });
    } finally {
      hydratingRef.current.delete(id);
    }
  }, [buildTabData]);

  // Throttled persistence of reading state: mask → readstate store, counters/daily → settings
  // (so the Statistics / History dialogs, which read FileSettings, see real data).
  const flushReadState = useCallback((tab) => {
    const tr = tab?.tracker;
    if (!tr || !tr.dirty) return;
    saveReadState(tab.doc.contentChecksum, {
      maskB64: tr.serializeMask(),
      wpmB64: tr.serializeWpm(),
      lifetimeActiveMs: tr.lifetimeActiveMs,
      daily: tr.dailyArray(),
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
    const open = state.tabs.map((t) => (
      t.lazy ? { checksum: t.checksum, fileName: t.fileName } : { checksum: t.doc.contentChecksum, fileName: t.doc.fileName }
    ));
    const activeT = state.tabs.find((t) => t.id === state.activeTabId) || null;
    const active = activeT ? (activeT.lazy ? activeT.checksum : activeT.doc.contentChecksum) : null;
    saveSession({ open, active }).catch(() => {});
  }, [state.tabs, state.activeTabId]);

  const openFile = useCallback(async (file) => {
    dispatch({ type: 'SET_STATUS', text: `Parsing ${file.name}…` });
    try {
      const doc = await parseFile(file);
      await openDoc(doc);
    } catch (e) {
      console.error(e);
      dispatch({ type: 'SET_STATUS', text: `Failed to open ${file.name}: ${e.message}` });
    }
  }, [openDoc]);

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

  const updateGlobal = useCallback(async (patch) => {
    const g = { ...stateRef.current.global, ...patch };
    dispatch({ type: 'SET_GLOBAL', global: g });
    await saveGlobal(g);
  }, []);

  const value = {
    state,
    activeTab,
    dispatch,
    openFile,
    openClipboard,
    openDoc,
    hydrateTab,
    closeTab,
    closeAllTabs,
    setActiveTab,
    patchSettings,
    patchTab,
    setStatus,
    openDialog,
    closeDialog,
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
