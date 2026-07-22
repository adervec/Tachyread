import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { THEME_CATEGORIES } from '../state/themes.js';
import { countOffDefaultSettings, defaultFileSettings } from '../state/settings.js';
import { useIsCompact } from '../state/device.js';
import { allFiles } from '../state/storage.js';
import { finishedNotRereading } from '../features/recentFilter.js';

// Theme <select> options grouped by category (shared by the desktop and compact theme pickers).
function ThemeOptions() {
  return THEME_CATEGORIES.map((g) => (
    <optgroup key={g.label} label={g.label}>
      {g.themes.map((n) => <option key={n} value={n}>{n}</option>)}
    </optgroup>
  ));
}

const MENUS = {
  file: [
    { label: 'Open TXT...', shortcut: 'Ctrl+O', action: 'open-txt' },
    { label: 'Open Document (PDF, EPUB, HTML, DOCX, MD)...', shortcut: 'Ctrl+D', action: 'open-doc' },
    { label: 'Open HTML (choose content region)...', action: 'open-html-pick' },
    { label: 'Open from Clipboard', shortcut: 'Ctrl+B', action: 'open-clip' },
    { label: 'Grab Text (OCR)...', shortcut: 'Ctrl+Shift+G', action: 'grab' },
    { label: 'Grab from Web URL...', action: 'web-grab' },
    { label: 'Save Tab Text...', action: 'save-tab' },
    { label: 'HTML Tools (guide & print to HTML)...', action: 'html-tools' },
    { kind: 'separator' },
    { label: 'Find...', shortcut: 'Ctrl+F', action: 'find' },
    { label: 'Go to Line...', shortcut: 'Ctrl+G', action: 'goto' },
    { label: 'Close Tab', action: 'close-tab' },
    { label: 'Close All Tabs', action: 'close-all' },
    { kind: 'separator' },
    { label: 'Disconnect (keep session for next time)', action: 'disconnect' },
    { label: 'Shut Down (close all, start clean next time)', action: 'shutdown' },
  ],
  // What's on screen right now.
  view: [
    { label: 'Notes & Annotations...', shortcut: 'Ctrl+Shift+N', action: 'notes' },
    { label: 'Show / Hide Lines Pane', action: 'toggle-lines' },
    { label: 'Proper Names Index...', shortcut: 'Ctrl+I', action: 'proper-names' },
    { label: 'Preview Footnote', shortcut: 'Ctrl+Shift+F', action: 'footnote' },
    { label: 'Incognito Reading (no tracking)', action: 'toggle-incognito' },
    { label: 'Reading Cursor & Trail...', action: 'cursor-manager' },
    { label: 'Face Library...', action: 'face-library' },
  ],
  // Drills & practice.
  train: [
    { label: 'Eye Warmup...', action: 'eye-warmup' },
    { label: 'Span Drill...', action: 'span-drill' },
    { label: 'Dictation (speak to write)...', action: 'dictation' },
    { label: 'Vocabulary...', action: 'vocab' },
    { kind: 'separator' },
    { label: 'Take a Break Now', action: 'take-break' },
  ],
  // Progress & analytics.
  stats: [
    { label: 'Statistics...', shortcut: 'Ctrl+T', action: 'stats' },
    { label: 'Progress Detail...', action: 'progress-detail' },
    { label: 'Regression Report...', action: 'regressions' },
    { label: 'Attention Check...', action: 'attention' },
    { label: 'Reading History...', shortcut: 'Ctrl+H', action: 'history' },
    { label: 'Trackyread (Reading Tracker)...', action: 'literary-journey' },
    { label: 'This Book in Trackyread...', action: 'trackyread-book' },
    { label: 'API Usage & Spend...', action: 'api-usage' },
  ],
  // Document-resource generators.
  tools: [
    { label: 'Generate Contents (Wizard)...', action: 'toc-wizard' },
    { label: 'Generate Proper Names (Wizard)...', action: 'names-wizard' },
    { label: 'Generate Index (Wizard)...', action: 'index-wizard' },
    { label: 'Locate Footnotes (Wizard)...', action: 'notes-wizard' },
  ],
  typing: [
    { label: 'Typing Practice', action: 'typing' },
    { label: 'Flow Writer...', action: 'flow-writer' },
    { label: 'Typing Plans...', action: 'typing-plans' },
    { label: 'Typing Progress...', action: 'typing-progress' },
    { kind: 'separator' },
    { label: 'Typing Settings...', action: 'typing-settings' },
  ],
  audio: [
    { label: 'Audiobook Manager...', shortcut: 'Ctrl+Shift+A', action: 'audiobook' },
    { label: 'Text-to-Speech Reader...', shortcut: 'Ctrl+Shift+T', action: 'tts-popup' },
    { label: 'Ambient Sound...', action: 'ambient' },
    { kind: 'separator' },
    { label: 'Audio Settings...', action: 'audio-settings' },
  ],
  settings: [
    { label: 'Tab Settings...', shortcut: 'Ctrl+,', action: 'tab-settings' },
    { label: 'Application Settings...', action: 'app-settings' },
    { label: 'Default Tab Settings...', action: 'def-settings' },
    { label: 'Reset Tab to Default Settings', action: 'reset-tab' },
    { label: 'Apply Default Settings to All Tabs', action: 'apply-defaults-all' },
    { kind: 'separator' },
    { label: 'Font Manager...', action: 'font-manager' },
    { label: 'Biometric Controls...', action: 'biometric-settings' },
    { label: 'Comfort & Breaks...', action: 'comfort-settings' },
    { kind: 'separator' },
    { label: 'Data Management...', action: 'data' },
    { label: 'Book Groups...', action: 'book-groups' },
  ],
  help: [
    { label: 'Help...', shortcut: 'F1', action: 'help' },
    { label: 'About / Disclaimer...', action: 'disclaimer' },
  ],
};

