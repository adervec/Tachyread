import { useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Crosshair } from '../components/CrosshairOverlay.jsx';
import {
  XH_SHAPES, newCrosshair, newShapeLayer, newImageLayer, newEmojiLayer, newCrosshairId,
  starterStable, placeCrosshair, removeCrosshair, resizeCrosshair,
} from '../features/crosshairs.js';

// The crosshair STABLE manager: design overlay markers for the Lines area by combining shape,
// image and emoji layers with transparency and behind-the-glass distortion effects, then place
// any of them on the current tab (placement + size are per-tab; drag them in the pane to move).
// The stable itself is device data — it survives settings resets, like custom cursors.

function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog while the reader holds a steady line of focus across the page, word after word after word. '.repeat(3);

export default function CrosshairDialog({ global, onPatchGlobal, settings, onPatch, onClose }) {
  const stable = global.crosshairStable || [];
  const placements = settings?.linesCrosshairs || [];
  const [selId, setSelId] = useState(stable[0]?.id || '');
  const sel = stable.find((c) => c.id === selId) || null;
  const fileRef = useRef(null);

  const setStable = (list) => onPatchGlobal({ crosshairStable: list });
  const patchSel = (p) => setStable(stable.map((c) => (c.id === selId ? { ...c, ...p } : c)));
  const patchFx = (p) => patchSel({ fx: { ...(sel?.fx || {}), ...p } });
  const patchLayer = (i, p) => patchSel({ layers: sel.layers.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const addLayer = (layer) => patchSel({ layers: [...(sel?.layers || []), layer] });
  const dropLayer = (i) => patchSel({ layers: sel.layers.filter((_, j) => j !== i) });

  function create() {
    const name = (window.prompt('Name the new crosshair:', 'My crosshair') || '').trim();
    if (!name) return;
    const c = newCrosshair(name, Date.now());
    setStable([...stable, c]);
    setSelId(c.id);
  }
  function duplicate() {
    if (!sel) return;
    const copy = { ...sel, id: newCrosshairId(Date.now()), name: `${sel.name} copy` };
    setStable([...stable, copy]);
    setSelId(copy.id);
  }
  function rename() {
    if (!sel) return;
    const name = (window.prompt('Rename crosshair to:', sel.name) || '').trim();
    if (name) patchSel({ name });
  }
  function remove() {
    if (!sel) return;
    if (!window.confirm(`Delete “${sel.name}” from the stable? Tabs where it's placed will simply stop showing it.`)) return;
    setStable(stable.filter((c) => c.id !== selId));
    setSelId(stable.find((c) => c.id !== selId)?.id || '');
  }
  function addStarters() {
    const pack = starterStable(Date.now());
    setStable([...stable, ...pack]);
    if (!selId) setSelId(pack[0].id);
  }

  // Image layer: file → ≤128px data URL, so a stable of designs stays small in storage.
  function pickImage() { fileRef.current?.click(); }
  function onImageFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 128 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * k));
      cv.height = Math.max(1, Math.round(img.height * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      addLayer(newImageLayer(cv.toDataURL('image/png')));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  }

  const num = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

  return (
    <Dialog title="Crosshairs (Lines overlays)" onClose={onClose} width={640} buttons={<button onClick={onClose}>Close</button>}>
      <p className="settings-note">
        Design reading crosshairs — combine <b>shapes, images and emoji</b> with transparency and
        <b> distortion of the text behind them</b> (blur, invert, hue, heat-haze warp) — then place
        any of them on this tab’s Lines area and <b>drag them</b> where your eye should anchor.
        The stable is shared by all tabs; placements are per tab.
      </p>

      <div className="xh-bar">
        <select value={selId} onChange={(e) => setSelId(e.target.value)}>
          <option value="">— pick a crosshair —</option>
          {stable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={create}>+ New</button>
        <button onClick={addStarters} title="Add five ready-made designs to play with">✨ Starter pack</button>
        <button disabled={!sel} onClick={duplicate}>Duplicate</button>
        <button disabled={!sel} onClick={rename}>Rename</button>
        <button disabled={!sel} className="grab-trash" onClick={remove}>🗑</button>
      </div>

      {sel && (
        <>
          {/* Live preview over real text — transparency and the backdrop distortion need something behind them. */}
          <div className="xh-preview">
            <div className="xh-preview-text">{PREVIEW_TEXT}</div>
            <Crosshair design={sel} size={110} style={{ left: '50%', top: '50%', position: 'absolute', transform: 'translate(-50%, -50%)' }} />
          </div>

          <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Layers (drawn in order)</div>
          {sel.layers.map((l, i) => (
            <div key={i} className="xh-layer-row">
              {l.kind === 'shape' && (
                <>
                  <select value={l.shape} onChange={(e) => patchLayer(i, { shape: e.target.value })}>
                    {XH_SHAPES.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
                  </select>
                  <input type="color" value={l.color || '#ff5c5c'} onChange={(e) => patchLayer(i, { color: e.target.value })} title="Layer colour" />
                  <label title="Stroke thickness">t<input type="range" min={1} max={12} step={1} value={l.thickness ?? 3} onChange={(e) => patchLayer(i, { thickness: Number(e.target.value) })} /></label>
                </>
              )}
              {l.kind === 'image' && <span className="xh-layer-tag">🖼 image{l.src ? '' : ' (pick one)'}</span>}
              {l.kind === 'emoji' && (
                <input className="xh-emoji-in" type="text" value={l.char || ''} maxLength={4}
                  onChange={(e) => patchLayer(i, { char: e.target.value })} title="The emoji / character to show" />
              )}
              <label title="Layer size">s<input type="range" min={0.1} max={1.6} step={0.05} value={l.scale ?? 1} onChange={(e) => patchLayer(i, { scale: Number(e.target.value) })} /></label>
              <label title="Rotation">↻<input type="range" min={-180} max={180} step={5} value={l.rotate ?? 0} onChange={(e) => patchLayer(i, { rotate: Number(e.target.value) })} /></label>
              <label title="Layer transparency">◐<input type="range" min={0.05} max={1} step={0.05} value={l.opacity ?? 1} onChange={(e) => patchLayer(i, { opacity: Number(e.target.value) })} /></label>
              <button title="Remove this layer" onClick={() => dropLayer(i)}>✕</button>
            </div>
          ))}
          <div className="xh-bar">
            <button onClick={() => addLayer(newShapeLayer('circle'))}>+ Shape</button>
            <button onClick={pickImage}>+ Image…</button>
            <button onClick={() => addLayer(newEmojiLayer('🎯'))}>+ Emoji</button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageFile} />
          </div>

          <Field label="Overall transparency">
            <input type="range" min={0.05} max={1} step={0.05} value={sel.opacity ?? 0.9} onChange={(e) => patchSel({ opacity: Number(e.target.value) })} />
            <span className="range-val">{Math.round((sel.opacity ?? 0.9) * 100)}%</span>
          </Field>

          <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Distortion of the text behind (the glass)</div>
          <Field label="Blur">
            <input type="range" min={0} max={12} step={0.5} value={sel.fx?.blur ?? 0} onChange={(e) => patchFx({ blur: Number(e.target.value) })} />
            <span className="range-val">{num(sel.fx?.blur ?? 0)}px</span>
          </Field>
          <Field label="Invert">
            <input type="range" min={0} max={1} step={0.05} value={sel.fx?.invert ?? 0} onChange={(e) => patchFx({ invert: Number(e.target.value) })} />
            <span className="range-val">{Math.round((sel.fx?.invert ?? 0) * 100)}%</span>
          </Field>
          <Field label="Grayscale">
            <input type="range" min={0} max={1} step={0.05} value={sel.fx?.grayscale ?? 0} onChange={(e) => patchFx({ grayscale: Number(e.target.value) })} />
            <span className="range-val">{Math.round((sel.fx?.grayscale ?? 0) * 100)}%</span>
          </Field>
          <Field label="Hue shift">
            <input type="range" min={0} max={360} step={5} value={sel.fx?.hueRotate ?? 0} onChange={(e) => patchFx({ hueRotate: Number(e.target.value) })} />
            <span className="range-val">{sel.fx?.hueRotate ?? 0}°</span>
          </Field>
          <Field label="Contrast">
            <input type="range" min={0.4} max={2.5} step={0.05} value={sel.fx?.contrast ?? 1} onChange={(e) => patchFx({ contrast: Number(e.target.value) })} />
            <span className="range-val">{num(sel.fx?.contrast ?? 1, 2)}×</span>
          </Field>
          <Field label="Warp (heat haze)">
            <input type="range" min={0} max={60} step={2} value={sel.fx?.warp ?? 0} onChange={(e) => patchFx({ warp: Number(e.target.value) })} />
            <span className="range-val">{sel.fx?.warp ?? 0}</span>
          </Field>

          {settings && onPatch && (
            <>
              <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>On this tab</div>
              <div className="xh-bar">
                <button className="toggle-on" onClick={() => onPatch({ linesCrosshairs: placeCrosshair(placements, sel.id) })}>
                  ➕ Place “{sel.name}” on this tab
                </button>
              </div>
            </>
          )}
        </>
      )}

      {settings && onPatch && placements.length > 0 && (
        <div className="xh-placed">
          {placements.map((p, i) => {
            const d = stable.find((c) => c.id === p.id);
            return (
              <div key={i} className="xh-layer-row">
                <span className="xh-layer-tag">{d ? d.name : '(deleted design)'}</span>
                <label title="Placed size">size<input type="range" min={24} max={400} step={4} value={p.size || 90}
                  onChange={(e) => onPatch({ linesCrosshairs: resizeCrosshair(placements, i, Number(e.target.value)) })} /></label>
                <span className="range-val">{p.size || 90}px</span>
                <button title="Remove from this tab" onClick={() => onPatch({ linesCrosshairs: removeCrosshair(placements, i) })}>✕</button>
              </div>
            );
          })}
          <p className="settings-note" style={{ margin: '4px 0 0' }}>Drag a crosshair in the Lines area to move it. Positions are per tab.</p>
        </div>
      )}

      {!stable.length && (
        <p className="settings-note">The stable is empty — hit <b>✨ Starter pack</b> for five ready-made designs, or <b>+ New</b> to build your own.</p>
      )}
    </Dialog>
  );
}
