import { useApp } from '../state/AppContext.jsx';

export default function TabBar() {
  const { state, setActiveTab, closeTab } = useApp();
  if (state.tabs.length === 0) {
    return (
      <div className="tab-bar">
        <span className="empty">No documents open — File → Open or drop a file</span>
      </div>
    );
  }
  return (
    <div className="tab-bar">
      {state.tabs.map((tab) => {
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
