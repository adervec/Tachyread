import { useState } from 'react';
import Dialog from './Dialog.jsx';
import Face from '../components/Face.jsx';
import { useApp } from '../state/AppContext.jsx';

const FACE_STYLES = ['Man', 'Owl', 'Robot', 'Alien', 'Wizard', 'Cat', 'Baby', 'Skull', 'Panda', 'Frankenstein', 'Vampire', 'Viking', 'Clown', 'Bunny', 'Dragon', 'Ninja'];
const ART_STYLES = ['Cartoon', 'Flat', 'Sketch', 'Neon', 'Watercolor', 'Pastel'];

// Face Library: browse every procedural face style, preview how it animates across the
// WPM range, choose an art style, and assign faces to the (up to 3) reader slots.
export default function FaceLibraryDialog({ onClose }) {
  const { activeTab, patchSettings } = useApp();
  const s = activeTab?.settings;
  const [art, setArt] = useState(s?.artStyle || 'Cartoon');
  const [wpm, setWpm] = useState(s?.wpm || 250);
  const [slot, setSlot] = useState(0);

  if (!activeTab) {
    return (
      <Dialog title="Face Library" onClose={onClose} width={680}>
        <p>Open a document first to configure reader faces.</p>
      </Dialog>
    );
  }

  const faceCount = Math.max(1, Math.min(3, s.faceCount || 1));
  const styles = (s.faceStyles && [...s.faceStyles]) || ['Man', 'Owl', 'Robot'];
  while (styles.length < 3) styles.push('Man');

  function assign(style) {
    const arr = [...styles];
    arr[slot] = style;
    patchSettings(activeTab.id, { faceStyles: arr, showEyes: true });
  }
  function setArtStyle(a) {
    setArt(a);
    patchSettings(activeTab.id, { artStyle: a });
  }

  return (
    <Dialog
      title="Face Library"
      onClose={onClose}
      width={760}
      buttons={<button onClick={onClose}>Close</button>}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label>
          Show faces{' '}
          <input
            type="checkbox"
            checked={!!s.showEyes}
            onChange={(e) => patchSettings(activeTab.id, { showEyes: e.target.checked })}
          />
        </label>
        <label>
          Faces{' '}
          <input
            type="number"
            min={1}
            max={3}
            value={faceCount}
            style={{ width: 48 }}
            onChange={(e) => patchSettings(activeTab.id, { faceCount: Math.max(1, Math.min(3, Number(e.target.value))) })}
          />
        </label>
        <label>
          Art style{' '}
          <select value={art} onChange={(e) => setArtStyle(e.target.value)}>
            {ART_STYLES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Editing slot{' '}
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {Array.from({ length: faceCount }, (_, i) => (
              <option key={i} value={i}>
                Face {i + 1} ({styles[i]})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--status-fg)' }}>Preview WPM</span>
        <input type="range" min={0} max={1100} step={10} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ width: 44, textAlign: 'right' }}>{wpm}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
        {FACE_STYLES.map((style) => {
          const selected = styles[slot] === style;
          return (
            <button
              key={style}
              onClick={() => assign(style)}
              title={`Assign ${style} to face slot ${slot + 1}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: 6,
                background: selected ? 'var(--toggle-active-bg)' : 'var(--btn-bg)',
                color: selected ? 'var(--toggle-active-fg)' : 'var(--btn-fg)',
                borderColor: selected ? 'var(--toggle-active-bg)' : 'var(--btn-border)',
              }}
            >
              <Face wpm={wpm} lineProgress={0.5} faceStyle={style} artStyle={art} size={72} />
              <span style={{ fontSize: 11 }}>{style}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
