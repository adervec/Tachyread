import { useApp } from '../state/AppContext.jsx';
import { groupForChecksum, masterOf } from '../features/bookGroups.js';

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
  const { state, setActiveTab, closeTab, setActivePanel, closePanel } = useApp();
  const { panels, activePanelId, tabs } = state;
  const groups = state.global.bookGroups || [];
  const noDocs = tabs.length === 0;
  return (
    <div className="tab-bar">
      {/* Dialog tabs first (leftmost), styled distinctly from document tabs. */}
      {panels.map((p) => {
        const label = PANEL_LABELS[p.kind] || p.kind;
        return (
          <div
            key={`panel-${p.id}`}
            className={`tab dialog-tab ${p.id === activePanelId ? 'active' : ''}`}
            onClick={() => setActivePanel(p.id)}
            title={p.id === activePanelId ? `${label} — tap to minimize` : label}
          >
            <span className="name">{label}</span>
            <button
              className="close"
              onClick={(e) => { e.stopPropagation(); closePanel(p.id); }}
              title="Close"
            >
              ×
            </button>
          </div>
        );
      })}
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
        return (
          <div
            key={tab.id}
            className={`tab ${tab.id === state.activeTabId ? 'active' : ''} ${tab.lazy ? 'lazy' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={named ? `${named.name} — ${fileName}${cs === masterOf(named) ? ' (master)' : ''}` : (tab.lazy ? `${fileName} — tap to load` : fileName)}
          >
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
        );
      })}
    </div>
  );
}
