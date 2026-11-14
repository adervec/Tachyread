import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { driveClientId } from '../features/sync/syncProviders.js';
import { fmtDateTime } from '../features/dateFmt.js';
import { THEME_CATEGORIES, tabThemeName } from '../state/themes.js';
import { countOffDefaultSettings, defaultFileSettings } from '../state/settings.js';
import { useIsCompact } from '../state/device.js';
import { allFiles } from '../state/storage.js';
import { finishedNotRereading } from '../features/recentFilter.js';
import { t } from '../i18n.js';

// Theme <select> options grouped by category (shared by the desktop and compact theme pickers).
function ThemeOptions() {
  return THEME_CATEGORIES.map((g) => (
    // i18n-keys: Basic | Editor & code | Nature | Historical & cultural | Decades
    <optgroup key={g.label} label={t(g.label)}>
      {g.themes.map((n) => <option key={n} value={n}>{n}</option>)}
    </optgroup>
  ));
}

const MENUS = {
  file: [
    { label: t('Open TXT...'), shortcut: 'Ctrl+O', action: 'open-txt', icon: '📄'},
    { label: t('Open Document (PDF, EPUB, HTML, DOCX, MD)...'), shortcut: 'Ctrl+D', action: 'open-doc', icon: '📚'},
    { label: t('Open HTML (choose content region)...'), action: 'open-html-pick', icon: '🌐'},
    { label: t('Open Untracked Only (skip what is in Trackyread)...'), action: 'open-untracked', icon: '🆕'},
    { label: t('Open Unfinished Only (skip what is finished)...'), action: 'open-unfinished', icon: '📖'},
    { label: t('Bulk Add from Folder...'), action: 'bulk-add', icon: '📂'},
    { label: t('Add Untracked Files to Trackyread (from folder, nothing stays open)...'), action: 'bulk-track', icon: '🏷️'},
    { label: t('Open from Clipboard'), shortcut: 'Ctrl+B', action: 'open-clip', icon: '📋'},
    { label: t('Export as Bionic EPUB (e-ink)...'), action: 'export-bionic', icon: '📗'},
    { label: t('Grab Text (OCR)...'), shortcut: 'Ctrl+Shift+G', action: 'grab', icon: '📸'},
    { label: t('Grab from Web URL...'), action: 'web-grab', icon: '🕸️'},
    { label: t('Browse Online Catalogs (OPDS)...'), action: 'opds', icon: '🏛️'},
    { label: t('Show File Location...'), action: 'reveal-file', icon: '📁'},
    { label: t('Save Tab Text...'), action: 'save-tab', icon: '💾'},
    { label: t('HTML Tools (guide & print to HTML)...'), action: 'html-tools', icon: '🧰'},
    { kind: 'separator' },
    { label: t('Find...'), shortcut: 'Ctrl+F', action: 'find', icon: '🔎'},
    { label: t('Go to Line...'), shortcut: 'Ctrl+G', action: 'goto', icon: '📍'},
    { label: t('Close Tab'), action: 'close-tab', icon: '❌'},
    { label: t('Close All Tabs'), action: 'close-all', icon: '🧹'},
    { kind: 'separator' },
    { label: t('Disconnect (keep session for next time)'), action: 'disconnect', icon: '🔌'},
    { label: t('Shut Down (close all, start clean next time)'), action: 'shutdown', icon: '🛑'},
  ],
  // What's on screen right now.
  view: [
    { label: t('Notes & Annotations...'), shortcut: 'Ctrl+Shift+N', action: 'notes', icon: '📝'},
    { label: t('Show / Hide Lines Pane'), action: 'toggle-lines', icon: '📃'},
    { label: t('Side-by-Side Companion (read two documents)'), action: 'companion', icon: '📖'},
    { label: t('Teleprompter'), action: 'teleprompter', icon: '🎬'},
    { label: t('Teleprompter (mirrored, for prompter glass)'), action: 'teleprompter-mirror', icon: '🪞'},
    { label: t('Proper Names Index...'), shortcut: 'Ctrl+I', action: 'proper-names', icon: '🏷️'},
    { label: t('Preview Footnote'), shortcut: 'Ctrl+Shift+F', action: 'footnote', icon: '📑'},
    { label: t('Incognito Reading (no tracking)'), action: 'toggle-incognito', icon: '🕶️'},
    { label: t('Reduce Blue Light (bedtime)'), shortcut: 'B', action: 'toggle-bluelight', icon: '🌙'},
    { label: t('Reading Cursor & Trail...'), action: 'cursor-manager', icon: '🖱️'},
    { label: t('Crosshairs (Lines overlays)...'), action: 'crosshairs', icon: '🎯'},
    { label: t('Avatar Library...'), action: 'face-library', icon: '🙂'},
  ],
  // Drills & practice.
  train: [
    { label: t('Eye Warmup...'), action: 'eye-warmup', icon: '👀'},
    { label: t('Span Drill...'), action: 'span-drill', icon: '↔️'},
    { label: t('Dictation (speak to write)...'), action: 'dictation', icon: '🎙️'},
    { label: t('Vocabulary...'), action: 'vocab', icon: '🧠'},
    { label: t('Pronunciation Check...'), action: 'pronounce', icon: '👄'},
    { kind: 'separator' },
    { label: t('Take a Break Now'), action: 'take-break', icon: '☕'},
  ],
  // Progress & analytics.
  stats: [
    { label: t('Statistics...'), shortcut: 'Ctrl+T', action: 'stats', icon: '📊'},
    { label: t('Progress Detail...'), action: 'progress-detail', icon: '📈'},
    { label: t('Regression Report...'), action: 'regressions', icon: '↩️'},
    { label: t('Attention Check...'), action: 'attention', icon: '🧐'},
    { label: t('Reading History...'), shortcut: 'Ctrl+H', action: 'history', icon: '🕰️'},
    { label: t('Trackyread (Reading Tracker)...'), action: 'literary-journey', icon: '🗺️'},
    { label: t('This Book in Trackyread...'), action: 'trackyread-book', icon: '📖'},
    { label: t('API Usage & Spend...'), action: 'api-usage', icon: '💳'},
  ],
  // Document-resource generators.
  tools: [
    { label: t('Generate Contents (Wizard)...'), action: 'toc-wizard', icon: '🧭'},
    { label: t('Generate Proper Names (Wizard)...'), action: 'names-wizard', icon: '🏷️'},
    { label: t('Generate Index (Wizard)...'), action: 'index-wizard', icon: '🔖'},
    { label: t('Locate Footnotes (Wizard)...'), action: 'notes-wizard', icon: '📌'},
  ],
  typing: [
    { label: t('Typing Practice'), action: 'typing', icon: '⌨️'},
    { label: t('Flow Writer...'), action: 'flow-writer', icon: '✍️'},
    { label: t('Typing Plans...'), action: 'typing-plans', icon: '🗓️'},
    { label: t('Typing Progress...'), action: 'typing-progress', icon: '📈'},
    { kind: 'separator' },
    { label: t('Typing Settings...'), action: 'typing-settings', icon: '🎛️'},
  ],
  audio: [
    { label: t('Audiobook Command Centre...'), shortcut: 'Ctrl+Shift+A', action: 'audiobook', icon: '🎧'},
    { label: t('Sync My Audiobook to This Book...'), action: 'audio-sync', icon: '🔗'},
    { label: t('Text-to-Speech Reader...'), shortcut: 'Ctrl+Shift+T', action: 'tts-popup', icon: '🔊'},
    { label: t('Ambient Sound...'), action: 'ambient', icon: '🌊'},
    { kind: 'separator' },
    { label: t('Audio Settings...'), action: 'audio-settings', icon: '🎚️'},
  ],
  settings: [
    { label: t('Tab Settings...'), shortcut: 'Ctrl+,', action: 'tab-settings', icon: '🗂️'},
    { label: t('Application Settings...'), action: 'app-settings', icon: '⚙️'},
    { label: t('Default Tab Settings...'), action: 'def-settings', icon: '🧾'},
    { label: t('Reset Tab to Default Settings'), action: 'reset-tab', icon: '♻️'},
    { label: t('Apply Default Settings to All Tabs'), action: 'apply-defaults-all', icon: '🔁'},
    { kind: 'separator' },
    { label: t('Font Manager...'), action: 'font-manager', icon: '🔤'},
    { label: t('Biometric Controls...'), action: 'biometric-settings', icon: '👁️'},
    { label: t('Comfort & Breaks...'), action: 'comfort-settings', icon: '🛋️'},
    { kind: 'separator' },
    { label: t('Data Management...'), action: 'data', icon: '💽'},
    { label: t('Book Groups...'), action: 'book-groups', icon: '📚'},
  ],
  help: [
    { label: t('Help...'), shortcut: 'F1', action: 'help', icon: '❓'},
    { label: t('Install as App...'), action: 'install-pwa', icon: '⬇️'},
    { label: t('About / Disclaimer...'), action: 'disclaimer', icon: 'ℹ️'},
  ],
};

