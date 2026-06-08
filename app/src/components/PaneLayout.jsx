import { Fragment, useRef } from 'react';

// Horizontal resizable pane container. Every pane except the last has an explicit pixel
// width (stored by id); the last pane flexes to fill. Splitters drag to resize the pane to
// their left. The set of panes is data-driven so visibility toggles just add/remove entries.
export default function PaneLayout({ panes, widths, onResize, minWidth = 140 }) {
  const drag = useRef(null);

  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    const w = Math.max(minWidth, d.startW + (e.clientX - d.startX));
    onResize(d.id, w);
  }
  function onUp() {
    drag.current = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.style.cursor = '';
  }
  function onDown(e, id, startW) {
    drag.current = { id, startX: e.clientX, startW };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  }

  return (
    <div className="main-split">
      {panes.map((p, i) => {
        const isLast = i === panes.length - 1;
        const w = widths[p.id] ?? 280;
        return (
          <Fragment key={p.id}>
            <div className="pane" style={isLast ? { flex: '1 1 0' } : { flex: '0 0 auto', width: w }}>
              {p.node}
            </div>
            {!isLast && (
              <div
                className="splitter"
                role="separator"
                aria-orientation="vertical"
                title={`Drag to resize the ${p.label || p.id} pane`}
                onPointerDown={(e) => onDown(e, p.id, w)}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
