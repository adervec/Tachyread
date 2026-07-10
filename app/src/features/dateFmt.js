// Fixed-format date/time for every timestamp the app displays: yyyy-mm-dd and a 24-hour clock,
// regardless of the device locale. Local time (these label the user's own activity).
const p2 = (n) => String(n).padStart(2, '0');
export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function fmtTime(ts, withSecs = false) {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}${withSecs ? ':' + p2(d.getSeconds()) : ''}`;
}
export function fmtDateTime(ts, withSecs = false) {
  return `${fmtDate(ts)} ${fmtTime(ts, withSecs)}`;
}