// Menu-bar order + display titles (desktop dropdowns and the mobile drawer sections).
const MENU_ORDER = [
  ['file', t('File'), '📁'],
  ['view', t('View'), '👁️'],
  ['train', t('Train'), '🏋️'],
  ['stats', t('Stats'), '📊'],
  ['tools', t('Tools'), '🧰'],
  ['typing', t('Typing'), '⌨️'],
  ['audio', t('Audio'), '🔊'],
  ['settings', t('Settings'), '⚙️'],
  ['help', t('Help'), '❓'],
];
const MENU_TITLE = Object.fromEntries(MENU_ORDER.map(([k, title]) => [k, title]));
const MENU_ICON = Object.fromEntries(MENU_ORDER.map(([k, , i]) => [k, i]));

// One menu entry (file/view list) rendered as a drawer/dropdown row. `badges` optionally maps an
// action → a small count shown as a pill (e.g. how many tab settings differ from the defaults).
function MenuItem({ it, onPick, badges }) {
  if (it.kind === 'separator') return <div className="separator" />;
  const badge = badges?.[it.action];
  return (
    <div className="item" onClick={() => onPick(it.action)}>
      <span className="item-icon" aria-hidden="true">{it.icon || ''}</span>
      <span className="item-label">{it.label}</span>
      {badge ? <span className="menu-badge" title={t.n('{n} setting differs from your defaults', '{n} settings differ from your defaults', badge)}>{badge}</span> : null}
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
      <div className="menu-sub-head">{t('Open recent')}</div>
      {recent.length === 0
        ? <div className="item menu-recent-empty"><span>{t('No recent files')}</span></div>
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
          <span>{all ? '▴ ' + t('Show top 12') : '▾ ' + t('Show all ({count})', { count: recent.length })}</span>
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
      title={t('Reading font — legible / common / recent picks (full catalogue in Settings → Font Manager)')}
      aria-label={t('Reading font')}
      onChange={(e) => pick(e.target.value)}
    >
      <option value="">{t('Font: theme')}</option>
      {current && !known.has(current) && <option value={current}>{current.split(',')[0].replace(/['"]/g, '')}</option>}
      {recents.length > 0 && (
        <optgroup label={t('Recent')}>
          {recents.map((r) => <option key={`r-${r.stack}`} value={r.stack}>{r.label}</option>)}
        </optgroup>
      )}
      <optgroup label={t('Very legible')}>
        {QUICK_FONTS_LEGIBLE.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
      </optgroup>
      <optgroup label={t('Common')}>
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
  const themeName = tabThemeName(activeTab?.settings);

  // Google Drive sign-in / sync, on the bar itself — signing in used to mean a trip through
  // File → Backup & Data. Shown wherever Drive can work (this origin is authorized, or a fork
  // supplied its own client id). `profile` is the account persisted at the last sign-in, so the
  // render stays pure; the token itself lives in memory only and a click re-auths silently.
  const sync = state.global.sync || {};
  const driveHere = !!driveClientId(sync);
  const driveChosen = sync.provider === 'googleDrive';
  const account = (driveChosen && sync.profile) || null;
  const gsyncTitle = !driveChosen
    ? t('Google Drive sync isn’t set up yet — click to choose it under Backup & Data')
    : account
      ? (account.email
        ? t('Google Drive — signed in as {name} ({email})', { name: account.name, email: account.email })
        : t('Google Drive — signed in as {name}', { name: account.name }))
        + (sync.lastSync ? ' · ' + t('last sync {time}', { time: fmtDateTime(sync.lastSync) }) : '')
        + '. ' + t('Click to sync now.')
      : t('Sign in with Google — your data goes to a private Drive folder only this app can see');
  const gsync = driveHere ? (
    <button
      className={`menu-font-btn menu-gsync${account ? ' on' : ''}`}
      title={gsyncTitle}
      aria-label={account ? t('Google Drive, signed in as {name}. Sync now.', { name: account.name }) : t('Sign in with Google')}
      onClick={() => onAction(!driveChosen ? 'data' : account ? 'sync-now' : 'drive-signin')}
    >
      {account?.picture
        ? <img className="gsync-pfp gsync-pfp-sm" src={account.picture} alt="" referrerPolicy="no-referrer" />
        : <span aria-hidden="true">☁</span>}
    </button>
  ) : null;
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

  // A− / A+ for the reading font. With auto-fit font size on (Tab Settings → "Auto font size"),
  // the width drives the size — so the buttons nudge the chars-per-line TARGET instead
  // (bigger font = fewer characters per line).
  function adjustReadingFont(dir) {
    if (!activeTab) return;
    const s = activeTab.settings;
    if ((s.autoFontCpl || 0) > 0) {
      patchSettings(activeTab.id, { autoFontCpl: Math.max(20, Math.min(200, s.autoFontCpl - dir * 5)) });
    } else if (dir > 0) {
      patchSettings(activeTab.id, { rightPaneFontSize: Math.min(60, (s.rightPaneFontSize || 12) + 1) });
    } else {
      patchSettings(activeTab.id, { rightPaneFontSize: Math.max(8, (s.rightPaneFontSize || 12) - 1) });
    }
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
          aria-label={t('Menu')}
        >
          ☰ {t('Menu')}
        </button>
        <div className="grow" />
        {gsync}
        <FontQuickPick activeTab={activeTab} patchSettings={patchSettings} global={state.global} updateGlobal={updateGlobal} />
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title={t('Smaller reading font')}
          aria-label={t('Smaller reading font')}
          onClick={() => adjustReadingFont(-1)}
        >
          A−
        </button>
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title={t('Larger reading font')}
          aria-label={t('Larger reading font')}
          onClick={() => adjustReadingFont(1)}
        >
          A+
        </button>
        {/* Full-screen was reachable only by shaking the phone — the ⛶ lived on the desktop bar. */}
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title={t('Full-screen Lines reading (Esc to exit)')}
          aria-label={t('Full-screen Lines reading')}
          onClick={() => onAction('fullscreen-lines')}
        >
          ⛶
        </button>
        <select
          className="menu-theme-compact"
          value={themeName}
          disabled={!activeTab}
          title={t('Reading theme for the current tab')}
          aria-label={t('Theme')}
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
                <div className="menu-drawer-section">{t('Menus')}</div>
                {/* Tap-friendly tile grid (not a list) — bigger targets, two per row. */}
                <div className="menu-cat-grid">
                  {MENU_ORDER.map(([key, title, icon]) => (
                    <div key={key} className="item menu-cat" onClick={() => setSub(key)}>
                      <span><span className="item-icon" aria-hidden="true">{icon}</span>{title}</span>
                      <span className="menu-cat-caret">›</span>
                    </div>
                  ))}
                  <div className="item menu-cat" onClick={() => { closeDrawer(); onAction('data'); }}>
                    <span>☁ {t('Data')}</span>
                  </div>
                </div>
              </>
            ) : (
              // Drilled into one menu: back header + that menu's items only, as a tile grid.
              <>
                <div className="menu-drawer-back" onClick={() => setSub(null)}>‹ {t('All menus')}</div>
                <div className="menu-drawer-section"><span className="item-icon" aria-hidden="true">{MENU_ICON[sub] || ''}</span>{MENU_TITLE[sub] || sub}</div>
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
      {MENU_ORDER.map(([key, title, icon]) => (
        <div
          key={key}
          className={`menu-item ${openMenu === key ? 'open' : ''}`}
          onClick={() => setOpenMenu(openMenu === key ? null : key)}
        >
          <span className="item-icon" aria-hidden="true">{icon}</span>{title}
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
        title={t('Toggle Table of Contents panel')}
      >
        {state.showToc ? '☑ ' : '☐ '}{t('ToC')}<kbd className="key-hint">3</kbd>
      </div>
      <div
        className={`menu-item ${activeTab?.settings?.showEyes ? 'open' : ''}`}
        onClick={() => activeTab && patchSettings(activeTab.id, { showEyes: !activeTab.settings.showEyes })}
        title={t('Toggle the animated reader avatars')}
      >
        {activeTab?.settings?.showEyes ? '☑ ' : '☐ '}{t('Avatars')}<kbd className="key-hint">6</kbd>
      </div>
      <div
        className={`menu-item ${state.showStats ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_STATS' })}
        title={t('Toggle the reading-stats panel')}
      >
        {state.showStats ? '☑ ' : '☐ '}{t('Stats')}<kbd className="key-hint">4</kbd>
      </div>
      <div
        className={`menu-item ${state.global.chipMode ? 'open' : ''}`}
        onClick={() => updateGlobal({ chipMode: !state.global.chipMode })}
        title={t('Chip mode: float the avatar, stats and goal as transparent draggable chips instead of docking them')}
      >
        {state.global.chipMode ? '☑ ' : '☐ '}{t('Chips')}
      </div>
      {activeTab?.doc?.source && (
        <div
          className={`menu-item ${state.showSource ? 'open' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_SOURCE' })}
          title={t('Show the original PDF page / EPUB section side-by-side')}
        >
          {state.showSource ? '☑ ' : '☐ '}{t('Source')}
        </div>
      )}
      <div
        className={`menu-item ${state.showIndex ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_INDEX' })}
        title={t('Toggle Index panel')}
      >
        {state.showIndex ? '☑ ' : '☐ '}{t('Index')}<kbd className="key-hint">5</kbd>
      </div>
      <div
        className={`menu-item ${state.showRsvp ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_SHOW_RSVP' })}
        title={t('Show the Fast Reader pane')}
      >
        {state.showRsvp ? '☑ ' : '☐ '}{t('Fast Reader')}<kbd className="key-hint">1</kbd>
      </div>
      <div
        className={`menu-item ${state.showLines !== false ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_LINES' })}
        title={t('Show the Lines pane')}
      >
        {state.showLines !== false ? '☑ ' : '☐ '}{t('Lines')}<kbd className="key-hint">2</kbd>
      </div>
      <div
        className={`menu-item incognito-menu ${state.incognito ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_INCOGNITO' })}
        title={t('Incognito reading — pause all tracking and persistence')}
      >
        {state.incognito ? '🕶 ' : '☐ '}{t('Incognito')}<kbd className="key-hint">I</kbd>
      </div>
      <div className="grow" />
      <div className="right-toggles">
        {gsync}
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title={t('Full-screen Lines reading — fills the screen with the Lines pane and hides all chrome (Esc to exit)')}
          aria-label={t('Full-screen Lines reading')}
          onClick={() => onAction('fullscreen-lines')}
        >
          ⛶
        </button>
        {activeTab?.doc?.source && (
          <button
            className="menu-font-btn"
            title={t('Full-screen Source view — fills the screen with the Source pane and hides all chrome (Esc to exit)')}
            aria-label={t('Full-screen Source view')}
            onClick={() => onAction('fullscreen-source')}
          >
            ⛶🗐
          </button>
        )}
        <FontQuickPick activeTab={activeTab} patchSettings={patchSettings} global={state.global} updateGlobal={updateGlobal} />
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title={t('Smaller reading font (Lines pane)')}
          aria-label={t('Smaller reading font')}
          onClick={() => adjustReadingFont(-1)}
        >
          A−
        </button>
        <button
          className="menu-font-btn"
          disabled={!activeTab}
          title={t('Larger reading font (Lines pane)')}
          aria-label={t('Larger reading font')}
          onClick={() => adjustReadingFont(1)}
        >
          A+
        </button>
        <label htmlFor="theme-select">{t('Theme')}</label>
        <select
          id="theme-select"
          value={themeName}
          disabled={!activeTab}
          title={t('Reading theme for the current tab')}
          onChange={(e) => activeTab && patchSettings(activeTab.id, { themeName: e.target.value })}
        >
          <ThemeOptions />
        </select>
      </div>
    </div>
  );
}
