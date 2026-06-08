import { useState } from 'react';
import Dialog from './Dialog.jsx';

// Application-wide settings only. These are deliberately disjoint from per-tab settings:
// anything that varies per document lives in Tab Settings / Default Tab Settings instead.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

const AUDIO_MODES = ['Voice', 'Claps', 'Both'];

export default function AppSettingsDialog({ global, onPatch, onClose }) {
  const [g, setG] = useState(global);
  function patch(p) {
    setG({ ...g, ...p });
    onPatch(p);
  }

  return (
    <Dialog title="Application Settings" onClose={onClose} width={560} buttons={<button onClick={onClose}>Close</button>}>
      <p className="settings-note">
        App-wide options. Per-document appearance and behavior live in <strong>View → Tab Settings</strong>;
        the defaults for new tabs live in <strong>File → Default Tab Settings</strong>.
      </p>

      <div className="field-section">Fonts</div>
      <Field label="Default serif font family">
        <input
          type="text"
          value={g.defaultSerifFamily || ''}
          onChange={(e) => patch({ defaultSerifFamily: e.target.value })}
          style={{ width: '100%' }}
          placeholder='Cambria, Georgia, "Times New Roman", serif'
        />
      </Field>
      <Field label="Default sans font family">
        <input
          type="text"
          value={g.defaultSansFamily || ''}
          onChange={(e) => patch({ defaultSansFamily: e.target.value })}
          style={{ width: '100%' }}
          placeholder="Segoe UI, Arial, sans-serif"
        />
      </Field>

      <div className="field-section">Audio control</div>
      <Field label="Hands-free mode">
        <select value={g.audioCtrlMode || 'Both'} onChange={(e) => patch({ audioCtrlMode: e.target.value })}>
          {AUDIO_MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <p className="settings-note">
        Voice commands and clap detection require microphone permission; voice commands need a
        Chromium browser. Enable per tab with the <strong>AUDIO</strong> button.
      </p>

      <div className="field-section">Table of contents</div>
      <p className="settings-note">
        Icons shown on the TOC minimap bar for each hierarchy tier (Tier 0 = top, e.g. Book →
        Part → Chapter). One emoji or character each. Numeral display and per-tier numeral regex
        are per document — see <strong>View → Tab Settings</strong>.
      </p>
      <div className="toc-tier-icons">
        {Array.from({ length: 5 }, (_, lvl) => (
          <label key={lvl} className="toc-tier-icon-field">
            <span>Tier {lvl}</span>
            <input
              type="text"
              maxLength={3}
              value={(g.tocTierIcons || [])[lvl] || ''}
              onChange={(e) => {
                const icons = [...(g.tocTierIcons || [])];
                icons[lvl] = e.target.value;
                patch({ tocTierIcons: icons });
              }}
            />
          </label>
        ))}
      </div>
    </Dialog>
  );
}
