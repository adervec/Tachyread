import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { THEME_NAMES } from '../state/themes.js';

const MENUS = {
  file: [
    { label: 'Open TXT...', shortcut: 'Ctrl+O', action: 'open-txt' },
    { label: 'Open Document...', shortcut: 'Ctrl+D', action: 'open-doc' },
    { label: 'Open from Clipboard', shortcut: 'Ctrl+B', action: 'open-clip' },
    { label: 'Grab Text (OCR)...', shortcut: 'Ctrl+Shift+G', action: 'grab' },
    { kind: 'separator' },
    { label: 'Find...', shortcut: 'Ctrl+F', action: 'find' },
    { label: 'Go to Line...', shortcut: 'Ctrl+G', action: 'goto' },
    { label: 'Close Tab', action: 'close-tab' },
    { kind: 'separator' },
    { label: 'Application Settings...', action: 'app-settings' },
    { label: 'Default Tab Settings...', action: 'def-settings' },
    { label: 'Reset Tab to Default Settings', action: 'reset-tab' },
  ],
  view: [
    { label: 'Tab Settings...', action: 'tab-settings' },
    { label: 'Statistics...', shortcut: 'Ctrl+T', action: 'stats' },
    { label: 'Reading History...', shortcut: 'Ctrl+H', action: 'history' },
    { kind: 'separator' },
    { label: 'Proper Names Index...', shortcut: 'Ctrl+I', action: 'proper-names' },
    { label: 'Preview Footnote', shortcut: 'Ctrl+Shift+F', action: 'footnote' },
    { kind: 'separator' },
    { label: 'Audiobook Manager...', shortcut: 'Ctrl+Shift+A', action: 'audiobook' },
    { label: 'Text-to-Speech Reader...', shortcut: 'Ctrl+Shift+T', action: 'tts-popup' },
    { label: 'Face Library...', action: 'face-library' },
  ],
};

export default function MenuBar({ onFileOpen, onAction }) {
  const { state, dispatch, activeTab, patchSettings } = useApp();
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
        className={`menu-item ${!state.showSpritz ? 'open' : ''}`}
        onClick={() => dispatch({ type: 'TOGGLE_SHOW_SPRITZ' })}
        title="Hide the SPRITZ word-display pane"
      >
        {!state.showSpritz ? '☑ ' : '☐ '}Hide SPRITZ
      </div>
      <div className="grow" />
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
