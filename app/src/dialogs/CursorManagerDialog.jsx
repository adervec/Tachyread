import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  PREMADE_CURSORS, SVG_CURSORS, cursorCss, resolveCursorCss, customCursorId,
  clampCursorSize, CURSOR_MIN_SIZE, CURSOR_MAX_SIZE, DEFAULT_CURSOR_COLOR, DEFAULT_CURSOR_SIZE,
} from '../features/cursors.js';
import { TRAIL_MODES, clampTrailMs, TRAIL_MIN_MS, TRAIL_MAX_MS } from '../features/cursorTrail.js';

const TRAIL_LABELS = { off: 'Off', fade: 'Fade (comet tail)', seismograph: 'Seismograph (draws as text scrolls under it)' };

// A little SVG swatch of a cursor at a given colour/size, for the picker grid.
function Swatch({ def, color, size }) {
  if (def.native) return <span className="cur-swatch cur-native" title={def.native}>{def.native === 'none' ? '∅' : '↖'}</span>;
  const s = Math.min(28, size);
  return <span className="cur-swatch" dangerouslySetInnerHTML={{ __html: `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${def.svg(color, s)}</svg>` }} />;
}

// Manage per-tab reading cursors: pick one for THIS tab (premades + your saved customs), build new
// custom cursors from any SVG shape + colour + size, and set the fading trail. The cursor shows only
// over the reader panes; the trail is a wake behind the pointer (or a seismograph line as the text
// scrolls under it).
export default function CursorManagerDialog({ tab, onClose }) {
  const { state, updateGlobal, patchSettings } = useApp();
  const customs = state.global.customCursors || [];
  const s = tab?.settings || {};
  const setTab = (p) => tab && patchSettings(tab.id, p);

  // Custom-cursor builder state.
  const [base, setBase] = useState('dot');
  const [color, setColor] = useState(DEFAULT_CURSOR_COLOR);
  const [size, setSize] = useState(DEFAULT_CURSOR_SIZE);

  function saveCustom() {
    const id = customCursorId(base, color, clampCursorSize(size), customs);
    const name = `${PREMADE_CURSORS.find((c) => c.id === base)?.label || base} ${clampCursorSize(size)}px`;
    const next = [...customs, { id, name, base, color, size: clampCursorSize(size) }];
    updateGlobal({ customCursors: next });
    setTab({ cursorId: id }); // use it straight away
  }
  function deleteCustom(id) {
    updateGlobal({ customCursors: customs.filter((c) => c.id !== id) });
    if (s.cursorId === id) setTab({ cursorId: '' });
  }

  const activeCss = resolveCursorCss(s.cursorId, customs) || 'the system pointer';

  return (
    <Dialog title="Reading cursor & trail" onClose={onClose} width={640} buttons={<button onClick={onClose}>Close</button>}>
      {!tab && <p className="settings-note">Open a document to set its reading cursor.</p>}
      {tab && (
        <>
          <p className="settings-note">
            A cursor and trail just for <b>this tab</b>, shown only over the reader panes — menus and dialogs
            keep the normal pointer. Per-tab, so each book can read differently.
          </p>

          <div className="field-section">Cursor for this tab</div>
          <div className="cur-grid">
            <button
              className={`cur-cell${!s.cursorId ? ' on' : ''}`}
              onClick={() => setTab({ cursorId: '' })}
              title="System default"
            ><span className="cur-swatch cur-native">↖</span><span className="cur-name">System</span></button>
            {PREMADE_CURSORS.filter((c) => c.id !== 'default').map((c) => (
              <button
                key={c.id}
                className={`cur-cell${s.cursorId === c.id ? ' on' : ''}`}
                onClick={() => setTab({ cursorId: c.id })}
                title={c.label}
              >
                <Swatch def={c} color={DEFAULT_CURSOR_COLOR} size={24} />
                <span className="cur-name">{c.label}</span>
              </button>
            ))}
            {customs.map((c) => {
              const def = PREMADE_CURSORS.find((p) => p.id === c.base);
              return (
                <button
                  key={c.id}
                  className={`cur-cell cur-custom${s.cursorId === c.id ? ' on' : ''}`}
                  onClick={() => setTab({ cursorId: c.id })}
                  title={c.name}
                >
                  {def && <Swatch def={def} color={c.color} size={c.size} />}
                  <span className="cur-name">{c.name}</span>
                  <span className="cur-del" title="Delete this custom cursor" onClick={(e) => { e.stopPropagation(); deleteCustom(c.id); }}>×</span>
                </button>
              );
            })}
          </div>

          <div className="field-section">Make a custom cursor</div>
          <div className="cur-builder">
            <select value={base} onChange={(e) => setBase(e.target.value)} title="Shape">
              {SVG_CURSORS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Colour" />
            <input
              type="range" min={CURSOR_MIN_SIZE} max={CURSOR_MAX_SIZE} step={2}
              value={clampCursorSize(size)} onChange={(e) => setSize(Number(e.target.value))} title="Size"
            />
            <span className="range-val">{clampCursorSize(size)}px</span>
            {/* Live preview at true size, over a strip of text. */}
            <span className="cur-preview" style={{ cursor: cursorCss(PREMADE_CURSORS.find((c) => c.id === base), { color, size }) }}>
              hover here to preview
            </span>
            <button className="toggle-on" onClick={saveCustom}>Save &amp; use</button>
          </div>

          <div className="field-section">Trail</div>
          <div className="field-row">
            <label>Trail effect</label>
            <div>
              <select value={s.cursorTrail || 'off'} onChange={(e) => setTab({ cursorTrail: e.target.value })}>
                {TRAIL_MODES.map((m) => <option key={m} value={m}>{TRAIL_LABELS[m]}</option>)}
              </select>
            </div>
          </div>
          {s.cursorTrail && s.cursorTrail !== 'off' && (
            <>
              <div className="field-row">
                <label>Trail colour</label>
                <div><input type="color" value={s.cursorTrailColor || DEFAULT_CURSOR_COLOR} onChange={(e) => setTab({ cursorTrailColor: e.target.value })} /></div>
              </div>
              <div className="field-row">
                <label>Trail length</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range" min={TRAIL_MIN_MS} max={TRAIL_MAX_MS} step={100}
                    value={clampTrailMs(s.cursorTrailMs)} onChange={(e) => setTab({ cursorTrailMs: clampTrailMs(e.target.value) })}
                  />
                  <span className="range-val">{(clampTrailMs(s.cursorTrailMs) / 1000).toFixed(1)}s</span>
                </div>
              </div>
              <p className="settings-note">
                {s.cursorTrail === 'seismograph'
                  ? 'Seismograph: hold the pointer over the text and scroll — the trace draws like a needle on a drum as the lines pass under it.'
                  : 'Fade: a comet tail follows the pointer and fades out over the trail length.'}
              </p>
            </>
          )}
          <p className="settings-note">Active cursor: <code>{typeof activeCss === 'string' ? activeCss.slice(0, 48) : 'system'}{activeCss.length > 48 ? '…' : ''}</code></p>
        </>
      )}
    </Dialog>
  );
}
