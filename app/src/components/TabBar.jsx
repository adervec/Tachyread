import { useApp } from '../state/AppContext.jsx';

// Short labels for the dialog tabs (menus use longer "…" titles). Fallback is the raw kind.
const PANEL_LABELS = {
  'tab-settings': 'Tab Settings', 'typing-settings': 'Typing Settings', 'audio-settings': 'Audio Settings',
  'font-manager': 'Fonts', 'help': 'Help', 'def-settings': 'Default Settings', 'app-settings': 'App Settings',
  'camera-settings': 'Camera', 'comfort-settings': 'Comfort', 'data': 'Data', 'book-groups': 'Book Groups',
  'stats': 'Statistics', 'history': 'History', 'literary-journey': 'Literary Journey', 'proper-names': 'Proper Names',
  'audiobook': 'Audiobook', 'notes': 'Notes', 'tts-popup': 'Text-to-Speech', 'face-library': 'Faces',
  'typing-progress': 'Typing Progress', 'span-drill': 'Span Drill', 'eye-warmup': 'Eye Warmup',
  'flow-writer': 'Flow Writer', 'dictation': 'Dictation', 'ambient': 'Ambient', 'vocab': 'Vocabulary',
  'regressions': 'Regressions', 'progress-detail': 'Progress', 'attention': 'Attention', 'typing-plan': 'Typing Plans',
};

export default function TabBar() {
  const { state, setActiveTab, closeTab, setActivePanel, closePanel } = useApp();
  const { panels, activePanelId, tabs } = state;
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
        return (
          <div
            key={tab.id}
            className={`tab ${tab.id === state.activeTabId ? 'active' : ''} ${tab.lazy ? 'lazy' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.lazy ? `${fileName} — tap to load` : fileName}
          >
            <span className="name">{fileName}</span>
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
