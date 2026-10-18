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