// Menu-bar order + display titles (desktop dropdowns and the mobile drawer sections).
const MENU_ORDER = [
  ['file', 'File'],
  ['view', 'View'],
  ['train', 'Train'],
  ['stats', 'Stats'],
  ['tools', 'Tools'],
  ['typing', 'Typing'],
  ['audio', 'Audio'],
  ['settings', 'Settings'],
  ['help', 'Help'],
];
const MENU_TITLE = Object.fromEntries(MENU_ORDER);

// One menu entry (file/view list) rendered as a drawer/dropdown row. `badges` optionally maps an
// action → a small count shown as a pill (e.g. how many tab settings differ from the defaults).
function MenuItem({ it, onPick, badges }) {
  if (it.kind === 'separator') return <div className="separator" />;
  const badge = badges?.[it.action];
  return (
    <div className="item" onClick={() => onPick(it.action)}>
      <span>{it.label}</span>
      {badge ? <span className="menu-badge" title={`${badge} setting${badge === 1 ? '' : 's'} differ from your defaults`}>{badge}</span> : null}
      {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
    </div>
  );
}


// Open-recent list appended to the File menu — reopens a persisted document by its checksum.
// Shows the top 12; "Show all" expands to the full remembered list (scrolls inside the menu).
function RecentFiles({ recent, onPick }) {
  const [all, setAll] = useState(false);
  const shown = all ? recent : recent.slice(0, 12);
  return (
    <>
      <div className="separator" />
      <div className="menu-sub-head">Open recent</div>
      {recent.length === 0
        ? <div className="item menu-recent-empty"><span>No recent files</span></div>
        : (
          <div className={`menu-recent-list${all ? ' expanded' : ''}`}>
            {shown.map((r) => (
              <div key={r.checksum} className="item menu-recent" onClick={() => onPick(r.checksum)} title={r.name}>
                <span className="menu-recent-name">{r.name}</span>
              </div>
            ))}
          </div>
        )}
      {recent.length > 12 && (
        <div className="item menu-recent-more" onClick={(e) => { e.stopPropagation(); setAll((v) => !v); }}>
          <span>{all ? '▴ Show top 12' : `▾ Show all (${recent.length})`}</span>
        </div>
      )}
    </>
  );
}

// Quick reading-font picker for the top bar: very legible picks, common system fonts, and your
// recently used ones. The full searchable catalogue stays in Settings → Font Manager.
const QUICK_FONTS_LEGIBLE = [
  ["'Lexend', sans-serif", 'Lexend'],
  ["'Atkinson Hyperlegible', sans-serif", 'Atkinson Hyperlegible'],
  ["'OpenDyslexic', 'Comic Sans MS', sans-serif", 'OpenDyslexic'],
  ["Verdana, sans-serif", 'Verdana'],
];
const QUICK_FONTS_COMMON = [
  ['Arial, sans-serif', 'Arial'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ['Georgia, serif', 'Georgia'],
  ["Garamond, 'EB Garamond', serif", 'Garamond'],
  ['Tahoma, sans-serif', 'Tahoma'],
  ["'Courier New', monospace", 'Courier New'],
];
function FontQuickPick({ activeTab, patchSettings, global, updateGlobal }) {
  const current = activeTab?.settings?.fontFamily || '';
  const recents = (global.recentFonts || []).filter((r) => r && r.stack);
  const pick = (v) => {
    if (!activeTab) return;
    patchSettings(activeTab.id, { fontFamily: v });
    if (!v) return;
    const label = [...QUICK_FONTS_LEGIBLE, ...QUICK_FONTS_COMMON].find(([s]) => s === v)?.[1]
      || recents.find((r) => r.stack === v)?.label
      || v.split(',')[0].replace(/['"]/g, '');
    updateGlobal({ recentFonts: [{ stack: v, label }, ...recents.filter((r) => r.stack !== v)].slice(0, 6) });
  };
  const known = new Set([...QUICK_FONTS_LEGIBLE, ...QUICK_FONTS_COMMON].map(([s]) => s).concat(recents.map((r) => r.stack)));
  return (
    <select
      className="menu-font-pick"
      value={current}
      disabled={!activeTab}
      title="Reading font — legible / common / recent picks (full catalogue in Settings → Font Manager)"
      aria-label="Reading font"
      onChange={(e) => pick(e.target.value)}
    >
      <option value="">Font: theme</option>
      {current && !known.has(current) && <option value={current}>{current.split(',')[0].replace(/['"]/g, '')}</option>}
      {recents.length > 0 && (
        <optgroup label="Recent">
          {recents.map((r) => <option key={`r-${r.stack}`} value={r.stack}>{r.label}</option>)}
        </optgroup>
      )}
      <optgroup label="Very legible">
        {QUICK_FONTS_LEGIBLE.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
      </optgroup>
      <optgroup label="Common">
        {QUICK_FONTS_COMMON.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
      </optgroup>
    </select>
  );
}

export default function MenuBar({ onFileOpen, onAction }) {
  const { state, dispatch, activeTab, patchSettings, updateGlobal } = useApp();
  // Open Recent drops finished books that aren't being reread. Finished state lives in per-file
  // records (IndexedDB), so the hide-set loads when a menu opens; until then the list is unfiltered.
  const [hiddenRecent, setHiddenRecent] = useState(null);
  const recent = (state.global.recentFiles || []).filter((r) => !hiddenRecent?.has(r.checksum));
  const isCompact = useIsCompact();
  const themeName =
    activeTab?.settings?.themeName || (activeTab?.settings?.darkMode ? 'Dark' : 'Light');
  const [openMenu, setOpenMenu] = useState(null);
  const [sub, setSub] = useState(null); // mobile drawer: which submenu is drilled into (null = top level)
  const ref = useRef(null);

  // Badge the "Tab Settings…" item with how many of the active tab's settings differ from the
  // user's Default Tab Settings (so it's visible at a glance that the tab has been customised).
  const offCount = activeTab && !activeTab.lazy && activeTab.settings
    ? countOffDefaultSettings(activeTab.settings, state.global?.fileDefaults || defaultFileSettings())
    : 0;
  const badges = offCount > 0 ? { 'tab-settings': offCount } : null;

  useEffect(() => {
    // pointerdown (not click): a menu item that re-renders on tap (mobile drill-in) detaches its
    // node before a bubbled 'click' runs, which would read as an outside click and close the menu.
    // isConnected guards the same race for any late-firing event.
    function onDoc(e) {
      if (e.target.isConnected && !ref.current?.contains(e.target)) { setOpenMenu(null); setSub(null); }
    }
    if (openMenu) document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [openMenu]);

  // Refresh the finished-book hide-set each time a menu opens (finishing/rereading happens
  // between opens, not during one).
  useEffect(() => {
    if (!openMenu) return;
    let alive = true;
    allFiles().then((files) => {
      if (!alive) return;
      const shelves = state.global.readingList?.shelves || {};
      setHiddenRecent(new Set(
        files.filter((f) => finishedNotRereading(f, shelves[f.checksum])).map((f) => f.checksum)));
    }).catch(() => {}); // storage unavailable → keep list unfiltered
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenu]);

  function chooseFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true; // select several at once → each opens as its own tab
    input.accept = '.txt,.md,.csv,.log';
    input.onchange = () => input.files?.length && onFileOpen(input.files);
    input.click();
  }
  function chooseDoc() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.docx,.pdf,.epub,.txt,.md,.markdown,.html,.htm';
    input.onchange = () => input.files?.length && onFileOpen(input.files);
    input.click();
  }

  function handle(action) {
    setOpenMenu(null);
    setSub(null);
    if (action === 'open-txt') chooseFile();
    else if (action === 'open-doc') chooseDoc();
    else onAction(action);
  }
  function closeDrawer() { setOpenMenu(null); setSub(null); }

  // Compact (phone/tablet) menu: a single hamburger that opens a scrollable drawer with the panel
  // toggles, the full File/View lists, theme, and Sync — instead of a desktop menu bar that wraps.
  if (isCompact) {
    const open = openMenu === 'mobile';
    return (
      <div className="menu-bar compact" ref={ref}>
        <button
          className={`menu-burger${open ? ' open' : ''}`}
          onClick={() => (open ? closeDrawer() : setOpenMenu('mobile'))}
          aria-expanded={open}
          aria-label="Menu"
        >
          ☰ Menu
        </button>
        <div className="grow" />
        <FontQuickPick activeTab={activeTab} patchSettings={patchSettings} global={state.global} updateGlobal={updateGlobal} />
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title="Smaller reading font"
          aria-label="Smaller reading font"
          onClick={() => activeTab && patchSettings(activeTab.id, { rightPaneFontSize: Math.max(8, (activeTab.settings.rightPaneFontSize || 12) - 1) })}
        >
          A−
        </button>
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title="Larger reading font"
          aria-label="Larger reading font"
          onClick={() => activeTab && patchSettings(activeTab.id, { rightPaneFontSize: Math.min(60, (activeTab.settings.rightPaneFontSize || 12) + 1) })}
        >
          A+
        </button>
        <select
          className="menu-theme-compact"
          value={themeName}
          disabled={!activeTab}
          title="Reading theme for the current tab"
          aria-label="Theme"
          onChange={(e) => activeTab && patchSettings(activeTab.id, { themeName: e.target.value })}
        >
          <ThemeOptions />
        </select>
        {open && <div className="menu-scrim" onClick={closeDrawer} aria-hidden="true" />}
        {open && (
          <div className="menu-drawer">
            {sub === null ? (
              // Top level: a short list of menus to drill into (so the whole menu tree isn't one
              // long scroll). The reader-area toggles live on the top bar with rotate/lock, not here.
              <>
                <div className="menu-drawer-section">Menus</div>
                {/* Tap-friendly tile grid (not a list) — bigger targets, two per row. */}
                <div className="menu-cat-grid">
                  {MENU_ORDER.map(([key, title]) => (
                    <div key={key} className="item menu-cat" onClick={() => setSub(key)}>
                      <span>{title}</span>
                      <span className="menu-cat-caret">›</span>
                    </div>
                  ))}
                  <div className="item menu-cat" onClick={() => { closeDrawer(); onAction('data'); }}>
                    <span>☁ Data</span>
                  </div>
                </div>
              </>
            ) : (
              // Drilled into one menu: back header + that menu's items only, as a tile grid.
              <>
                <div className="menu-drawer-back" onClick={() => setSub(null)}>‹ All menus</div>
                <div className="menu-drawer-section">{MENU_TITLE[sub] || sub}</div>
                <div className="menu-item-grid">
                  {MENUS[sub].map((it, i) => <MenuItem key={i} it={it} onPick={handle} badges={badges} />)}
                </div>
                {sub === 'file' && <RecentFiles recent={recent} onPick={(cs) => handle('open-recent:' + cs)} />}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="menu-bar" ref={ref}>
      {MENU_ORDER.map(([key, title]) => (
        <div
          key={key}
          className={`menu-item ${openMenu === key ? 'open' : ''}`}
          onClick={() => setOpenMenu(openMenu === key ? null : key)}
        >
          {title}
          {openMenu === key && (
            <div className="menu-dropdown">
              {MENUS[key].map((it, i) => <MenuItem key={i} it={it} onPick={handle} badges={badges} />)}
              {key === 'file' && <RecentFiles recent={recent} onPick={(cs) => handle('open-recent:' + cs)} />}
            </div>
          )}
        </div>
      ))}
      <div
        className={`menu-item ${state.showToc ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_TOC' })}
        title="Toggle Table of Contents panel"
      >
        {state.showToc ? '☑ ' : '☐ '}ToC<kbd className="key-hint">3</kbd>
      </div>
      <div
        className={`menu-item ${activeTab?.settings?.showEyes ? 'open' : ''}`}
        onClick={() => activeTab && patchSettings(activeTab.id, { showEyes: !activeTab.settings.showEyes })}
        title="Toggle the animated reader faces"
      >
        {activeTab?.settings?.showEyes ? '☑ ' : '☐ '}Faces<kbd className="key-hint">6</kbd>
      </div>
      <div
        className={`menu-item ${state.showStats ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_STATS' })}
        title="Toggle the reading-stats panel"
      >
        {state.showStats ? '☑ ' : '☐ '}Stats<kbd className="key-hint">4</kbd>
      </div>
      <div
        className={`menu-item ${state.global.chipMode ? 'open' : ''}`}
        onClick={() => updateGlobal({ chipMode: !state.global.chipMode })}
        title="Chip mode: float the face, stats, goal and timer as transparent draggable chips instead of docking them"
      >
        {state.global.chipMode ? '☑ ' : '☐ '}Chips
      </div>
      {activeTab?.doc?.source && (
        <div
          className={`menu-item ${state.showSource ? 'open' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_SOURCE' })}
          title="Show the original PDF page / EPUB section side-by-side"
        >
          {state.showSource ? '☑ ' : '☐ '}Source
        </div>
      )}
      <div
        className={`menu-item ${state.showIndex ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_INDEX' })}
        title="Toggle Index panel"
      >
        {state.showIndex ? '☑ ' : '☐ '}Index<kbd className="key-hint">5</kbd>
      </div>
      <div
        className={`menu-item ${state.showRsvp ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_SHOW_RSVP' })}
        title="Show the Fast Reader pane"
      >
        {state.showRsvp ? '☑ ' : '☐ '}Fast Reader<kbd className="key-hint">1</kbd>
      </div>
      <div
        className={`menu-item ${state.showLines !== false ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_LINES' })}
        title="Show the Lines pane"
      >
        {state.showLines !== false ? '☑ ' : '☐ '}Lines<kbd className="key-hint">2</kbd>
      </div>
      <div
        className={`menu-item incognito-menu ${state.incognito ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_INCOGNITO' })}
        title="Incognito reading — pause all tracking and persistence"
      >
        {state.incognito ? '🕶 ' : '☐ '}Incognito<kbd className="key-hint">I</kbd>
      </div>
      <div className="grow" />
      <div className="right-toggles">
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title="Full-screen Lines reading — fills the screen with the Lines pane and hides all chrome (Esc to exit)"
          aria-label="Full-screen Lines reading"
          onClick={() => onAction('fullscreen-lines')}
        >
          ⛶
        </button>
        <FontQuickPick activeTab={activeTab} patchSettings={patchSettings} global={state.global} updateGlobal={updateGlobal} />
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title="Smaller reading font (Lines pane)"
          aria-label="Smaller reading font"
          onClick={() => activeTab && patchSettings(activeTab.id, { rightPaneFontSize: Math.max(8, (activeTab.settings.rightPaneFontSize || 12) - 1) })}
        >
          A−
        </button>
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title="Larger reading font (Lines pane)"
          aria-label="Larger reading font"
          onClick={() => activeTab && patchSettings(activeTab.id, { rightPaneFontSize: Math.min(60, (activeTab.settings.rightPaneFontSize || 12) + 1) })}
        >
          A+
        </button>
        <label htmlFor="theme-select">Theme</label>
        <select
          id="theme-select"
          value={themeName}
          disabled={!activeTab}
          title="Reading theme for the current tab"
          onChange={(e) => activeTab && patchSettings(activeTab.id, { themeName: e.target.value })}
        >
          <ThemeOptions />
        </select>
      </div>
    </div>
  );
}
