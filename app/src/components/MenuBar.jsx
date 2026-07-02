import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { THEME_CATEGORIES } from '../state/themes.js';
import { countOffDefaultSettings, defaultFileSettings } from '../state/settings.js';
import { useIsCompact } from '../state/device.js';

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
    { label: 'Open Document...', shortcut: 'Ctrl+D', action: 'open-doc' },
    { label: 'Open from Clipboard', shortcut: 'Ctrl+B', action: 'open-clip' },
    { label: 'Grab Text (OCR)...', shortcut: 'Ctrl+Shift+G', action: 'grab' },
    { label: 'Save Tab Text...', action: 'save-tab' },
    { kind: 'separator' },
    { label: 'Find...', shortcut: 'Ctrl+F', action: 'find' },
    { label: 'Go to Line...', shortcut: 'Ctrl+G', action: 'goto' },
    { label: 'Close Tab', action: 'close-tab' },
    { label: 'Close All Tabs', action: 'close-all' },
    { kind: 'separator' },
    { label: 'Application Settings...', action: 'app-settings' },
    { label: 'Data Management...', action: 'data' },
    { label: 'Book Groups...', action: 'book-groups' },
    { label: 'Default Tab Settings...', action: 'def-settings' },
    { label: 'Reset Tab to Default Settings', action: 'reset-tab' },
    { kind: 'separator' },
    { label: 'Disconnect (keep session for next time)', action: 'disconnect' },
    { label: 'Shut Down (close all, start clean next time)', action: 'shutdown' },
  ],
  view: [
    { label: 'Tab Settings...', action: 'tab-settings' },
    { label: 'Statistics...', shortcut: 'Ctrl+T', action: 'stats' },
    { label: 'Progress Detail...', action: 'progress-detail' },
    { label: 'Regression Report...', action: 'regressions' },
    { label: 'Attention Check...', action: 'attention' },
    { label: 'Reading History...', shortcut: 'Ctrl+H', action: 'history' },
    { kind: 'separator' },
    { label: 'Generate Contents (Wizard)...', action: 'toc-wizard' },
    { label: 'Generate Proper Names (Wizard)...', action: 'names-wizard' },
    { label: 'Generate Index (Wizard)...', action: 'index-wizard' },
    { label: 'Locate Footnotes (Wizard)...', action: 'notes-wizard' },
    { label: 'Proper Names Index...', shortcut: 'Ctrl+I', action: 'proper-names' },
    { label: 'Span Drill...', action: 'span-drill' },
    { label: 'Eye Warmup...', action: 'eye-warmup' },
    { label: 'Flow Writer...', action: 'flow-writer' },
    { label: 'Dictation (speak to write)...', action: 'dictation' },
    { label: 'Vocabulary...', action: 'vocab' },
    { label: 'Take a Break Now', action: 'take-break' },
    { label: 'Incognito Reading (no tracking)', action: 'toggle-incognito' },
    { label: 'Preview Footnote', shortcut: 'Ctrl+Shift+F', action: 'footnote' },
    { kind: 'separator' },
    { label: 'Audiobook Manager...', shortcut: 'Ctrl+Shift+A', action: 'audiobook' },
    { label: 'Text-to-Speech Reader...', shortcut: 'Ctrl+Shift+T', action: 'tts-popup' },
    { label: 'Face Library...', action: 'face-library' },
    { kind: 'separator' },
    { label: 'Ambient Sound...', action: 'ambient' },
    { label: 'About / Disclaimer...', action: 'disclaimer' },
  ],
  typing: [
    { label: 'Typing Practice', action: 'typing' },
    { label: 'Typing Plans...', action: 'typing-plans' },
    { label: 'Typing Progress...', action: 'typing-progress' },
  ],
};

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

// A checkable panel-toggle row for the mobile drawer.
function ToggleItem({ on, label, onClick }) {
  return (
    <div className="item" onClick={onClick}>
      <span className="check">{on ? '☑' : '☐'}</span>
      <span>{label}</span>
    </div>
  );
}

