import { createContext, useContext, useEffect } from 'react';
import { t } from '../i18n.js';

// One Settings window: every settings dialog (app, this tab, defaults, fonts, audio, typing,
// comfort, sync & data, book groups) is a section of it. App provides { sections, current, pick }
// around those dialogs; Dialog then shows the section strip above the body and "Settings · …"
// as the title. Each section stays its own dialog component, so nothing inside them changed.
export const SettingsNav = createContext(null);

export default function Dialog({ title, onClose, children, buttons, width = 520, dismissable = true }) {
  const nav = useContext(SettingsNav);
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
          </div>
        )}
        <div className="dialog-body">{children}</div>
        {buttons && <div className="dialog-buttons">{buttons}</div>}
      </div>
    </div>
  );
}
