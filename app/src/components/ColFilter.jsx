import { textMatcher } from '../features/tableFilter.js';

// Filter inputs for a table's header filter row (see features/tableFilter.js for the matching).
// Text: a case-insensitive regex box, outlined red when the pattern isn't valid regex.
export function TextF({ value, onChange, label }) {
  const bad = textMatcher(value).bad;
  return (
    <input className={`colf-text${bad ? ' bad' : ''}`} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="regex"
      aria-label={`Filter ${label} (regular expression)`}
      title={bad ? 'Not a valid regular expression — matching it as plain text' : `Filter ${label} — a regular expression, case-insensitive (e.g. ^the|war$)`} />
  );
}
// Number range: [min, max]; `unit` hints what the boxes take (e.g. "k" for thousands).
export function RangeF({ value = ['', ''], onChange, label, unit = '' }) {
  const [lo, hi] = value;
  return (
    <span className="colf-range">
      <input value={lo} onChange={(e) => onChange([e.target.value, hi])} placeholder={`min${unit}`} inputMode="decimal" aria-label={`Minimum ${label}`} title={`Minimum ${label}${unit ? ` (${unit === 'k' ? 'thousands' : unit})` : ''}`} />
      <input value={hi} onChange={(e) => onChange([lo, e.target.value])} placeholder={`max${unit}`} inputMode="decimal" aria-label={`Maximum ${label}`} title={`Maximum ${label}${unit ? ` (${unit === 'k' ? 'thousands' : unit})` : ''}`} />
    </span>
  );
}
// Date range: from / to (native date pickers).
export function DateF({ value = ['', ''], onChange, label }) {
  const [from, to] = value;
  return (
    <span className="colf-range colf-dates">
      <input type="date" value={from} onChange={(e) => onChange([e.target.value, to])} aria-label={`${label} from`} title={`${label} from`} />
      <input type="date" value={to} onChange={(e) => onChange([from, e.target.value])} aria-label={`${label} to`} title={`${label} to`} />
    </span>
  );
}
