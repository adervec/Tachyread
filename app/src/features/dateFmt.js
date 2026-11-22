// Dates and times the app DISPLAYS (house standards 20 and 28): through the shared appFont.fmt, which
// shows ISO 8601 (2026-11-21, 14:05) unless the reader chose "Regional" under the font picker, and
// follows their language and 12/24-hour clock. Local time — these label the reader's own activity.
// Never use these as data keys: a stored or compared day is localDay() (features/localDay.js).
// Outside the browser (node self-checks) the fixed ISO form below is used, so the checks stay stable.
const p2 = (n) => String(n).padStart(2, '0');
const shared = () => (typeof window !== 'undefined' ? window.appFont?.fmt : null);
const isoDay = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export function fmtDate(ts) {
  const f = shared();
  return f ? f.date(ts) : isoDay(new Date(ts));
}
// The date with its weekday ("Sat 2026-11-21", or the regional long form).
export function fmtDay(ts) {
  const f = shared();
  if (f) return f.date(ts, 'full');
  const d = new Date(ts);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${isoDay(d)}`;
}
export function fmtTime(ts, withSecs = false) {
  const f = shared();
  const d = new Date(ts);
  if (!f) return `${p2(d.getHours())}:${p2(d.getMinutes())}${withSecs ? ':' + p2(d.getSeconds()) : ''}`;
  if (!withSecs) return f.time(ts);
  // ponytail: fmt has no seconds form; a time-only Intl format (not a date) keeps the reader's clock
  return f.custom(ts, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtDateTime(ts, withSecs = false) {
  const f = shared();
  if (f && !withSecs) return f.dateTime(ts);
  return `${fmtDate(ts)} ${fmtTime(ts, withSecs)}`;
}
