import { useState } from 'react';
import Dialog from './Dialog.jsx';
import FaceSVG from '../components/FaceSVG.jsx';
import FacePreview from '../components/FacePreview.jsx';
import { useApp } from '../state/AppContext.jsx';
import { FACE_STYLES } from '../components/faceDecor3d.js';
import { FACE_WPM_MAX, FACE_TIER_LABELS, faceTier } from '../engine/faceExpression.js';
import { t } from '../i18n.js';

const ART_STYLES = ['Cartoon', 'Flat', 'Sketch', 'Neon', 'Watercolor', 'Pastel'];
// Art styles, face styles (SettingsDialog's list) and the WPM tier labels are shown through t(): i18n-keys: Cartoon | Flat | Sketch | Neon | Watercolor | Pastel
// i18n-keys: warming up | slow | building | average | brisk | fast | very fast | exceptional

// Avatar Library: browse every procedural face style, preview how it animates across the
// WPM range, choose an art style, and assign faces to the (up to 3) reader slots.
export default function FaceLibraryDialog({ onClose }) {
  const { activeTab, patchSettings } = useApp();
  const s = activeTab?.settings;
  const [art, setArt] = useState(s?.artStyle || 'Cartoon');
  const [wpm, setWpm] = useState(s?.wpm || 250);
  const [slot, setSlot] = useState(0);

  if (!activeTab) {
    return (
      <Dialog title={t('Avatar Library')} onClose={onClose} width={680}>
        <p>{t('Open a document first to configure reader avatars.')}</p>
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
      title={t('Avatar Library')}
      onClose={onClose}
      width={760}
      buttons={<button onClick={onClose}>{t('Close')}</button>}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label>
          {t('Show avatars')}{' '}
          <input
            type="checkbox"
            checked={!!s.showEyes}
            onChange={(e) => patchSettings(activeTab.id, { showEyes: e.target.checked })}
          />
        </label>
        <label>
          {t('Avatars')}{' '}
          <input
            type="number"
            min={1}
            max={3}
            value={faceCount}
            style={{ width: 48 }}
            onChange={(e) => patchSettings(activeTab.id, { faceCount: Math.max(1, Math.min(3, Number(e.target.value))) })}
          />
        </label>
        <label title={t('Floating cartoon-glove hands beside each avatar, tinted to match it — they mirror your biometric controls (gestures, joystick, claps, voice) and move with the current activity')}>
          🤚 {t('Floating hands')}{' '}
          <input
            type="checkbox"
            checked={!!s.avatarHands}
            onChange={(e) => patchSettings(activeTab.id, { avatarHands: e.target.checked })}
          />
        </label>
        <label>
          {t('Art style')}{' '}
          <select value={art} onChange={(e) => setArtStyle(e.target.value)}>
            {ART_STYLES.map((a) => (
              <option key={a} value={a}>{t(a)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('Editing slot')}{' '}
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {Array.from({ length: faceCount }, (_, i) => (
              <option key={i} value={i}>
                {t('Face {n} ({style})', { n: i + 1, style: t(styles[i]) })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Large live 3D preview of the currently edited slot's style (own WebGL context). */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <div style={{ textAlign: 'center' }}>
          <FacePreview faceStyle={styles[slot]} artStyle={art} wpm={wpm} size={184} />
          <div style={{ fontSize: 12, color: 'var(--status-fg)', marginTop: 4 }}>
            {t('Avatar {n}: {style}', { n: slot + 1, style: t(styles[slot]) })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--status-fg)' }}>{t('Preview WPM')}</span>
        <input type="range" min={0} max={Math.round(FACE_WPM_MAX * 1.2)} step={10} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ width: 96, textAlign: 'end' }} title={t('Tier {tier} of 7 — the face is fully lit at {max} wpm sustained', { tier: faceTier(wpm), max: FACE_WPM_MAX })}>
          {wpm} · {t(FACE_TIER_LABELS[faceTier(wpm)])}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
        {FACE_STYLES.map((style) => {
          const selected = styles[slot] === style;
          return (
            <button
              key={style}
              onClick={() => assign(style)}
              title={t('Assign {style} to avatar slot {n}', { style: t(style), n: slot + 1 })}
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
              <FaceSVG wpm={wpm} lineProgress={0.5} faceStyle={style} artStyle={art} size={72} />
              <span style={{ fontSize: 11 }}>{t(style)}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
