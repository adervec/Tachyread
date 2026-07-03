import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { DEFAULT_COMFORT } from '../engine/comfort.js';

// Eye-comfort settings: 20-20-20 microbreaks and fatigue-aware speed easing. Split out of
// Application Settings so that dialog stays a short "general" page.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function ComfortSettingsDialog({ global, onPatch, onClose }) {
  const [g, setG] = useState(global);
  const comfort = { ...DEFAULT_COMFORT, ...(g.comfort || {}) };
  function patchComfort(p) {
    const next = { comfort: { ...comfort, ...p } };
    setG({ ...g, ...next });
    onPatch(next);
  }

  return (
    <Dialog title="Comfort & Breaks" onClose={onClose} width={520} buttons={<button onClick={onClose}>Close</button>}>
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
        break any time from <strong>Train → Take a Break Now</strong>.
      </p>
    </Dialog>
  );
}
