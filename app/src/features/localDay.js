// Calendar days are the reader's LOCAL days (house standard): a session at 22:30 in São Paulo
// belongs to that evening, not to tomorrow in UTC. Every day key, bucket and date-only parse in the
// app goes through here. Never take a day from toISOString(), never parse a bare 'YYYY-MM-DD' with
// Date.parse/new Date (both UTC). See localDay.test.mjs.
const pad = (n) => String(n).padStart(2, '0');
const BARE = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' of the local day a timestamp (or Date) falls on; '' for a missing/invalid one.
export function localDay(t = Date.now()) {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// A stored date back to ms: numbers pass, a bare day is LOCAL midnight, full ISO strings as written.
export const parseDay = (v) => (typeof v === 'number' ? v : !v ? NaN : Date.parse(BARE.test(v) ? `${v}T00:00:00` : v));
// The day `n` days after `day` (calendar steps, so DST hours can't skip or repeat a day).
export function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}
// Local midnight of the Monday starting the week that holds `t`.
export function mondayOf(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
// Whole local days between two day strings (b − a), DST-proof.
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
