// Shared column-filter matching for the big tables (Files, Library, Authors/Genres…), so every
// column can be filtered the same way: text columns by regex (case-insensitive; text that isn't a
// valid regex is matched literally and flagged), number columns by a min/max range, date columns by
// a from/to range. Empty inputs mean "no filter". Pure; see tableFilter.test.mjs.

// → { test(value) → bool, bad } ; test is null when the pattern is empty.
export function textMatcher(pattern) {
  const t = String(pattern || '').trim();
  if (!t) return { test: null, bad: false };
  try { const re = new RegExp(t, 'i'); return { test: (v) => re.test(String(v ?? '')), bad: false }; }
  catch { const lc = t.toLowerCase(); return { test: (v) => String(v ?? '').toLowerCase().includes(lc), bad: true }; }
}

const num = (s) => (s === '' || s == null || Number.isNaN(Number(s)) ? null : Number(s));
// v within [min, max] (either may be blank). A missing value fails as soon as any bound is set.
// `scale` multiplies the typed bounds (e.g. 1000 when the box takes thousands of words).
export function inRange(v, min, max, scale = 1) {
  const lo = num(min), hi = num(max);
  if (lo == null && hi == null) return true;
  if (v == null || v === '' || Number.isNaN(Number(v))) return false;
  return (lo == null || Number(v) >= lo * scale) && (hi == null || Number(v) <= hi * scale);
}
// ISO date (or any 'YYYY-MM-DD…' string) within [from, to] — compares the date part.
export function inDates(d, from, to) {
  if (!from && !to) return true;
  const x = String(d || '').slice(0, 10);
  if (!x) return false;
  return (!from || x >= from) && (!to || x <= to);
}
// True when any filter in the object is set (for "Clear filters" buttons).
export const anySet = (obj) => Object.values(obj || {}).some((v) => (Array.isArray(v) ? v.some((x) => x !== '' && x != null) : v !== '' && v != null && v !== 'all'));

// Filter + sort rows by column definitions — the engine behind components/DataTable.jsx.
// columns: [{ key, type: 'text' | 'num' | 'date' | 'select', get(row) }]; filters: { key: value }
// (text: pattern · num/date: [min, max] · select: value or 'all'); sort: { key, dir: 1 | -1 } | null.
export function filterSortRows(rows, columns, filters = {}, sort = null) {
  const tests = columns.map((c) => {
    const f = filters[c.key];
    if (c.type === 'text') { const t = textMatcher(f).test; return t ? (r) => t(String(c.get(r) ?? '')) : null; }
    if (c.type === 'num' && Array.isArray(f) && (f[0] !== '' || f[1] !== '')) return (r) => inRange(c.get(r), f[0], f[1]);
    if (c.type === 'date' && Array.isArray(f) && (f[0] || f[1])) return (r) => { const v = c.get(r); return inDates(v ? new Date(v).toISOString() : '', f[0], f[1]); };
    if (c.type === 'select' && f && f !== 'all') return (r) => String(c.get(r)) === f;
    return null;
  }).filter(Boolean);
  const out = rows.filter((r) => tests.every((t) => t(r)));
  const col = sort && columns.find((c) => c.key === sort.key);
  if (col) {
    const v = (r) => { const x = col.get(r); return col.type === 'num' || col.type === 'date' ? (x == null || x === '' ? -Infinity : Number(typeof x === 'string' && col.type === 'date' ? Date.parse(x) : x)) : String(x ?? '').toLowerCase(); };
    out.sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir || 1); });
  }
  return out;
}
