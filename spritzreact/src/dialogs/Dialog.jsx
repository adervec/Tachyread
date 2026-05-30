import { useEffect } from 'react';

export default function Dialog({ title, onClose, children, buttons, width = 520 }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
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
