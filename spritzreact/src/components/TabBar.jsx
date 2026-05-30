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
        const pct = tab.doc.words.length ? (tab.settings.wordIndex / tab.doc.words.length) * 100 : 0;
        return (
          <div
            key={tab.id}
            className={`tab ${tab.id === state.activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.doc.fileName}
          >
            <span className="name">{tab.doc.fileName}</span>
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
