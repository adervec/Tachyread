import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { THEME_NAMES } from '../state/themes.js';
import { useIsCompact } from '../state/device.js';

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
    { label: 'Backup & Data...', action: 'data' },
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
    { label: 'Regression Report...', action: 'regressions' },
    { label: 'Attention Check...', action: 'attention' },
    { label: 'Reading History...', shortcut: 'Ctrl+H', action: 'history' },
    { kind: 'separator' },
    { label: 'Generate Contents (Wizard)...', action: 'toc-wizard' },
    { label: 'Proper Names Index...', shortcut: 'Ctrl+I', action: 'proper-names' },
    { label: 'Typing Practice', action: 'typing' },
    { label: 'Typing Progress...', action: 'typing-progress' },
    { label: 'Span Drill...', action: 'span-drill' },
    { label: 'Flow Writer...', action: 'flow-writer' },
    { label: 'Dictation (speak to write)...', action: 'dictation' },
    { label: 'Vocabulary...', action: 'vocab' },
    { label: 'Take a Break Now', action: 'take-break' },
    { label: 'Preview Footnote', shortcut: 'Ctrl+Shift+F', action: 'footnote' },
    { kind: 'separator' },
    { label: 'Audiobook Manager...', shortcut: 'Ctrl+Shift+A', action: 'audiobook' },
    { label: 'Text-to-Speech Reader...', shortcut: 'Ctrl+Shift+T', action: 'tts-popup' },
    { label: 'Face Library...', action: 'face-library' },
    { kind: 'separator' },
    { label: 'Ambient Sound...', action: 'ambient' },
    { label: 'About / Disclaimer...', action: 'disclaimer' },
  ],
};

// One menu entry (file/view list) rendered as a drawer/dropdown row.
function MenuItem({ it, onPick }) {
  if (it.kind === 'separator') return <div className="separator" />;
  return (
    <div className="item" onClick={() => onPick(it.action)}>
      <span>{it.label}</span>
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
          {THEME_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
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
            <ToggleItem on={!state.showRsvp} label="Hide Fast Reader" onClick={() => dispatch({ type: 'TOGGLE_SHOW_RSVP' })} />

            <div className="menu-drawer-section">File</div>
            {MENUS.file.map((it, i) => <MenuItem key={`f${i}`} it={it} onPick={handle} />)}

            <div className="menu-drawer-section">View &amp; tools</div>
            {MENUS.view.map((it, i) => <MenuItem key={`v${i}`} it={it} onPick={handle} />)}

            <div className="menu-drawer-section">Backup</div>
            <div className="item" onClick={() => { setOpenMenu(null); onAction('sync-now'); }}>
              <span>☁ Sync / Back up now</span>
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
            {MENUS.file.map((it, i) =>
              it.kind === 'separator' ? (
                <div key={i} className="separator" />
              ) : (
                <div key={i} className="item" onClick={() => handle(it.action)}>
                  <span>{it.label}</span>
                  {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
                </div>
              )
            )}
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
            {MENUS.view.map((it, i) =>
              it.kind === 'separator' ? (
                <div key={i} className="separator" />
              ) : (
                <div key={i} className="item" onClick={() => handle(it.action)}>
                  <span>{it.label}</span>
                  {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
                </div>
              )
            )}
          </div>
        )}
      </div>
      <div
        className={`menu-item ${state.showToc ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_TOC' })}
        title="Toggle Table of Contents panel"
      >
        {state.showToc ? '☑ ' : '☐ '}TOC
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
        className={`menu-item ${!state.showRsvp ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_SHOW_RSVP' })}
        title="Hide the Fast Reader pane"
      >
        {!state.showRsvp ? '☑ ' : '☐ '}Hide Fast Reader
      </div>
      <div className="grow" />
      <div
        className="menu-item"
        onClick={() => onAction('sync-now')}
        title="Back up your data to the configured sync target (File → Backup & Data)"
      >
        ☁ Sync
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
          {THEME_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