export default function MenuBar({ onFileOpen, onAction }) {
  const { state, dispatch, activeTab, patchSettings } = useApp();
  const isCompact = useIsCompact();
  const themeName =
    activeTab?.settings?.themeName || (activeTab?.settings?.darkMode ? 'Dark' : 'Light');
  const [openMenu, setOpenMenu] = useState(null);
  const ref = useRef(null);

  // Badge the "Tab Settings…" item with how many of the active tab's settings differ from the
  // user's Default Tab Settings (so it's visible at a glance that the tab has been customised).
  const offCount = activeTab && !activeTab.lazy && activeTab.settings
    ? countOffDefaultSettings(activeTab.settings, state.global?.fileDefaults || defaultFileSettings())
    : 0;
  const badges = offCount > 0 ? { 'tab-settings': offCount } : null;

  useEffect(() => {
    function onDoc(e) {
      if (!ref.current?.contains(e.target)) setOpenMenu(null);
    }
    if (openMenu) document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [openMenu]);

  function chooseFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.csv,.log';
    input.onchange = () => input.files?.[0] && onFileOpen(input.files[0]);
    input.click();
  }
  function chooseDoc() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.pdf,.epub,.txt,.md';
    input.onchange = () => input.files?.[0] && onFileOpen(input.files[0]);
    input.click();
  }

  function handle(action) {
    setOpenMenu(null);
    if (action === 'open-txt') chooseFile();
    else if (action === 'open-doc') chooseDoc();
    else onAction(action);
  }

  // Compact (phone/tablet) menu: a single hamburger that opens a scrollable drawer with the panel
  // toggles, the full File/View lists, theme, and Sync — instead of a desktop menu bar that wraps.
  if (isCompact) {
    const open = openMenu === 'mobile';
    return (
      <div className="menu-bar compact" ref={ref}>
        <button
          className={`menu-burger${open ? ' open' : ''}`}
          onClick={() => setOpenMenu(open ? null : 'mobile')}
          aria-expanded={open}
          aria-label="Menu"
        >
          ☰ Menu
        </button>
        <div className="grow" />
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
        {open && (
          <div className="menu-drawer">
            <div className="menu-drawer-section">Panels</div>
            <ToggleItem on={state.showToc} label="Table of Contents" onClick={() => dispatch({ type: 'TOGGLE_TOC' })} />
            <ToggleItem on={state.showDash} label="Faces / Stats" onClick={() => dispatch({ type: 'TOGGLE_DASH' })} />
            {activeTab?.doc?.source && (
              <ToggleItem on={state.showSource} label="Source page" onClick={() => dispatch({ type: 'TOGGLE_SOURCE' })} />
            )}
            <ToggleItem on={state.showIndex} label="Index" onClick={() => dispatch({ type: 'TOGGLE_INDEX' })} />
            <ToggleItem on={state.showRsvp} label="Fast Reader" onClick={() => dispatch({ type: 'TOGGLE_SHOW_RSVP' })} />
            <ToggleItem on={state.incognito} label="🕶 Incognito (no tracking)" onClick={() => dispatch({ type: 'TOGGLE_INCOGNITO' })} />

            <div className="menu-drawer-section">File</div>
            {MENUS.file.map((it, i) => <MenuItem key={`f${i}`} it={it} onPick={handle} badges={badges} />)}

            <div className="menu-drawer-section">View &amp; tools</div>
            {MENUS.view.map((it, i) => <MenuItem key={`v${i}`} it={it} onPick={handle} badges={badges} />)}

            <div className="menu-drawer-section">Typing</div>
            {MENUS.typing.map((it, i) => <MenuItem key={`t${i}`} it={it} onPick={handle} badges={badges} />)}

            <div className="menu-drawer-section">Data</div>
            <div className="item" onClick={() => { setOpenMenu(null); onAction('data'); }}>
              <span>☁ Data management…</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="menu-bar" ref={ref}>
      <div
        className={`menu-item ${openMenu === 'file' ? 'open' : ''}`}
        onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
      >
        File
        {openMenu === 'file' && (
          <div className="menu-dropdown">
            {MENUS.file.map((it, i) => <MenuItem key={i} it={it} onPick={handle} badges={badges} />)}
          </div>
        )}
      </div>
      <div
        className={`menu-item ${openMenu === 'view' ? 'open' : ''}`}
        onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
      >
        View
        {openMenu === 'view' && (
          <div className="menu-dropdown">
            {MENUS.view.map((it, i) => <MenuItem key={i} it={it} onPick={handle} badges={badges} />)}
          </div>
        )}
      </div>
      <div
        className={`menu-item ${openMenu === 'typing' ? 'open' : ''}`}
        onClick={() => setOpenMenu(openMenu === 'typing' ? null : 'typing')}
      >
        Typing
        {openMenu === 'typing' && (
          <div className="menu-dropdown">
            {MENUS.typing.map((it, i) => <MenuItem key={i} it={it} onPick={handle} badges={badges} />)}
          </div>
        )}
      </div>
      <div
        className={`menu-item ${state.showToc ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_TOC' })}
        title="Toggle Table of Contents panel"
      >
        {state.showToc ? '☑ ' : '☐ '}ToC
      </div>
      <div
        className={`menu-item ${state.showDash ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_DASH' })}
        title="Toggle the Faces / Stats pane"
      >
        {state.showDash ? '☑ ' : '☐ '}Faces/Stats
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
        {state.showIndex ? '☑ ' : '☐ '}Index
      </div>
      <div
        className={`menu-item ${state.showRsvp ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_SHOW_RSVP' })}
        title="Show the Fast Reader pane"
      >
        {state.showRsvp ? '☑ ' : '☐ '}Fast Reader
      </div>
      <div
        className={`menu-item incognito-menu ${state.incognito ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_INCOGNITO' })}
        title="Incognito reading — pause all tracking and persistence"
      >
        {state.incognito ? '🕶 ' : '☐ '}Incognito
      </div>
      <div className="grow" />
      <div
        className="menu-item"
        onClick={() => onAction('data')}
        title="Open the data management suite — overview, backup &amp; restore, cloud sync, maintenance"
      >
        ☁ Data
      </div>
      <div className="right-toggles">
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
