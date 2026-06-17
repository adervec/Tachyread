import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { detectProperNames } from '../document/readerDocument.js';

export default function ProperNamesDialog({ tab, onJumpWord, onWizard, onClose }) {
  const [sortBy, setSortBy] = useState('count');
  const [filter, setFilter] = useState('');
  const [, force] = useState(0);

  const items = useMemo(() => {
    const out = [];
    if (!tab?.doc?.properNames) return out;
    for (const [key, val] of tab.doc.properNames.entries()) {
      out.push({ key, canonical: val.canonical, count: val.indices.length, first: val.indices[0] });
    }
    if (filter) {
      const f = filter.toLowerCase();
      return out
        .filter((it) => it.canonical.toLowerCase().includes(f))
        .sort(sorter(sortBy));
    }
    return out.sort(sorter(sortBy));
  }, [tab, sortBy, filter]);

  function sorter(by) {
    if (by === 'name') return (a, b) => a.canonical.localeCompare(b.canonical);
    if (by === 'first') return (a, b) => a.first - b.first;
    return (a, b) => b.count - a.count;
  }

  function exportCsv() {
    const rows = [['name', 'count', 'first_word_index']];
    for (const it of items) rows.push([it.canonical, it.count, it.first]);
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab.doc.fileName || 'document'}.proper-names.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const empty = !tab?.doc?.properNames || tab.doc.properNames.size === 0;

  return (
    <Dialog title="Proper Names Index" onClose={onClose} width={620}>
      {onWizard && (
        <p className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onWizard}>🪄 Build from the cast list</button>
          <span>Use the book’s Dramatis Personae for precise, false-positive-free names.</span>
        </p>
      )}
      {empty && (
        <div style={{ marginBottom: 10, padding: 8, background: 'var(--menu-bg)', border: '1px solid var(--divider)' }}>
          Detection is off (or no names found). Heavy on large documents — enable in Tab Settings to keep it on,
          or run once for this session:{' '}
          <button
            onClick={() => {
              detectProperNames(tab.doc);
              force((n) => n + 1);
            }}
          >
            Detect now
          </button>
        </div>
      )}
      <div className="field-row">
        <label>Filter</label>
        <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type to filter…" />
      </div>
      <div className="field-row">
        <label>Sort by</label>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="count">Count (desc)</option>
          <option value="name">Name (A→Z)</option>
          <option value="first">First mention</option>
        </select>
      </div>
      <div style={{ margin: '6px 0', display: 'flex', gap: 6 }}>
        <button onClick={exportCsv}>Export CSV</button>
      </div>
      <table className="history-table">
        <thead>
          <tr><th>Name</th><th>Count</th><th>First word</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.key}>
              <td>{it.canonical}</td>
              <td>{it.count}</td>
              <td>{it.first}</td>
              <td>
                <button onClick={() => { onJumpWord(it.first); onClose(); }}>Go</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 12 }}>No proper names detected.</td></tr>
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
