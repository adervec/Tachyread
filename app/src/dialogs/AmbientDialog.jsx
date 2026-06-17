import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { ambient, AMBIENT_TYPES, AMBIENT_MAX_VOLUME } from '../features/ambient.js';

// Ambient background sound — a quiet bed to read or wind down to. No warnings/gating: these are
// ordinary ambient tracks. The engine hard-caps its level below speech and ducks while read-aloud
// is talking, so it can never overpower the voice. The sound keeps playing after this dialog closes.
export default function AmbientDialog({ onClose }) {
  const { state, updateGlobal } = useApp();
  const saved = state.global.ambient || {};
  const [type, setType] = useState(saved.type || 'Brown');
  const [volume, setVolume] = useState(saved.volume ?? 0.18);
  const [running, setRunning] = useState(ambient.isRunning());

  function changeType(t) {
    setType(t);
    ambient.setType(t);
    updateGlobal({ ambient: { type: t, volume } });
  }
  function changeVolume(v) {
    setVolume(v);
    ambient.setVolume(v);
    updateGlobal({ ambient: { type, volume: v } });
  }
  function startIt() { ambient.start(type, volume); setRunning(true); }
  function stopIt() { ambient.stop(); setRunning(false); }

  return (
    <Dialog
      title="Ambient Sound"
      onClose={onClose}
      width={460}
      buttons={<button onClick={onClose}>Close</button>}
    >
      <p className="settings-note">
        A quiet background bed to read or wind down to — rain, ocean, wind, noise colours, or a 40&nbsp;Hz
        focus tone. It stays below speech level and automatically ducks while read-aloud is talking, so it
        never competes with the voice. Keeps playing after you close this.
      </p>

      <div className="ambient-grid">
        {AMBIENT_TYPES.map((t) => (
          <button key={t} className={`ambient-chip${type === t ? ' on' : ''}`} onClick={() => changeType(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="field-row" style={{ marginTop: 12 }}>
        <label>Volume</label>
        <div>
          <input
            type="range"
            min={0}
            max={AMBIENT_MAX_VOLUME}
            step={0.01}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            style={{ width: 200 }}
          />
          <span className="settings-note" style={{ marginLeft: 8 }}>capped low on purpose</span>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {running ? (
          <button className="dict-rec on" onClick={stopIt}>■ Stop</button>
        ) : (
          <button className="dict-rec" onClick={startIt}>● Play {type}</button>
        )}
      </div>
    </Dialog>
  );
}
