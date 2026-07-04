import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { DEFAULT_GESTURES, GESTURE_INFO } from '../features/handGestures.js';

// Everything the camera can do, in one place: attention/doze guards, alarms, posture nudge,
// focus analytics, the self-view, hand-gesture controls, and both calibrations. Split out of
// Application Settings so that dialog stays a short "general" page.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function CameraSettingsDialog({ global, onPatch, onCalibrate, onCalibrateHand, isCompact = false, onClose }) {
  const [g, setG] = useState(global);
  function patch(p) {
    setG({ ...g, ...p });
    onPatch(p);
  }

  return (
    <Dialog title="Camera & Gestures" onClose={onClose} width={560} buttons={<button onClick={onClose}>Close</button>}>
      {isCompact && (
        <p className="settings-note" style={{ marginTop: 0, color: 'var(--ox-bright, #b0413e)' }}>
          📵 Front-camera features (attention, doze, alarms, posture, hand gestures) are <strong>off on mobile</strong> —
          they’re battery/CPU-heavy and a phone rarely faces you squarely. <strong>OCR / Grab</strong> (rear/document
          camera) still works. These settings apply when you open the same account on a desktop.
        </p>
      )}
      <div className="field-section">Attention guards (experimental)</div>
      <Field label="Webcam attention">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamAttention}
            onChange={(e) => patch({ webcamAttention: e.target.checked })}
          />
          Pause fast reading when the camera can’t see you facing the screen with eyes open
        </label>
      </Field>
      <Field label="Doze detection">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamDoze}
            onChange={(e) => patch({ webcamDoze: e.target.checked })}
          />
          Stop read-aloud if your eyes stay shut or you’re away for a while
        </label>
      </Field>
      <Field label="Away alarm">
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
      <Field label="Posture nudge">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.webcamDistanceNudge}
            onChange={(e) => patch({ webcamDistanceNudge: e.target.checked })}
          />
          Remind me to ease back when I’m sitting too close to the screen
        </label>
      </Field>
      <Field label="Look-away analytics">
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

      <div className="field-section">Hand gestures (experimental)</div>
      <Field label="Hand gestures">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={!!g.handGestures}
            onChange={(e) => patch({ handGestures: e.target.checked })}
          />
          Control the reader with hand gestures via the camera (pick which below)
        </label>
      </Field>
      <Field label="Gestures">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(GESTURE_INFO).map(([k, info]) => {
            const gset = { ...DEFAULT_GESTURES, ...(g.handGestureSet || {}) };
            return (
              <label key={k} className="inline-check" title={info.desc} style={{ opacity: g.handGestures ? 1 : 0.55 }}>
                <input
                  type="checkbox"
                  disabled={!g.handGestures}
                  checked={!!gset[k]}
                  onChange={(e) => patch({ handGestureSet: { ...gset, [k]: e.target.checked } })}
                />
                {info.icon} <strong>{info.label}</strong> — {info.desc}
              </label>
            );
          })}
        </div>
      </Field>
      <p className="settings-note">
        Fewer enabled gestures = fewer false positives: disabled gestures are ignored entirely, and
        the discrete ones must be held steady for ~half a second before they fire.
      </p>
      <Field label="Hand calibration">
        <button onClick={onCalibrateHand} disabled={!onCalibrateHand || !g.handGestures} title={g.handGestures ? '' : 'Turn on Hand gestures first'}>
          🖐 Calibrate hand range…
        </button>
      </Field>
      <p className="settings-note">
        Everything runs on-device — camera frames are analysed locally and never recorded, saved,
        or uploaded; the camera only runs while one of these is on. The face/hand models download
        once on first use (like the OCR data) and need a WebGL browser; without them, attention
        falls back to “facing the screen” and doze to “away for a while”. Typing and (for the
        attention guard) read-aloud are never paused.
      </p>
    </Dialog>
  );
}
