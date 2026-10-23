import { useMemo } from 'react';
import { TextF, RangeF, DateF } from './ColFilter.jsx';
import { filterSortRows, anySet } from '../features/tableFilter.js';
import { useSessionState } from '../state/useSessionState.js';

// A sortable, filterable table: click a header to sort (again to flip), a filter under every column
// (text: regex · number: min/max · date: from/to · select). Filters and sort are remembered for the
// session under `stateKey`.
//   columns: [{ key, label, type, get(row), render?(row), options?: [[value, label]] (select), unit?, title? }]
//   lead: { header, cell(row) } — an extra first column (e.g. a tick box); toolbar(visibleRows) renders above
export default function DataTable({ columns, rows, rowKey, stateKey, lead = null, toolbar = null, maxRows = 500, empty = 'Nothing here.', className = '' }) {
  const [filters, setFilters] = useSessionState(`tr-dt-${stateKey}-f`, {});
  const [sort, setSort] = useSessionState(`tr-dt-${stateKey}-s`, null);
  const shown = useMemo(() => filterSortRows(rows, columns, filters, sort), [rows, columns, filters, sort]);
  const setF = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));
  const any = anySet(filters);
  return (
    <div className={`dt ${className}`}>
      {(toolbar || any) && (
        <div className="lj-inline dt-bar">
          {toolbar?.(shown)}
          <span className="settings-note" style={{ margin: 0 }}>{shown.length === rows.length ? `${rows.length}` : `${shown.length} of ${rows.length}`}</span>
          {any && <button onClick={() => setFilters({})}>Clear filters</button>}
        </div>
      )}
      <div className="dt-scroll">
        <table className="lj-cand dt-table">
          <thead>
            <tr>
              {lead && <th>{lead.header}</th>}
              {columns.map((c) => (
                <th key={c.key} title={c.title || 'Click to sort (again to reverse)'} className="dt-sortable"
                  aria-sort={sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
                  onClick={() => setSort((s) => (s?.key === c.key ? (s.dir > 0 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: c.type === 'num' || c.type === 'date' ? -1 : 1 }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir > 0 ? ' ▴' : ' ▾') : ''}
                </th>
              ))}
            </tr>
            <tr className="ab-filter-row">
              {lead && <th />}
              {columns.map((c) => (
                <th key={c.key}>
                  {c.type === 'text' && <TextF value={filters[c.key] || ''} onChange={setF(c.key)} label={c.label} />}
                  {c.type === 'num' && <RangeF value={filters[c.key] || ['', '']} onChange={setF(c.key)} label={c.label} unit={c.unit || ''} />}
                  {c.type === 'date' && <DateF value={filters[c.key] || ['', '']} onChange={setF(c.key)} label={c.label} />}
                  {c.type === 'select' && (
                    <select value={filters[c.key] || 'all'} onChange={(e) => setF(c.key)(e.target.value)} aria-label={`Filter ${c.label}`}>
                      <option value="all">all</option>{(c.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, maxRows).map((r) => (
              <tr key={rowKey(r)}>
                {lead && <td>{lead.cell(r)}</td>}
                {columns.map((c) => <td key={c.key} title={typeof c.get(r) === 'string' ? c.get(r) : undefined}>{c.render ? c.render(r) : String(c.get(r) ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="settings-note">{rows.length ? 'No rows match these filters.' : empty}</p>}
        {shown.length > maxRows && <p className="settings-note">Showing {maxRows} of {shown.length} — filter to narrow.</p>}
      </div>
    </div>
  );
}
