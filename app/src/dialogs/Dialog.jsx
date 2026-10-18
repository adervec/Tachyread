import { useEffect } from 'react';

export default function Dialog({ title, onClose, children, buttons, width = 520, dismissable = true }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape' || !dismissable) return;
      // First Escape inside a text field only leaves the field (see App's Escape handling).
      const t = e.target;
      if ((t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') { t.blur(); return; }
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
        style={{ width: typeof width === 'number' ? `min(${width}px, 96vw)` : width }}
      >
        <div className="dialog-title">
          <span>{title}</span>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="dialog-body">{children}</div>
        {buttons && <div className="dialog-buttons">{buttons}</div>}
      </div>
    </div>
  );
}
