import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useVoices } from '../features/tts.js';

// Audio settings, reachable from the Audio menu: the read-aloud voice + rate (per tab), the
// speak-along follow mode, and the global auto-stop timer. Ambient sound keeps its own dialog.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function AudioSettingsDialog({ settings, onPatch, global, onPatchGlobal, onClose }) {
  const [s, setS] = useState(settings);
  const voices = useVoices();
  function patch(p) {
    setS({ ...s, ...p });
    onPatch(p);
  }

  return (
    <Dialog title="Audio Settings" onClose={onClose} width={540} buttons={<button onClick={onClose}>Close</button>}>
      <div className="field-section">Read aloud (TTS)</div>
      <Field label={`Voice (${voices.length} available)`}>
        <select value={s.annunciateVoice || ''} onChange={(e) => patch({ annunciateVoice: e.target.value })}>
          <option value="">(default — matches your document language)</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.lang}){v.localService ? '' : ' — online'}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Rate (−5..+8)">
        <input
          type="number"
          min={-5}
          max={8}
          value={s.annunciateRate}
          onChange={(e) => patch({ annunciateRate: Number(e.target.value) })}
        />
      </Field>
      <Field label="Speak-along follow mode">
        <select
          value={s.ttsFollowMode || (s.firstWordTts ? 'firstWord' : 'off')}
          onChange={(e) => patch({ ttsFollowMode: e.target.value })}
        >
          <option value="off">Off</option>
          <option value="firstWord">First word of each sentence</option>
          <option value="line">Whole current line</option>
        </select>
      </Field>
      <p className="settings-note">
        Follow mode speaks as you read without driving the pace — a progress marker, not a narrator.
        Full read-aloud (TTS drives the reading position) toggles from the controls bar.
      </p>
      <div className="field-section">Timers</div>
      <Field label="Auto-stop reading after (minutes, 0 = never)">
        <input
          type="number"
          min={0}
          max={240}
          value={global.ttsAutoStopMin || 0}
          onChange={(e) => onPatchGlobal({ ttsAutoStopMin: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>
      <div className="field-section">Hands-free control</div>
      <Field label="Hands-free mode">
        <select value={global.audioCtrlMode || 'Both'} onChange={(e) => onPatchGlobal({ audioCtrlMode: e.target.value })}>
          <option>Voice</option>
          <option>Claps</option>
          <option>Both</option>
        </select>
      </Field>
      <p className="settings-note">
        Voice commands and clap detection need microphone permission; voice commands need a
        Chromium browser. Toggle per tab with <strong>VOICE COMMAND</strong> in the controls bar.
      </p>
    </Dialog>
  );
}
