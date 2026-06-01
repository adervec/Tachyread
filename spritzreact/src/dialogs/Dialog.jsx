import { useEffect } from 'react';

export default function Dialog({ title, onClose, children, buttons, width = 520, dismissable = true }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && dismissable) onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dismissable]);
  return (
    <div className="dialog-backdrop" onClick={dismissable ? onClose : undefined}>
      <div className="dialog" style={{ width }} onClick={(e) => e.stopPropagation()}>
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
