import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { resetGlobalToDefaults } from '../state/settings.js';
import { LANGUAGES } from '../state/languages.js';

// General application settings ONLY. Everything domain-specific lives on its own page under the
// Settings / Typing / Audio menus: Camera & Gestures, Comfort & Breaks, Font Manager (incl. the
// Google Fonts opt-in), Typing Settings, Audio Settings. Per-document options are in Tab Settings.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function AppSettingsDialog({ global, onPatch, onClose }) {
  const [g, setG] = useState(global);
  function patch(p) {
    setG({ ...g, ...p });
    onPatch(p);
  }

  function resetAll() {
    if (!window.confirm(
      'Reset all application settings to their defaults?\n\n' +
      'Your documents, recent files, vocabulary, book groups, sync setup, calibration and your ' +
      'Default Tab Settings are kept — only app preferences (startup, guards, audio, etc.) ' +
      'are restored.'
    )) return;
    const next = resetGlobalToDefaults(g);
    setG(next);
    onPatch(next);
  }

  return (
    <Dialog
      title="Application Settings"
      onClose={onClose}
      width={560}
      buttons={
        <>
          <button onClick={resetAll} title="Restore app preferences to defaults (your data is kept)">↺ Reset to defaults</button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <p className="settings-note">
        General app-wide options. Camera &amp; Gestures, Comfort &amp; Breaks and the Font Manager
        have their own pages under <strong>Settings</strong>; typing and audio options live under
        <strong> Typing</strong> and <strong>Audio</strong>. Per-document appearance is in
        <strong> Settings → Tab Settings</strong>.
      </p>

      <div className="field-section">Language</div>
      <Field label="Document language">
        <select
          value={g.language || 'en'}
          onChange={(e) => patch({ language: e.target.value })}
          title="Language of the documents you read — drives OCR, dictation & read-along speech recognition, and TTS voice matching. The app UI stays English."
        >
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </Field>
      <p className="settings-note">
        Used by Grab Text (OCR), Dictation, read-along Speaking mode, and to pick a matching
        read-aloud voice. The first Grab in a new language downloads its recognition data once.
      </p>

      <div className="field-section">Startup &amp; mobile</div>
      <Field label="Start on the landing page">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={g.startOnLanding !== false}
            onChange={(e) => patch({ startOnLanding: e.target.checked })}
          />
          Launch with no tab open, so a document isn’t shown until you pick its tab
        </label>
      </Field>
      <Field label="Load tabs on demand (small screens)">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={g.lazyTabsMobile !== false}
            onChange={(e) => patch({ lazyTabsMobile: e.target.checked })}
          />
          On phones, don’t parse a restored document until its tab is opened (saves memory)
        </label>
      </Field>
      <Field label="Show performance meter">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={g.showPerfMeter !== false}
            onChange={(e) => patch({ showPerfMeter: e.target.checked })}
          />
          A small frame-rate / “working hard” readout in the status bar
        </label>
      </Field>
      <Field label="Swipe gestures">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.gestureControls}
            onChange={(e) => patch({ gestureControls: e.target.checked })}
          />
          Horizontal swipe over the text steps lines (long swipe = paragraph)
        </label>
      </Field>
      <Field label="Auto-minimize controls while reading">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.autoMinimizeControls}
            onChange={(e) => patch({ autoMinimizeControls: e.target.checked })}
          />
          On phones, collapse the bottom controls during playback for more text room
        </label>
      </Field>

      <div className="field-section">Reading guard</div>
      <Field label="Pause when text isn’t visible">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={g.pauseWhenTextHidden !== false}
            onChange={(e) => patch({ pauseWhenTextHidden: e.target.checked })}
          />
          Pause fast reading if the text scrolls off-screen (read-aloud keeps going)
        </label>
      </Field>

      <div className="field-section">Table of contents</div>
      <p className="settings-note">
        Icons shown on the ToC minimap bar for each hierarchy tier (Tier 0 = top, e.g. Book →
        Part → Chapter). One emoji or character each. Numeral display and per-tier numeral regex
        are per document — see <strong>Settings → Tab Settings</strong>.
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
