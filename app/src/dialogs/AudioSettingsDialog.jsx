import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useVoices } from '../features/tts.js';
import { ENGLISH_VOICES, defaultVoiceForLang, downloadVoice, isVoiceDownloaded, piperSupported } from '../features/piperTts.js';

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

  // Offline (Piper) voice: which voice, whether its model is downloaded, download progress.
  const offlineVoiceId = global.offlineVoiceId || defaultVoiceForLang(global.language || 'en');
  const [downloaded, setDownloaded] = useState(null); // null = checking
  const [dlPct, setDlPct] = useState(-1); // -1 = not downloading
  useEffect(() => {
    let alive = true;
    if (!global.offlineVoice) { setDownloaded(null); return undefined; }
    isVoiceDownloaded(offlineVoiceId).then((d) => { if (alive) setDownloaded(d); });
    return () => { alive = false; };
  }, [global.offlineVoice, offlineVoiceId]);

  async function getModel() {
    setDlPct(0);
    try {
      await downloadVoice(offlineVoiceId, (f) => setDlPct(Math.round(f * 100)));
      setDownloaded(true);
    } catch {
      setDownloaded(false);
    }
    setDlPct(-1);
  }

  return (
    <Dialog title="Audio Settings" onClose={onClose} width={540} buttons={<button onClick={onClose}>Close</button>}>
      <div className="field-section">Read aloud (TTS)</div>
      {piperSupported() && (
        <>
          <Field label="Offline voice (plays when locked)">
            <label className="inline-check" title="Use a neural voice that runs on your device and produces real audio — so read-aloud keeps playing with the screen off, unlike the browser's built-in voice which the phone suspends on lock.">
              <input
                type="checkbox"
                checked={!!global.offlineVoice}
                onChange={(e) => onPatchGlobal({ offlineVoice: e.target.checked })}
              />
              Neural voice, works with the screen locked (larger, one-time download)
            </label>
          </Field>
          {global.offlineVoice && (
            <>
              <Field label="Offline voice model">
                <select
                  value={global.offlineVoiceId || ''}
                  onChange={(e) => onPatchGlobal({ offlineVoiceId: e.target.value })}
                >
                  <option value="">Auto (matches document language)</option>
                  {ENGLISH_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Model">
                {dlPct >= 0 ? (
                  <div className="imp-bar" style={{ maxWidth: 220 }} title={`Downloading ${dlPct}%`}>
                    <div className="imp-fill" style={{ width: `${dlPct}%` }} />
                  </div>
                ) : downloaded ? (
                  <span className="settings-note" style={{ margin: 0, color: '#2e9d4f' }}>✓ Downloaded — ready offline</span>
                ) : (
                  <button onClick={getModel}>⬇ Download voice (~20–30 MB, once)</button>
                )}
              </Field>
              <p className="settings-note">
                The neural voice model downloads once (from HuggingFace) and is cached on this device;
                after that it works fully offline and keeps playing with the screen locked. Languages
                without a neural voice fall back to English. Best on a device with a bit of horsepower —
                synthesis runs on-device, so the first line has a short delay.
              </p>
            </>
          )}
        </>
      )}
      <div className="field-section">Read aloud (built-in voice)</div>
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
      <Field label="Playback speed">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={global.ttsSpeed ?? 1}
            onChange={(e) => onPatchGlobal({ ttsSpeed: Number(e.target.value) })}
          />
          <span style={{ fontSize: 12, color: 'var(--status-fg)', minWidth: 40 }}>{(global.ttsSpeed ?? 1).toFixed(2)}×</span>
          <button type="button" onClick={() => onPatchGlobal({ ttsSpeed: 1 })} title="Reset to normal speed">1×</button>
        </div>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        Applies to both the built-in and the offline voice; also adjustable live from the
        <strong> SPEED</strong> control in the controls bar while read-aloud is on.
      </p>
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
