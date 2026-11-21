// Dates and times the app DISPLAYS (house standard 20): through the shared appFont.fmt (Intl), so they
// follow the reader's language, region and 12/24-hour clock set once under the font picker. Local
// time — these label the reader's own activity. Never use these as data keys: a stored or compared
// day is localDay() (features/localDay.js). Outside the browser (node self-checks) the fixed
// yyyy-mm-dd / 24-hour form below is used, so the checks stay deterministic.
const p2 = (n) => String(n).padStart(2, '0');
const shared = () => (typeof window !== 'undefined' ? window.appFont?.fmt : null);

export function fmtDate(ts) {
  const f = shared();
  if (f) return f.custom(ts, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function fmtTime(ts, withSecs = false) {
  const f = shared();
  if (f) return f.custom(ts, { hour: '2-digit', minute: '2-digit', ...(withSecs ? { second: '2-digit' } : {}) });
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}${withSecs ? ':' + p2(d.getSeconds()) : ''}`;
}
export function fmtDateTime(ts, withSecs = false) {
  return `${fmtDate(ts)} ${fmtTime(ts, withSecs)}`;
}
