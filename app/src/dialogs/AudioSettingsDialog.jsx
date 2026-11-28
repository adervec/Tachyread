import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import ProfilesBar from '../components/ProfilesBar.jsx';
import { useVoices } from '../features/tts.js';
import { ENGLISH_VOICES, defaultVoiceForLang, downloadVoice, isVoiceDownloaded, piperSupported } from '../features/piperTts.js';
import { KOKORO_VOICES } from '../features/localTts.js';
import { elevenVoices, ELEVEN_MODELS } from '../features/elevenLabs.js';
import { listenStatus, onListenStatus, runListenNow, stopListenRun, runSpeedTest } from '../features/listenAgent.js';
import { t, fmtNum } from '../i18n.js';

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
  const [ls, setLs] = useState(listenStatus()); // pocket-listening agent status
  useEffect(() => onListenStatus(setLs), []);
  function patch(p) {
    setS({ ...s, ...p });
    onPatch(p);
  }

  // ElevenLabs cloud voice: verify the key by fetching the account's voices.
  const [elStatus, setElStatus] = useState(''); // '', 'checking', 'ok', or an error string
  const [elCount, setElCount] = useState(0);
  async function verifyEleven() {
    setElStatus('checking'); setElCount(0);
    try { const vs = await elevenVoices(global.elevenLabsKey); setElCount(vs.length); setElStatus('ok'); }
    catch (e) { setElStatus(e?.message || t('Failed')); }
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
    <Dialog title={t('Audio Settings')} onClose={onClose} width={540} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <ProfilesBar
        kind="audio"
        profiles={global.settingsProfiles}
        onChange={(p) => onPatchGlobal({ settingsProfiles: p })}
        capture={() => ({ offlineVoice: !!global.offlineVoice, offlineVoiceId: global.offlineVoiceId || '', ttsSpeed: global.ttsSpeed ?? 1, ttsAutoStopMin: global.ttsAutoStopMin || 0, elevenModel: global.elevenModel || 'eleven_multilingual_v2' })}
        apply={(data) => onPatchGlobal(data)}
      />
      <div className="field-section">{t('Read aloud (TTS)')}</div>
      {piperSupported() && (
        <>
          <Field label={t('Offline voice (plays when locked)')}>
            <label className="inline-check" title={t("Use a neural voice that runs on your device and produces real audio — so read-aloud keeps playing with the screen off, unlike the browser's built-in voice which the phone suspends on lock.")}>
              <input
                type="checkbox"
                checked={!!global.offlineVoice}
                onChange={(e) => onPatchGlobal({ offlineVoice: e.target.checked })}
              />
              {t('Neural voice, works with the screen locked (larger, one-time download)')}
            </label>
          </Field>
          {global.offlineVoice && (
            <>
              <Field label={t('Offline voice model')}>
                <select
                  value={global.offlineVoiceId || ''}
                  onChange={(e) => onPatchGlobal({ offlineVoiceId: e.target.value })}
                >
                  <option value="">{t('Auto (matches document language)')}</option>
                  {ENGLISH_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Field>
              <Field label={t('Fill gaps with Kokoro')}>
                <select value={global.kokoroLive || ''} onChange={(e) => onPatchGlobal({ kokoroLive: e.target.value })}
                  title={t("Chunks you haven't pre-generated are narrated with a Kokoro voice as you reach them (the next one is prepared while the current one plays) and saved, so they're ready next time. Needs a reasonably fast device; the ~90 MB model downloads once.")}>
                  <option value="">{t('Off — use the light browser voice for gaps')}</option>
                  {KOKORO_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Field>
              <Field label={t('Model')}>
                {dlPct >= 0 ? (
                  <div className="imp-bar" style={{ maxWidth: 220 }} title={t('Downloading {pct}%', { pct: dlPct })}>
                    <div className="imp-fill" style={{ width: `${dlPct}%` }} />
                  </div>
                ) : downloaded ? (
                  <span className="settings-note" style={{ margin: 0, color: '#2e9d4f' }}>✓ {t('Downloaded — ready offline')}</span>
                ) : (
                  <button onClick={getModel}>⬇ {t('Download voice (~20–30 MB, once)')}</button>
                )}
              </Field>
              <p className="settings-note">
                {t('The neural voice model downloads once (from HuggingFace) and is cached on this device; after that it works fully offline and keeps playing with the screen locked. Languages without a neural voice fall back to English. Best on a device with a bit of horsepower — synthesis runs on-device, so the first line has a short delay.')}
              </p>
            </>
          )}
        </>
      )}

      <div className="field-section">{t('Pocket listening (queue audio across devices)')}</div>
      <p className="settings-note">
        {t('The sync machine renders the next hours of your listen queue with the Kokoro voice above and puts them in your cloud’s private app folder; your other devices pull them over Wi-Fi and drop what you’ve heard. On the phone, play them with Audio → Listen to the Queue: no book files needed there. Needs a queue (TTS → QUEUE) and Data → Cloud sync set up. Only rendered clips are ever deleted — never your own recordings.')}
      </p>
      <Field label={t('Render ahead here')}>
        <label className="inline-check"><input type="checkbox" checked={!!global.listenRender} onChange={(e) => onPatchGlobal({ listenRender: e.target.checked })} /> {t('render the window on this device — the sync machine (Trackyread → AI / Cowork) also uploads it; any other device renders for itself only, while charging')}</label>
      </Field>
      <Field label={t('Pull audio here')}>
        <label className="inline-check"><input type="checkbox" checked={!!global.listenPull} onChange={(e) => onPatchGlobal({ listenPull: e.target.checked })} /> {t('fetch the rendered window to this device (Wi-Fi only)')}</label>
      </Field>
      <Field label={t('Hours ahead')}>
        <input type="number" min={1} max={48} value={global.listenHours ?? 20} onChange={(e) => onPatchGlobal({ listenHours: Math.max(1, Math.min(48, Number(e.target.value) || 20)) })} style={{ width: 70 }} />
        <span className="settings-note" style={{ margin: '0 0 0 8px' }}>{t('≈ {mb} MB at 24 kbps', { mb: Math.round((global.listenHours ?? 20) * 11) })}</span>
      </Field>
      <Field label={t('Cloud cap')}>
        <input type="number" min={0.25} max={10} step={0.25} value={global.listenCapGb ?? 1} onChange={(e) => onPatchGlobal({ listenCapGb: Math.max(0.25, Math.min(10, Number(e.target.value) || 1)) })} style={{ width: 70 }} /> GB
      </Field>
      <Field label={t('Status')}>
        <span role="status">{ls.text}</span>
        <button style={{ marginInlineStart: 8 }} disabled={ls.busy} onClick={() => runListenNow()}>▶ {t('Run now')}</button>
        <button style={{ marginInlineStart: 4 }} disabled={ls.busy} onClick={() => runSpeedTest()} title={t('How fast Kokoro renders on this device (× real-time) and on which backend — tells you whether this device can render ahead itself')}>⏱ {t('Speed test')}</button>
        {ls.busy && <button style={{ marginInlineStart: 4 }} onClick={stopListenRun}>■ {t('Stop')}</button>}
      </Field>

      <div className="field-section">{t('ElevenLabs (cloud voice — optional)')}</div>
      <Field label={t('API key')}>
        <input
          type="password"
          value={global.elevenLabsKey || ''}
          onChange={(e) => { onPatchGlobal({ elevenLabsKey: e.target.value.trim() }); setElStatus(''); }}
          placeholder={t('sk_… (from your ElevenLabs account)')}
          style={{ width: '100%' }}
        />
      </Field>
      <Field label={(global.replayMins ?? 3) ? t('Reading-aloud replay: last {n} min', { n: global.replayMins ?? 3 }) : t('Reading-aloud replay: off')}>
        <input type="range" min={0} max={10} step={0.5} value={global.replayMins ?? 3} onChange={(e) => onPatchGlobal({ replayMins: Number(e.target.value) })}
          aria-valuetext={(global.replayMins ?? 3) ? t('{n} minutes', { n: global.replayMins ?? 3 }) : t('off')}
          title={t('While reading aloud, keep this much of your voice in memory (oldest overwritten) so the card can play it back. 0 = off. Never saved unless you press Save.')} style={{ width: '100%' }} />
      </Field>
      <Field label={t('Voice profile')}>
        <select value={global.voiceProfile || 'neutral'} onChange={(e) => onPatchGlobal({ voiceProfile: e.target.value })}
          title={t('Used by the voice-quality scores on your own recordings and read-aloud: “depth” is judged against a typical pitch for this voice type')}>
          <option value="neutral">{t('Neutral')}</option>
          <option value="male">{t('Lower voice (male)')}</option>
          <option value="female">{t('Higher voice (female)')}</option>
        </select>
      </Field>
      <Field label={t('Model')}>
        <select value={global.elevenModel || 'eleven_multilingual_v2'} onChange={(e) => onPatchGlobal({ elevenModel: e.target.value })}>
          {ELEVEN_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <div className="data-row">
        <button onClick={verifyEleven} disabled={!global.elevenLabsKey || elStatus === 'checking'}>
          {elStatus === 'checking' ? t('Checking…') : t('Verify key & list voices')}
        </button>
        {elStatus === 'ok' && <span className="settings-note" style={{ margin: 0, color: '#2e9d4f' }}>✓ {t.n('Connected — {n} voice. Pick one in the Audiobook Manager.', 'Connected — {n} voices. Pick one in the Audiobook Manager.', elCount)}</span>}
        {elStatus && elStatus !== 'checking' && elStatus !== 'ok' && <span className="settings-note" style={{ margin: 0, color: '#c0392b' }}>{elStatus}</span>}
      </div>
      <p className="settings-note">
        {t('Optional, higher-quality voices for generating an audiobook (Audio → Audiobook Manager).')}{' '}
        <strong>{t('Unlike the offline voice, this sends the text to ElevenLabs’ servers and spends your own API key + quota.')}</strong>{' '}
        {t('The key is stored only on this device and is never synced. Generated clips are cached and then play offline like any other.')}
      </p>

      <div className="field-section">{t('Read aloud (built-in voice)')}</div>
      <Field label={t('Voice ({n} available)', { n: voices.length })}>
        <select value={s.annunciateVoice || ''} onChange={(e) => patch({ annunciateVoice: e.target.value })}>
          <option value="">{t('(default — matches your document language)')}</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.lang}){v.localService ? '' : ` — ${t('online')}`}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('Playback speed')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={global.ttsSpeed ?? 1}
            onChange={(e) => onPatchGlobal({ ttsSpeed: Number(e.target.value) })}
          />
          <span style={{ fontSize: 12, color: 'var(--status-fg)', minWidth: 40 }}>{fmtNum(global.ttsSpeed ?? 1, 2, 2)}×</span>
          <button type="button" onClick={() => onPatchGlobal({ ttsSpeed: 1 })} title={t('Reset to normal speed')}>1×</button>
        </div>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        {t('Applies to both the built-in and the offline voice; also adjustable live from the SPEED control in the controls bar while read-aloud is on.')}
      </p>
      <Field label={t('Speak-along follow mode')}>
        <select
          value={s.ttsFollowMode || (s.firstWordTts ? 'firstWord' : 'off')}
          onChange={(e) => {
            const v = e.target.value;
            // Speak-along follow is mutually exclusive with full read-aloud TTS.
            patch({ ttsFollowMode: v, firstWordTts: false, ...(v !== 'off' && s.readAloud ? { readAloud: false } : {}) });
          }}
        >
          <option value="off">{t('Off')}</option>
          <option value="firstWord">{t('First word of each sentence')}</option>
          <option value="line">{t('Whole current line')}</option>
        </select>
      </Field>
      <p className="settings-note">
        {t('Follow mode speaks as you read without driving the pace — a progress marker, not a narrator. Full read-aloud (TTS drives the reading position) toggles from the controls bar.')}
      </p>
      <div className="field-section">{t('Background playback')}</div>
      <label className="inline-check" title={t("Holds an audio session while the built-in voice reads, so a screen lock doesn't suspend it. The cost is your phone's audio focus — anything else you're playing gets ducked.")}>
        <input
          type="checkbox"
          checked={global.bgKeepAlive !== false}
          onChange={(e) => onPatchGlobal({ bgKeepAlive: e.target.checked })}
        />
        {t('Keep the built-in voice alive when the screen locks')}
      </label>
      <p className="settings-note">
        {t('This holds an audio session, which takes your phone’s audio focus and ducks other apps’ sound while read-aloud runs. Turn it off to leave your music alone — narration will then stop when the screen locks. The offline voice doesn’t need it (its real speech already holds the session), and neither does the pre-generated Audiobook.')}
      </p>
      <div className="field-section">{t('Timers')}</div>
      <Field label={t('Auto-stop reading after (minutes, 0 = never)')}>
        <input
          type="number"
          min={0}
          max={240}
          value={global.ttsAutoStopMin || 0}
          onChange={(e) => onPatchGlobal({ ttsAutoStopMin: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>
      <p className="settings-note">
        {t('Voice & clap commands (and their custom mappings) now live in Settings → Biometric Controls. Toggle listening per tab with VOICE COMMAND in the controls bar.')}
      </p>

    </Dialog>
  );
}
