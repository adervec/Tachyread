import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { DEFAULT_GESTURES, GESTURE_INFO } from '../features/handGestures.js';
import { COMMANDS, DEFAULT_GESTURE_MAP, DEFAULT_VOICE_COMMANDS, DEFAULT_CLAP_MAP } from '../features/commandRegistry.js';
import { createRecognizer, speechRecognitionSupported } from '../features/speechRecognition.js';
import { getLanguage } from '../state/languages.js';

// One page for every hands-free control: camera attention guards, hand gestures + their command
// mapping, and voice/clap commands with custom, recordable trigger phrases. Replaces the old separate
// "Camera & Gestures" dialog and the Audio Settings "Hands-free" section.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

// A <select> of every reader command (plus an "unassigned" option). Value is a commandId.
function CommandSelect({ value, onChange, disabled }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {COMMANDS.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
    </select>
  );
}

export default function BiometricControlsDialog({ global, onPatch, onCalibrate, onCalibrateHand, isCompact = false, onClose }) {
  const [g, setG] = useState(global);
  function patch(p) { setG({ ...g, ...p }); onPatch(p); }

  const gestureMap = { ...DEFAULT_GESTURE_MAP, ...(g.gestureMap || {}) };
  const clapMap = { ...DEFAULT_CLAP_MAP, ...(g.clapMap || {}) };
  const voiceRows = g.voiceCommands?.length ? g.voiceCommands : DEFAULT_VOICE_COMMANDS;
  const rowsRef = useRef(voiceRows);
  rowsRef.current = voiceRows;

  // Record a trigger phrase: capture exactly what the recognizer hears once and save it into a row.
  const [recIdx, setRecIdx] = useState(-1);
  const [recErr, setRecErr] = useState('');
  const recRef = useRef(null);
  function stopRec() { try { recRef.current?.stop(); } catch { /* ignore */ } recRef.current = null; setRecIdx(-1); }
  useEffect(() => () => stopRec(), []);
  function recordPhrase(idx) {
    if (recIdx >= 0) { stopRec(); return; }
    if (!speechRecognitionSupported()) { setRecErr('Voice recording needs a Chromium browser with microphone access.'); return; }
    setRecErr('');
    const rec = createRecognizer({
      lang: getLanguage(g.language || 'en').bcp,
      continuous: false,
      interimResults: false,
      onResult: ({ transcript, isFinal }) => {
        if (!isFinal) return;
        const phrase = (transcript || '').toLowerCase().trim();
        if (phrase) patch({ voiceCommands: rowsRef.current.map((r, i) => (i === idx ? { ...r, phrase } : r)) });
        stopRec();
      },
      onError: () => stopRec(),
    });
    if (!rec) { setRecErr('Speech recognition is unavailable.'); return; }
    recRef.current = rec;
    setRecIdx(idx);
    try { rec.start(); } catch { stopRec(); }
  }

  const setRows = (rows) => patch({ voiceCommands: rows });

  return (
    <Dialog title="Biometric Controls" onClose={onClose} width={600} buttons={<button onClick={onClose}>Close</button>}>
      {isCompact && (
        <p className="settings-note" style={{ marginTop: 0, color: 'var(--ox-bright, #b0413e)' }}>
          📵 Front-camera features (attention, doze, alarms, posture, hand gestures) are <strong>off on mobile</strong> —
          they’re battery/CPU-heavy and a phone rarely faces you squarely. Voice / clap commands still work.
          Camera settings apply when you open the same account on a desktop.
        </p>
      )}

      <div className="field-section">Attention guards (experimental)</div>
      <Field label="Webcam attention">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamAttention} onChange={(e) => patch({ webcamAttention: e.target.checked })} />
          Pause fast reading when the camera can’t see you facing the screen with eyes open
        </label>
      </Field>
      <Field label="Doze detection">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamDoze} onChange={(e) => patch({ webcamDoze: e.target.checked })} />
          Stop read-aloud if your eyes stay shut or you’re away for a while
        </label>
      </Field>
      <Field label="Away alarm">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamAwayAlarm} onChange={(e) => patch({ webcamAwayAlarm: e.target.checked })} />
          Sound an alarm if you look away for too long
        </label>
      </Field>
      <Field label="Alarm after (seconds)">
        <input type="number" min={3} max={300} value={g.webcamAwayAlarmSec ?? 15} disabled={!g.webcamAwayAlarm}
          onChange={(e) => patch({ webcamAwayAlarmSec: Math.max(3, Math.min(300, Number(e.target.value) || 15)) })} style={{ width: 70 }} />
      </Field>
      <Field label="Escalating alarm">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamEscalatingAlarm} disabled={!g.webcamAwayAlarm} onChange={(e) => patch({ webcamEscalatingAlarm: e.target.checked })} />
          Start quiet and get louder the longer you stay away
        </label>
      </Field>
      <Field label="Posture nudge">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamDistanceNudge} onChange={(e) => patch({ webcamDistanceNudge: e.target.checked })} />
          Remind me to ease back when I’m sitting too close to the screen
        </label>
      </Field>
      <Field label="Look-away analytics">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamFocusStats} onChange={(e) => patch({ webcamFocusStats: e.target.checked })} />
          Log focus % and distractions per session into Reading History
        </label>
      </Field>
      <Field label="Show the feed">
        <label className="inline-check">
          <input type="checkbox" checked={g.webcamPreview !== false} onChange={(e) => patch({ webcamPreview: e.target.checked })} />
          Show the Biometric Control Feed popup (self-view + oscilloscope + event log) while active
        </label>
      </Field>
      <Field label="Eye calibration">
        <button onClick={onCalibrate} disabled={!onCalibrate}>⚙ Calibrate eye detection…</button>
      </Field>

      <div className="field-section">Hand gestures (experimental)</div>
      <Field label="Hand gestures">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.handGestures} onChange={(e) => patch({ handGestures: e.target.checked })} />
          Control the reader with hand gestures via the camera (enable + map each below)
        </label>
      </Field>
      <Field label="Enabled gestures">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(GESTURE_INFO).map(([k, info]) => {
            const gset = { ...DEFAULT_GESTURES, ...(g.handGestureSet || {}) };
            return (
              <label key={k} className="inline-check" title={info.desc} style={{ opacity: g.handGestures ? 1 : 0.55 }}>
                <input type="checkbox" disabled={!g.handGestures} checked={!!gset[k]} onChange={(e) => patch({ handGestureSet: { ...gset, [k]: e.target.checked } })} />
                {info.icon} <strong>{info.label}</strong>
              </label>
            );
          })}
        </div>
      </Field>
      <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Gesture → command</div>
      {Object.entries(GESTURE_INFO).filter(([k]) => k !== 'scroll').map(([k, info]) => (
        <Field key={k} label={`${info.icon} ${info.label}`}>
          <CommandSelect value={gestureMap[k]} disabled={!g.handGestures} onChange={(v) => patch({ gestureMap: { ...gestureMap, [k]: v } })} />
        </Field>
      ))}
      <p className="settings-note">
        The open-palm <strong>joystick</strong> (scroll) isn’t remappable — it scrolls the Lines pane by how
        far your palm is from its rest height. Fewer enabled gestures = fewer false positives; discrete
        gestures must be held ~half a second before firing.
      </p>
      <Field label="Hand calibration">
        <button onClick={onCalibrateHand} disabled={!onCalibrateHand || !g.handGestures} title={g.handGestures ? '' : 'Turn on Hand gestures first'}>
          🖐 Calibrate hand range…
        </button>
      </Field>

      <div className="field-section">Voice &amp; clap commands</div>
      <Field label="Hands-free mode">
        <select value={g.audioCtrlMode || 'Both'} onChange={(e) => patch({ audioCtrlMode: e.target.value })}>
          <option>Voice</option>
          <option>Claps</option>
          <option>Both</option>
        </select>
      </Field>
      <p className="settings-note">
        Turn listening on per tab with <strong>VOICE COMMAND</strong> in the controls bar. Voice needs a
        Chromium browser + microphone; audio is analysed on your device.
      </p>

      <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Spoken phrases → command</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {voiceRows.map((row, i) => (
          <div key={i} className="bio-voice-row" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={row.phrase}
              placeholder="say…"
              onChange={(e) => setRows(voiceRows.map((r, j) => (j === i ? { ...r, phrase: e.target.value } : r)))}
              style={{ flex: '1 1 auto', minWidth: 0 }}
            />
            <button title={recIdx === i ? 'Listening… stop' : 'Record what you say and use it as the phrase'} onClick={() => recordPhrase(i)}>
              {recIdx === i ? '● …' : '● Record'}
            </button>
            <CommandSelect value={row.commandId} onChange={(v) => setRows(voiceRows.map((r, j) => (j === i ? { ...r, commandId: v } : r)))} />
            <button title="Remove this phrase" onClick={() => setRows(voiceRows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <button style={{ marginTop: 6 }} onClick={() => setRows([...voiceRows, { phrase: '', commandId: 'nextWord' }])}>+ Add phrase</button>
      {recErr && <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>{recErr}</p>}
      <p className="settings-note">
        Several phrases can point at one command. A phrase matches when the words you speak contain it,
        so short, distinct words work best.
      </p>

      <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Claps → command</div>
      {[1, 2, 3].map((n) => (
        <Field key={n} label={`${'👏'.repeat(n)} ${n} clap${n > 1 ? 's' : ''}`}>
          <CommandSelect value={clapMap[n]} onChange={(v) => patch({ clapMap: { ...clapMap, [n]: v } })} />
        </Field>
      ))}

      <p className="settings-note">
        Everything runs on-device — camera frames and microphone audio are analysed locally and never
        recorded or uploaded; the camera/mic only run while a control here is on. The face/hand models
        download once on first use and need a WebGL browser.
      </p>
    </Dialog>
  );
}
