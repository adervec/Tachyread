import { textMatcher } from '../features/tableFilter.js';
import { t } from '../i18n.js';

// Filter inputs for a table's header filter row (see features/tableFilter.js for the matching).
// Text: a case-insensitive regex box, outlined red when the pattern isn't valid regex.
export function TextF({ value, onChange, label }) {
  const bad = textMatcher(value).bad;
  return (
    <input className={`colf-text${bad ? ' bad' : ''}`} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={t('regex')}
      aria-label={t('Filter {label} (regular expression)', { label })}
      title={bad ? t('Not a valid regular expression — matching it as plain text') : t('Filter {label} — a regular expression, case-insensitive (e.g. ^the|war$)', { label })} />
  );
}
// Number range: [min, max]; `unit` hints what the boxes take (e.g. "k" for thousands).
export function RangeF({ value = ['', ''], onChange, label, unit = '' }) {
  const [lo, hi] = value;
  return (
    <span className="colf-range">
      <input value={lo} onChange={(e) => onChange([e.target.value, hi])} placeholder={t('min') + unit} inputMode="decimal" aria-label={t('Minimum {label}', { label })} title={unit ? t('Minimum {label} ({unit})', { label, unit: unit === 'k' ? t('thousands') : unit }) : t('Minimum {label}', { label })} />
      <input value={hi} onChange={(e) => onChange([lo, e.target.value])} placeholder={t('max') + unit} inputMode="decimal" aria-label={t('Maximum {label}', { label })} title={unit ? t('Maximum {label} ({unit})', { label, unit: unit === 'k' ? t('thousands') : unit }) : t('Maximum {label}', { label })} />
    </span>
  );
}
// Date range: from / to (native date pickers).
export function DateF({ value = ['', ''], onChange, label }) {
  const [from, to] = value;
  return (
    <span className="colf-range colf-dates">
      <input type="date" value={from} onChange={(e) => onChange([e.target.value, to])} aria-label={t('{label} from', { label })} title={t('{label} from', { label })} />
      <input type="date" value={to} onChange={(e) => onChange([from, e.target.value])} aria-label={t('{label} to', { label })} title={t('{label} to', { label })} />
    </span>
  );
}
