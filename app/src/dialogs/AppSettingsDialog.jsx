import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { DEFAULT_COMFORT } from '../engine/comfort.js';
import { resetGlobalToDefaults } from '../state/settings.js';
import { LANGUAGES } from '../state/languages.js';
import FontPicker from '../components/FontPicker.jsx';

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

export default function AppSettingsDialog({ global, onPatch, onCalibrate, onClose }) {
  const [g, setG] = useState(global);
  function patch(p) {
    setG({ ...g, ...p });
    onPatch(p);
  }

  const comfort = { ...DEFAULT_COMFORT, ...(g.comfort || {}) };
  function patchComfort(p) {
    patch({ comfort: { ...comfort, ...p } });
  }

  function resetAll() {
    if (!window.confirm(
      'Reset all application settings to their defaults?\n\n' +
      'Your documents, recent files, vocabulary, book groups, sync setup, calibration and your ' +
      'Default Tab Settings are kept — only app preferences (fonts, startup, guards, audio, etc.) ' +
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
        App-wide options. Per-document appearance and behavior live in <strong>View → Tab Settings</strong>;
        the defaults for new tabs live in <strong>File → Default Tab Settings</strong>.
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

      <div className="field-section">Fonts</div>
      <Field label="Serif font">
        <FontPicker
          value={g.defaultSerifFamily || ''}
          defaultCategory="serif"
          googleEnabled={!!g.enableGoogleFonts}
          onChange={(css) => patch({ defaultSerifFamily: css })}
        />
      </Field>
      <Field label="Sans font">
        <FontPicker
          value={g.defaultSansFamily || ''}
          defaultCategory="sans"
          googleEnabled={!!g.enableGoogleFonts}
          onChange={(css) => patch({ defaultSansFamily: css })}
        />
      </Field>
      <Field label="Google Fonts library">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.enableGoogleFonts}
            onChange={(e) => patch({ enableGoogleFonts: e.target.checked })}
          />
          Allow loading any of the ~1,700 Google Fonts from Google’s CDN
        </label>
      </Field>
      <p className="settings-note">
        Bundled open fonts and your device’s installed fonts work offline and send nothing anywhere.
        Turning on the Google Fonts library lets you pick from the full catalogue (or type any family
        name), but each font is fetched from <strong>Google’s servers</strong> when used — which needs
        the network and reveals your IP/usage to Google. Off by default; see PRIVACY.md.
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
      <Field label="Webcam attention (experimental)">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamAttention}
            onChange={(e) => patch({ webcamAttention: e.target.checked })}
          />
          Pause fast reading when the camera can’t see you facing the screen with eyes open
        </label>
      </Field>
      <Field label="Doze detection (experimental)">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamDoze}
            onChange={(e) => patch({ webcamDoze: e.target.checked })}
          />
          Stop read-aloud if your eyes stay shut or you’re away for a while
        </label>
      </Field>
      <Field label="Away alarm (experimental)">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamAwayAlarm}
            onChange={(e) => patch({ webcamAwayAlarm: e.target.checked })}
          />
          Sound an alarm if you look away for too long
        </label>
      </Field>
      <Field label="Alarm after (seconds)">
        <input
          type="number"
          min={3}
          max={300}
          value={g.webcamAwayAlarmSec ?? 15}
          disabled={!g.webcamAwayAlarm}
          onChange={(e) => patch({ webcamAwayAlarmSec: Math.max(3, Math.min(300, Number(e.target.value) || 15)) })}
          style={{ width: 70 }}
        />
      </Field>
      <Field label="Escalating alarm">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamEscalatingAlarm}
            disabled={!g.webcamAwayAlarm}
            onChange={(e) => patch({ webcamEscalatingAlarm: e.target.checked })}
          />
          Start quiet and get louder the longer you stay away
        </label>
      </Field>
      <Field label="Posture nudge (experimental)">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamDistanceNudge}
            onChange={(e) => patch({ webcamDistanceNudge: e.target.checked })}
          />
          Remind me to ease back when I’m sitting too close to the screen
        </label>
      </Field>
      <Field label="Look-away analytics (experimental)">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamFocusStats}
            onChange={(e) => patch({ webcamFocusStats: e.target.checked })}
          />
          Log focus % and distractions per session into Reading History
        </label>
      </Field>
      <Field label="Camera preview">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={g.webcamPreview !== false}
            onChange={(e) => patch({ webcamPreview: e.target.checked })}
          />
          Show a small live self-view while a webcam guard is on
        </label>
      </Field>
      <Field label="Eye calibration">
        <button onClick={onCalibrate} disabled={!onCalibrate}>⚙ Calibrate eye detection…</button>
      </Field>
      <p className="settings-note">
        Both use on-device face detection — camera frames are analysed locally and are never recorded,
        saved, or uploaded; the camera only runs while one of these is on. Eye-open detection loads a
        small face-landmark model on first use (needs network once, like the OCR data) and a WebGL
        browser; without it, attention falls back to “facing the screen” and doze to “away for a while.”
        Calibration tunes eyes-open vs eyes-shut to your face/glasses. Typing and (for the attention
        guard) read-aloud are never paused.
      </p>

      <div className="field-section">Typing practice</div>
      <Field label="End-of-run grade fanfare">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={g.typingEndFanfare !== false}
            onChange={(e) => patch({ typingEndFanfare: e.target.checked })}
          />
          Show a grade + final remark and play a grade-matched sound when a typing run ends
        </label>
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
        Icons shown on the ToC minimap bar for each hierarchy tier (Tier 0 = top, e.g. Book →
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

      <div className="field-section">Comfort &amp; breaks</div>
      <Field label="Eye-rest microbreaks">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!comfort.enabled}
            onChange={(e) => patchComfort({ enabled: e.target.checked })}
          />
          Prompt a 20-20-20 break while reading
        </label>
      </Field>
      <Field label="Break every (minutes of reading)">
        <input
          type="number"
          min={1}
          max={120}
          value={comfort.breakIntervalMin}
          disabled={!comfort.enabled}
          onChange={(e) => patchComfort({ breakIntervalMin: Math.max(1, Number(e.target.value) || 1) })}
          style={{ width: 70 }}
        />
      </Field>
      <Field label="Rest length (seconds)">
        <input
          type="number"
          min={1}
          max={120}
          value={comfort.microbreakSec}
          disabled={!comfort.enabled}
          onChange={(e) => patchComfort({ microbreakSec: Math.max(1, Number(e.target.value) || 1) })}
          style={{ width: 70 }}
        />
      </Field>
      <Field label="Ease speed when tired">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!comfort.autoBackoff}
            onChange={(e) => patchComfort({ autoBackoff: e.target.checked })}
          />
          Lower WPM after a break if fatigue is high
        </label>
      </Field>
      <p className="settings-note">
        Speed-reading removes the natural pauses paged reading gives you, so eye strain builds up
        quietly. Breaks follow the 20-20-20 guideline (every ~20 min, look ~20&nbsp;ft / 6&nbsp;m
        away for ~20&nbsp;s) and speed-easing nudges WPM down only when comprehension checks and
        time-on-task both suggest you are tiring. This is a comfort aid, not medical advice. Take a
        break any time from <strong>View → Take a Break Now</strong>.
      </p>
    </Dialog>
  );
}
