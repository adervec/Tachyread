import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  getAudiobookManifest,
  getAudioClip,
  deleteAudioClip,
  saveAudioClip,
  exportAudiobook,
  importAudiobook,
} from '../state/storage.js';
import { recordClip } from '../features/audioRecorder.js';
import { synthToBlob, defaultVoiceForLang, piperSupported } from '../features/piperTts.js';
import { audiobookChunks } from '../document/readerDocument.js';
import { saveBlobToFile, pickFile, readFileText } from '../features/fileSystem.js';

const estMs = (blob) => Math.max(200, Math.round(((blob.size - 44) / (22050 * 2)) * 1000));

// Audiobook Manager: narration clips per natural CHUNK (a sentence / paragraph coalesced from the
// wrapped source lines — so synthesized audio isn't choppy). Each chunk can be a MIC recording (your
// voice) or a Piper (offline neural TTS) clip, keyed by the chunk's first line. Piper is the starting
// point (pre-generate the whole book), default (fills any gap), and fallback (read-aloud
// synthesizes+caches missing chunks while playing). A fully-generated audiobook plays as pure files,
// so listening keeps going with the screen locked — and can be exported to carry to another device.
export default function AudiobookDialog({ tab, onClose }) {
  const { state } = useApp();
  const [manifest, setManifest] = useState({ lines: {} });
  const [recordingLi, setRecordingLi] = useState(null);
  const [recorder, setRecorder] = useState(null);
  const [gen, setGen] = useState(null); // { done, total } while pre-generating
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef(false);
  const checksum = tab?.doc?.contentChecksum;
  const voiceId = state.global.offlineVoiceId || defaultVoiceForLang(state.global.language || 'en');

  const chunks = useMemo(() => audiobookChunks(tab.doc), [tab.doc]);

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

  async function record(chunk) {
    if (recorder) recorder.stop();
    setRecordingLi(chunk.startLine);
    const rec = await recordClip({
      onStop: async ({ blob, durationMs }) => {
        await saveAudioClip(checksum, chunk.startLine, blob, durationMs, { source: 'mic', spanEndLine: chunk.endLine });
        setRecordingLi(null);
        refresh();
      },
    });
    setRecorder(rec);
  }
  function stopRecord() {
    if (recorder) { recorder.stop(); setRecorder(null); }
  }

  // Generate one chunk with Piper (overwrites whatever's there).
  async function genChunk(chunk) {
    const text = (chunk.text || '').trim();
    if (!text) return;
    const blob = await synthToBlob(text, voiceId);
    await saveAudioClip(checksum, chunk.startLine, blob, estMs(blob), { source: 'tts', voiceId, spanEndLine: chunk.endLine });
    refresh();
  }

  // Pre-generate the book with Piper. `overwrite` false → only fill empty chunks (keeps your mic
  // recordings and existing Piper clips); true → also refresh existing Piper clips (e.g. new voice).
  async function generate(overwrite) {
    if (!piperSupported()) return;
    const targets = [];
    for (const c of chunks) {
      if (!(c.text || '').trim()) continue;
      const m = manifest.lines[c.startLine];
      if (m && !overwrite) continue;
      if (m && m.source === 'mic') continue; // never clobber a recording
      targets.push(c);
    }
    if (!targets.length) return;
    abort.current = false;
    setGen({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (abort.current) break;
      try {
        const c = targets[i];
        const blob = await synthToBlob(c.text.trim(), voiceId);
        await saveAudioClip(checksum, c.startLine, blob, estMs(blob), { source: 'tts', voiceId, spanEndLine: c.endLine });
      } catch { /* skip a failed chunk */ }
      setGen({ done: i + 1, total: targets.length });
      if ((i & 15) === 0) await refresh();
    }
    setGen(null);
    refresh();
  }

  // ── transfer between devices (a file, not the cloud) ──
  async function doExport() {
    setBusy(true); setMsg('Gathering audiobook clips…');
    try {
      const bundle = await exportAudiobook(checksum, tab.doc.fileName);
      if (!bundle.clips.length) { setMsg('Nothing to export yet — generate or record some audio first.'); setBusy(false); return; }
      const text = JSON.stringify(bundle);
      const safe = (tab.doc.fileName || 'book').replace(/[^\w.-]+/g, '_').slice(0, 40);
      const res = await saveBlobToFile(new Blob([text], { type: 'application/json' }), `tachyread-audiobook-${safe}.json`, [
        { description: 'Tachyread audiobook', accept: { 'application/json': ['.json'] } },
      ]);
      setMsg(res.canceled
        ? 'Save canceled.'
        : `Exported ${bundle.clips.length} clip(s) (${Math.round(text.length / 1024)} KB)${res.method === 'download' ? ' to your downloads' : ` to ${res.name}`}. Open it on the other device via Import.`);
    } catch (e) { setMsg('Export failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function doImport() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    setBusy(true); setMsg('Reading file…');
    try {
      const bundle = JSON.parse(await readFileText(f));
      const r = await importAudiobook(bundle);
      const same = r.checksum === checksum;
      await refresh();
      setMsg(`Imported ${r.imported} clip(s)${r.skipped ? `, kept ${r.skipped} local recording(s)` : ''}. ${same ? 'They match this book.' : 'They belong to a different book (they’ll apply when you open it).'}`);
    } catch (e) { setMsg('Import failed: ' + (e?.message || e)); }
    setBusy(false);
  }

  const clipCount = Object.keys(manifest.lines).length;
  const totalChunks = chunks.length;

  return (
    <Dialog title="Audiobook Manager" onClose={onClose} width={720}>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Narration per <strong>sentence</strong> (wrapped lines are joined so the audio isn't choppy). Use the neural{' '}
        <strong>Piper</strong> voice to pre-generate the whole book (then listening keeps playing with the screen
        locked), or record your own voice — recordings always take precedence. {clipCount}/{totalChunks} chunks have audio · voice: <code>{voiceId}</code>
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
              <button className="toggle-on" onClick={() => generate(false)} title="Synthesize every chunk that has no audio yet, with the Piper voice">🎙 Generate with Piper (fill gaps)</button>
              <button onClick={() => generate(true)} title="Re-synthesize all Piper chunks (e.g. after changing the voice); your recordings are kept">↻ Regenerate Piper</button>
            </>
          )
        ) : (
          <span className="settings-note" style={{ margin: 0 }}>Offline Piper voice isn’t available in this browser.</span>
        )}
      </div>

      {/* Carry a generated audiobook between devices as a file — the cloud sync stays progress-only. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={doExport} disabled={busy || !clipCount} title="Save this book's audio clips to a file you can open on another device">⬆ Export audiobook…</button>
        <button onClick={doImport} disabled={busy} title="Load an audiobook file exported from another device (merged by book content)">⬇ Import audiobook…</button>
        <span className="settings-note" style={{ margin: 0 }}>Move full or partial narration to your phone/desktop without the cloud.</span>
      </div>
      {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}

      <table className="history-table">
        <thead>
          <tr><th>Lines</th><th>Preview</th><th>Voice</th><th>Dur</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {chunks.slice(0, 1000).map((chunk) => {
            const li = chunk.startLine;
            const entry = manifest.lines[li];
            const lineLabel = chunk.endLine > chunk.startLine ? `${chunk.startLine + 1}–${chunk.endLine + 1}` : `${chunk.startLine + 1}`;
            return (
              <tr key={li}>
                <td>{lineLabel}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {chunk.text.slice(0, 90)}
                </td>
                <td>{entry ? (entry.source === 'mic' ? '🎤 you' : '🤖 Piper') : ''}</td>
                <td>{entry ? Math.round(entry.durationMs / 100) / 10 + 's' : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {entry && <button onClick={() => play(li)}>Play</button>}{' '}
                  {piperSupported() && <button onClick={() => genChunk(chunk)} title="Generate this chunk with Piper">Gen</button>}{' '}
                  {recordingLi === li ? (
                    <button className="toggle-on" onClick={stopRecord}>Stop</button>
                  ) : (
                    <button onClick={() => record(chunk)}>Rec</button>
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
      {chunks.length > 1000 && (
        <div style={{ color: 'var(--status-fg)', marginTop: 6 }}>
          Showing the first 1,000 chunks (generation covers the whole book).
        </div>
      )}
    </Dialog>
  );
}
