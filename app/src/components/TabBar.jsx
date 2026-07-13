import { Fragment, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { groupForChecksum, masterOf } from '../features/bookGroups.js';
import { getBinding } from '../state/storage.js';

// Short labels for the dialog tabs (menus use longer "…" titles). Fallback is the raw kind.
const PANEL_LABELS = {
  'tab-settings': 'Tab Settings', 'typing-settings': 'Typing Settings', 'audio-settings': 'Audio Settings',
  'font-manager': 'Fonts', 'help': 'Help', 'def-settings': 'Default Settings', 'app-settings': 'App Settings',
  'camera-settings': 'Camera', 'comfort-settings': 'Comfort', 'data': 'Data', 'book-groups': 'Book Groups',
  'stats': 'Statistics', 'history': 'History', 'literary-journey': 'Trackyread', 'proper-names': 'Proper Names',
  'audiobook': 'Audiobook', 'notes': 'Notes', 'tts-popup': 'Text-to-Speech', 'face-library': 'Faces',
  'typing-progress': 'Typing Progress', 'span-drill': 'Span Drill', 'eye-warmup': 'Eye Warmup',
  'flow-writer': 'Flow Writer', 'dictation': 'Dictation', 'ambient': 'Ambient', 'vocab': 'Vocabulary',
  'regressions': 'Regressions', 'progress-detail': 'Progress', 'attention': 'Attention', 'typing-plan': 'Typing Plans',
};

export default function TabBar() {
  const { state, setActiveTab, closeTab, closeTabs, closeAllTabs, setActivePanel, closePanel, reorderTabs, updateGlobal } = useApp();
  const { panels, activePanelId, tabs } = state;
  const groups = state.global.bookGroups || [];
  const multiRow = !!state.global.tabBarMultiRow;
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
        title={p.id === activePanelId ? `${label} — tap to minimize` : label}
      >
        <span className="name">{label}</span>
        <button className="close" onClick={(e) => { e.stopPropagation(); closePanel(p.id); }} title="Close">×</button>
      </div>
    );
  };

  // Build the right-click menu's actions from the tab it was opened on. Left/right are relative to
  // that tab's position among the document tabs; each entry is disabled when it would close nothing.
  const renderMenu = () => {
    const i = tabs.findIndex((t) => t.id === menu.tabId);
    if (i < 0) return null;
    const leftIds = tabs.slice(0, i).map((t) => t.id);
    const rightIds = tabs.slice(i + 1).map((t) => t.id);
    const otherIds = tabs.filter((t) => t.id !== menu.tabId).map((t) => t.id);
    const items = [
      { label: 'Close', fn: () => closeTab(menu.tabId) },
      { label: 'Close others', n: otherIds.length, fn: () => closeTabs(otherIds) },
      { label: 'Close to the left', n: leftIds.length, fn: () => closeTabs(leftIds) },
      { label: 'Close to the right', n: rightIds.length, fn: () => closeTabs(rightIds) },
      { label: 'Close all', n: tabs.length, fn: () => closeAllTabs() },
      { sep: true },
      { label: multiRow ? '✓ Multi-row tabs' : 'Multi-row tabs', fn: () => updateGlobal({ tabBarMultiRow: !multiRow }) },
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
                onClick={it.n === 0 ? undefined : () => { it.fn(); setMenu(null); }}
              >
                {it.label}
              </div>
            ))}
        </div>
      </>
    );
  };

  return (
    <div className={`tab-bar${multiRow ? ' multi-row' : ''}`}>
      {/* Unscoped dialog tabs first (leftmost); doc-scoped ones render inside their file's group below. */}
      {panels.filter((p) => p.docTabId == null).map((p) => renderPanel(p, null))}
      {noDocs && panels.length === 0 && (
        <span className="empty">No documents open — File → Open or drop a file</span>
      )}
      {tabs.map((tab) => {
        // Lazy (restored, not-yet-opened) tabs have no parsed doc — read name/progress from the
        // lightweight placeholder fields instead.
        const fileName = tab.lazy ? tab.fileName : tab.doc.fileName;
        const total = tab.lazy ? (tab.settings.totalWords || 0) : tab.doc.words.length;
        const pct = total ? (tab.settings.wordIndex / total) * 100 : 0;
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
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id }); }}
            onDragStart={(e) => { dragId.current = tab.id; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragId.current && dragId.current !== tab.id) { e.preventDefault(); setDropId(tab.id); } }}
            onDragLeave={() => setDropId((d) => (d === tab.id ? null : d))}
            onDrop={(e) => { e.preventDefault(); if (dragId.current && dragId.current !== tab.id) reorderTabs(dragId.current, tab.id); dragId.current = null; setDropId(null); }}
            onDragEnd={() => { dragId.current = null; setDropId(null); }}
            title={named ? `${named.name} — ${fileName}${cs === masterOf(named) ? ' (master)' : ''}` : (tab.lazy ? `${fileName} — tap to load` : fileName)}
          >
            {hasBindings && (
              <span
                className={`tab-track ${cs && bindings[cs] ? 'in' : 'out'}`}
                title={cs && bindings[cs] ? 'Tracked in Trackyread' : 'Not in Trackyread'}
              />
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
