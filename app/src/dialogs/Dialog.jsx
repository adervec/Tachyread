import { createContext, useContext, useEffect, useRef } from 'react';
import { t } from '../i18n.js';

// One Settings window: every settings dialog (app, this tab, defaults, fonts, audio, typing,
// comfort, sync & data, book groups) is a section of it. App provides { sections, current, pick }
// around those dialogs; Dialog then shows the section strip above the body and "Settings · …"
// as the title. Each section stays its own dialog component, so nothing inside them changed.
export const SettingsNav = createContext(null);

// Settings filter: hide the rows of the open section that don't mention the words typed (kept while
// switching sections, so the reader can step through them). Rows: the dialogs' field rows, data
// rows and tick boxes; section headings hide while a filter is on.
// ponytail: filters the section on screen only; an index across sections if this proves too little
const ROWS = '.field-row, .data-row, label.inline-check, .field-section';
function filterRows(body, q) {
  if (!body) return;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const el of body.querySelectorAll(ROWS)) {
    const txt = (el.textContent || '').toLowerCase();
    const miss = words.length > 0 && (el.classList.contains('field-section') || !words.every((w) => txt.includes(w)));
    el.classList.toggle('settings-miss', miss);
    if (!miss && !el.classList.contains('field-section')) hits++;
  }
  body.dataset.nomatch = words.length && !hits ? '1' : '';
}

export default function Dialog({ title, onClose, children, buttons, width = 520, dismissable = true }) {
  const nav = useContext(SettingsNav);
  const bodyRef = useRef(null);
  useEffect(() => { if (nav) filterRows(bodyRef.current, nav.query || ''); });
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape' || !dismissable) return;
      // First Escape inside a text field only leaves the field (see App's Escape handling).
      const el = e.target;
      if ((el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') { el.blur(); return; }
      onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dismissable]);
  // Clicking the backdrop intentionally does NOT close the dialog — every dialog has an explicit
  // ×/Cancel button, and accidental click-away dismissals were losing in-progress work. Escape
  // (when dismissable) and the buttons are the ways out.
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        style={{ width: typeof width === 'number' ? `min(${nav ? Math.max(width, 720) : width}px, 96vw)` : width }}
      >
        <div className="dialog-title">
          <span>{nav ? `⚙️ ${t('Settings')} · ${title}` : title}</span>
          <button className="close-x" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        {nav && (
          <div className="settings-nav" role="tablist" aria-label={t('Settings sections')}>
            {nav.sections.map((s) => (
              <button key={s.kind} role="tab" aria-selected={s.kind === nav.current} className={`rh-tab${s.kind === nav.current ? ' on' : ''}`}
                disabled={s.disabled} title={s.disabled ? t('Open a document first') : undefined} onClick={() => nav.pick(s.kind)}>{s.label}</button>
            ))}
            <input type="search" className="settings-search" value={nav.query || ''} onChange={(e) => nav.setQuery(e.target.value)}
              placeholder={t('Find a setting…')} aria-label={t('Find a setting')} />
          </div>
        )}
        <div className="dialog-body" ref={bodyRef} data-nomatch-text={nav ? t('Nothing in this section matches — try the other sections.') : undefined}>{children}</div>
        {buttons && <div className="dialog-buttons">{buttons}</div>}
      </div>
    </div>
  );
}
