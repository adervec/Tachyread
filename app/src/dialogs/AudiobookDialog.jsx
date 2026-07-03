import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  getAudiobookManifest,
  getAudioClip,
  deleteAudioClip,
  saveAudioClip,
} from '../state/storage.js';
import { recordClip } from '../features/audioRecorder.js';
import { synthToBlob, defaultVoiceForLang, piperSupported } from '../features/piperTts.js';

const estMs = (blob) => Math.max(200, Math.round(((blob.size - 44) / (22050 * 2)) * 1000));

// Audiobook Manager: per-line narration clips. Each line can be a MIC recording (your voice) or a
// Piper (offline neural TTS) clip. Piper is the starting point (pre-generate the whole book),
// default (fills any gap), and fallback (read-aloud synthesizes+caches missing lines while playing).
// A fully-generated audiobook plays as pure files, so listening keeps going with the screen locked.
export default function AudiobookDialog({ tab, onClose }) {
  const { state } = useApp();
  const [manifest, setManifest] = useState({ lines: {} });
  const [recordingLi, setRecordingLi] = useState(null);
  const [recorder, setRecorder] = useState(null);
  const [gen, setGen] = useState(null); // { done, total } while pre-generating
  const abort = useRef(false);
  const checksum = tab?.doc?.contentChecksum;
  const voiceId = state.global.offlineVoiceId || defaultVoiceForLang(state.global.language || 'en');

  async function refresh() {
    if (!checksum) return;
    setManifest(await getAudiobookManifest(checksum));
  }
  useEffect(() => { refresh(); }, [checksum]);

  async function play(li) {
    const clip = await getAudioClip(checksum, li);
    if (!clip) return;
    const url = URL.createObjectURL(clip.blob);
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    a.play();
  }

  async function record(li) {
    if (recorder) recorder.stop();
    setRecordingLi(li);
    const rec = await recordClip({
      onStop: async ({ blob, durationMs }) => {
        await saveAudioClip(checksum, li, blob, durationMs, { source: 'mic' });
        setRecordingLi(null);
        refresh();
      },
    });
    setRecorder(rec);
  }
  function stopRecord() {
    if (recorder) { recorder.stop(); setRecorder(null); }
  }

  // Generate one line with Piper (overwrites whatever's there).
  async function genLine(li) {
    const text = (tab.doc.lines[li]?.text || '').trim();
    if (!text) return;
    const blob = await synthToBlob(text, voiceId);
    await saveAudioClip(checksum, li, blob, estMs(blob), { source: 'tts', voiceId });
    refresh();
  }

  // Pre-generate the book with Piper. `overwrite` false → only fill empty lines (keeps your mic
  // recordings and existing Piper clips); true → also refresh existing Piper clips (e.g. new voice).
  async function generate(overwrite) {
    if (!piperSupported()) return;
    const lines = tab.doc.lines;
    const targets = [];
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].isEmpty || !lines[li].text.trim()) continue;
      const m = manifest.lines[li];
      if (m && !overwrite) continue;
      if (m && m.source === 'mic') continue; // never clobber a recording
      targets.push(li);
    }
    if (!targets.length) return;
    abort.current = false;
    setGen({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (abort.current) break;
      try {
        const li = targets[i];
        const blob = await synthToBlob(lines[li].text.trim(), voiceId);
        await saveAudioClip(checksum, li, blob, estMs(blob), { source: 'tts', voiceId });
      } catch { /* skip a failed line */ }
      setGen({ done: i + 1, total: targets.length });
      if ((i & 15) === 0) await refresh();
    }
    setGen(null);
    refresh();
  }

  const clipCount = Object.keys(manifest.lines).length;
  const textLines = tab.doc.lines.filter((l) => !l.isEmpty && l.text.trim()).length;

  return (
    <Dialog title="Audiobook Manager" onClose={onClose} width={720}>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Per-line narration. Use the neural <strong>Piper</strong> voice to pre-generate the whole book
        (then listening keeps playing with the screen locked), or record your own voice per line —
        recordings always take precedence. {clipCount}/{textLines} lines have audio · voice: <code>{voiceId}</code>
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {piperSupported() ? (
          gen ? (
            <>
              <div className="imp-bar" style={{ flex: '1 1 200px', maxWidth: 320 }} title={`${gen.done}/${gen.total}`}>
                <div className="imp-fill" style={{ width: `${gen.total ? (gen.done / gen.total) * 100 : 0}%` }} />
              </div>
              <span className="settings-note" style={{ margin: 0 }}>Generating {gen.done}/{gen.total}…</span>
              <button onClick={() => { abort.current = true; }}>Stop</button>
            </>
          ) : (
            <>
              <button className="toggle-on" onClick={() => generate(false)} title="Synthesize every line that has no audio yet, with the Piper voice">🎙 Generate with Piper (fill gaps)</button>
              <button onClick={() => generate(true)} title="Re-synthesize all Piper lines (e.g. after changing the voice); your recordings are kept">↻ Regenerate Piper lines</button>
            </>
          )
        ) : (
          <span className="settings-note" style={{ margin: 0 }}>Offline Piper voice isn’t available in this browser.</span>
        )}
      </div>

      <table className="history-table">
        <thead>
          <tr><th>Line</th><th>Preview</th><th>Voice</th><th>Dur</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {tab.doc.lines.slice(0, 1000).map((line, li) => {
            const entry = manifest.lines[li];
            const blank = line.isEmpty || !line.text.trim();
            if (blank) return null;
            return (
              <tr key={li}>
                <td>{li + 1}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {line.text.slice(0, 90)}
                </td>
                <td>{entry ? (entry.source === 'mic' ? '🎤 you' : '🤖 Piper') : ''}</td>
                <td>{entry ? Math.round(entry.durationMs / 100) / 10 + 's' : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {entry && <button onClick={() => play(li)}>Play</button>}{' '}
                  {piperSupported() && <button onClick={() => genLine(li)} title="Generate this line with Piper">Gen</button>}{' '}
                  {recordingLi === li ? (
                    <button className="toggle-on" onClick={stopRecord}>Stop</button>
                  ) : (
                    <button onClick={() => record(li)}>Rec</button>
                  )}{' '}
                  {entry && (
                    <button onClick={async () => { await deleteAudioClip(checksum, li); refresh(); }}>Del</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tab.doc.lines.length > 1000 && (
        <div style={{ color: 'var(--status-fg)', marginTop: 6 }}>
          Showing the first 1,000 lines (generation covers the whole book).
        </div>
      )}
    </Dialog>
  );
}
