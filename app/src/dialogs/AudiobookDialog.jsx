import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  getAudiobookManifest, getAudioClip, getAudioClipById, entryClips,
  addAudioClip, deleteAudioClipById, deleteAudioChunk, reorderAudioClips,
  audiobookSize, clearAudiobook, exportAudiobook, importAudiobook, appendAppLog,
} from '../state/storage.js';
import { recordClip } from '../features/audioRecorder.js';
import { synthToBlob, defaultVoiceForLang, piperSupported, installedVoices, voiceLabel } from '../features/piperTts.js';
import { elevenVoices, elevenSynth, elevenConfigured } from '../features/elevenLabs.js';
import { audiobookChunks } from '../document/readerDocument.js';
import { getTocEntries } from '../document/toc.js';
import { saveBlobToFile, pickFile, readFileText } from '../features/fileSystem.js';
import AudiobookExportWizard from './AudiobookExportWizard.jsx';

// Rough clip duration from the blob: mp3 (~128 kbps, ElevenLabs) vs 16-bit 22.05 kHz WAV (Piper).
const estMs = (blob) => (/mpe?g|mp3/i.test(blob.type)
  ? Math.max(200, Math.round((blob.size / 16000) * 1000))
  : Math.max(200, Math.round(((blob.size - 44) / (22050 * 2)) * 1000)));
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDur = (ms) => `${(Math.round((ms || 0) / 100) / 10).toFixed(1)}s`;
const fmtWhen = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

// A tiny oscilloscope of one clip's waveform (decodes the WAV blob → downsamples → draws).
function ClipWave({ checksum, line, clipId }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rec = await getAudioClipById(checksum, line, clipId);
        if (!rec?.blob || !alive || !ref.current) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
        ctx.close();
        if (!alive || !ref.current) return;
        const data = audio.getChannelData(0);
        const cv = ref.current, g = cv.getContext('2d');
        const W = cv.width, H = cv.height, mid = H / 2;
        g.clearRect(0, 0, W, H);
        g.strokeStyle = getComputedStyle(cv).getPropertyValue('color') || '#3a86ff';
        g.beginPath();
        const step = Math.max(1, Math.floor(data.length / W));
        for (let x = 0; x < W; x++) {
          let min = 1, max = -1;
          for (let j = 0; j < step; j++) { const v = data[x * step + j] || 0; if (v < min) min = v; if (v > max) max = v; }
          g.moveTo(x, mid + min * mid); g.lineTo(x, mid + max * mid);
        }
        g.stroke();
      } catch { /* undecodable */ }
    })();
    return () => { alive = false; };
  }, [checksum, line, clipId]);
  return <canvas ref={ref} className="clip-wave" width={200} height={30} />;
}

// Audiobook Manager: narration clips per natural CHUNK (sentence/paragraph), grouped by the book's
// ToC so you can see which parts are generated. Each chunk can hold MULTIPLE clips (mic recordings +
// Piper renders in different voices); the top-priority one plays. Manage clips, voices, and generation
// from here — everything stays on-device (browser storage; use Export to save a real file).
export default function AudiobookDialog({ tab, onClose }) {
  const { state } = useApp();
  const [manifest, setManifest] = useState({ lines: {} });
  const [recordingLi, setRecordingLi] = useState(null);
  const recorderRef = useRef(null);
  const [gen, setGen] = useState(null); // { done, total } while generating
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef(false);
  const checksum = tab?.doc?.contentChecksum;

  const [voiceId, setVoiceId] = useState(state.global.offlineVoiceId || defaultVoiceForLang(state.global.language || 'en'));
  const [voices, setVoices] = useState([]); // installed Piper voice ids
  const [elVoices, setElVoices] = useState([]); // ElevenLabs voices [{ id, name }]
  const elMap = useMemo(() => new Map(elVoices.map((v) => [v.id, v.name])), [elVoices]);
  // A voice id is either a Piper id or `el:<elevenVoiceId>`; label both.
  const labelVoice = (vid) => (vid && vid.startsWith('el:') ? `☁ ${elMap.get(vid.slice(3)) || vid.slice(3)}` : voiceLabel(vid));
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [confirmJob, setConfirmJob] = useState(null); // { kind, targets, sections, words }
  const [clipMgr, setClipMgr] = useState(null); // chunk whose clip manager is open
  const [fullText, setFullText] = useState(null); // chunk whose full text is shown
  const [size, setSize] = useState({ bytes: 0, clips: 0, chunks: 0 });
  const [wipeArm, setWipeArm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [playingKey, setPlayingKey] = useState(''); // `${line}` or `${line}:${clipId}` currently playing
  const playRef = useRef(null); // { audio, url, key }

  const chunks = useMemo(() => audiobookChunks(tab.doc), [tab.doc]);

  // Group chunks into ToC sections (front matter first) — each with its own coverage.
  const sections = useMemo(() => {
    const entries = getTocEntries(tab) || [];
    if (!entries.length) return [{ id: 'all', title: tab.doc.fileName || 'Document', chunks }];
    const secs = entries.map((e, i) => ({ id: 't' + i, title: e.title, start: e.wordIndex, chunks: [] }));
    const lead = { id: 'lead', title: 'Front matter', start: -1, chunks: [] };
    for (const c of chunks) {
      let target = lead;
      for (let i = secs.length - 1; i >= 0; i--) { if (c.startWordIndex >= secs[i].start) { target = secs[i]; break; } }
      target.chunks.push(c);
    }
    return [lead, ...secs].filter((s) => s.chunks.length);
  }, [tab, chunks]);

  async function refresh() {
    if (!checksum) return;
    setManifest(await getAudiobookManifest(checksum));
    setSize(await audiobookSize(checksum));
  }
  useEffect(() => { refresh(); void loadVoices(); return () => stopPlay(); /* eslint-disable-next-line */ }, [checksum]);
  async function loadVoices() {
    const list = await installedVoices();
    setVoices(list);
    if (list.length && !voiceId.startsWith('el:') && !list.includes(voiceId)) setVoiceId(list[0]);
    if (elevenConfigured(state.global.elevenLabsKey)) {
      try { setElVoices(await elevenVoices(state.global.elevenLabsKey)); } catch { setElVoices([]); }
    }
  }

  const clipsFor = (li) => entryClips(manifest.lines[li]);
  const topClip = (li) => clipsFor(li)[0] || null;

  // ── playback (toggle: a second click stops) ──
  function stopPlay() {
    const p = playRef.current;
    if (p) { try { p.audio.pause(); } catch { /* */ } try { URL.revokeObjectURL(p.url); } catch { /* */ } playRef.current = null; }
    setPlayingKey('');
  }
  async function playClip(line, clipId) {
    const key = clipId ? `${line}:${clipId}` : `${line}`;
    if (playRef.current?.key === key) { stopPlay(); return; }
    stopPlay();
    const rec = clipId ? await getAudioClipById(checksum, line, clipId) : await getAudioClip(checksum, line);
    if (!rec?.blob) return;
    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    audio.onended = stopPlay; audio.onerror = stopPlay;
    playRef.current = { audio, url, key };
    setPlayingKey(key);
    audio.play().catch(() => {});
  }

  // ── recording ──
  async function record(chunk) {
    if (recorderRef.current) recorderRef.current.stop();
    setRecordingLi(chunk.startLine);
    recorderRef.current = await recordClip({
      onStop: async ({ blob, durationMs }) => {
        await addAudioClip(checksum, chunk.startLine, blob, { source: 'mic', durationMs, spanEndLine: chunk.endLine });
        setRecordingLi(null); recorderRef.current = null; refresh();
      },
    });
  }
  function stopRecord() { if (recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; setRecordingLi(null); } }

  // ── generation (always confirmed first) ──
  function askGenerate(kind) {
    let targets;
    if (kind === 'fill') targets = chunks.filter((c) => (c.text || '').trim() && !clipsFor(c.startLine).length);
    else if (kind === 'all') targets = chunks.filter((c) => (c.text || '').trim() && topClip(c.startLine)?.source !== 'mic');
    else /* othervoice */ targets = chunks.filter((c) => { const t = topClip(c.startLine); return t && t.source === 'tts' && t.voiceId !== voiceId; });
    if (!targets.length) { setMsg('Nothing matches that — no chunks to (re)generate.'); return; }
    const secHit = sections.filter((s) => s.chunks.some((c) => targets.includes(c))).map((s) => s.title);
    const words = targets.reduce((n, c) => n + (c.text || '').split(/\s+/).filter(Boolean).length, 0);
    setConfirmJob({ kind, targets, sections: secHit, words });
  }
  // Generation loop. Every failure's reason is kept and surfaced (nothing is swallowed), each chunk
  // gets ONE retry after a short pause (rides out a transient rate-limit), and a run that keeps
  // failing aborts early after 6 failures in a row — no point grinding (and spending quota) through
  // 200 chunks once the voice/key/quota is dead. A final status message ALWAYS appears, so even a
  // single-chunk Gen reports what happened.
  const CONSEC_ABORT = 6;
  async function runJob() {
    const job = confirmJob; setConfirmJob(null);
    if (!job) return;
    abort.current = false;
    const isEl = voiceId.startsWith('el:');
    const key = state.global.elevenLabsKey, modelId = state.global.elevenModel || 'eleven_multilingual_v2';
    setGen({ done: 0, total: job.targets.length });
    setMsg('');
    let ok = 0, consecutive = 0;
    const errors = [];
    const synth = (c) => (isEl ? elevenSynth(c.text.trim(), voiceId.slice(3), key, { modelId }) : synthToBlob(c.text.trim(), voiceId));
    for (let i = 0; i < job.targets.length; i++) {
      if (abort.current) break;
      const c = job.targets[i];
      try {
        let blob;
        try { blob = await synth(c); }
        catch { await new Promise((r) => setTimeout(r, 1000)); blob = await synth(c); } // one retry
        await addAudioClip(checksum, c.startLine, blob, { source: 'tts', voiceId, durationMs: estMs(blob), spanEndLine: c.endLine });
        ok++; consecutive = 0;
      } catch (e) {
        errors.push(e?.message || String(e));
        console.warn(`Audiobook: chunk @ line ${c.startLine + 1} failed:`, e);
        appendAppLog('audiobook', `chunk @ line ${c.startLine + 1} (${labelVoice(voiceId)}): ${e?.message || e}`);
        consecutive++;
      }
      setGen({ done: i + 1, total: job.targets.length });
      if ((i & 7) === 0) await refresh();
      if (consecutive >= CONSEC_ABORT) break;
    }
    setGen(null); refresh();
    const reasons = [...new Set(errors)].slice(0, 2).join(' · ');
    if (!errors.length) setMsg(abort.current ? `■ Stopped — ${ok} of ${job.targets.length} chunk(s) generated.` : `✓ Generated ${ok} chunk(s) with ${labelVoice(voiceId)}.`);
    else if (consecutive >= CONSEC_ABORT) setMsg(`⚠ Stopped after ${CONSEC_ABORT} failures in a row (${ok} generated, ${errors.length} failed): ${reasons}. See Data Management → Diagnostic log.`);
    else setMsg(`${ok} generated, ${errors.length} failed: ${reasons}. See Data Management → Diagnostic log.`);
    if (errors.length) appendAppLog('audiobook', `run finished: ${ok} ok, ${errors.length} failed of ${job.targets.length} (${labelVoice(voiceId)})`);
  }

  // ── transfer + wipe ──
  async function doExport() {
    setBusy(true); setMsg('Gathering audiobook clips…');
    try {
      const bundle = await exportAudiobook(checksum, tab.doc.fileName);
      if (!bundle.clips.length) { setMsg('Nothing to export yet.'); setBusy(false); return; }
      const text = JSON.stringify(bundle);
      const safe = (tab.doc.fileName || 'book').replace(/[^\w.-]+/g, '_').slice(0, 40);
      const res = await saveBlobToFile(new Blob([text], { type: 'application/json' }), `tachyread-audiobook-${safe}.json`, [{ description: 'Tachyread audiobook', accept: { 'application/json': ['.json'] } }]);
      setMsg(res.canceled ? 'Save canceled.' : `Exported ${bundle.clips.length} clip(s) (${fmtBytes(text.length)})${res.method === 'download' ? ' to your downloads' : ` to ${res.name}`}.`);
    } catch (e) { setMsg('Export failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function doImport() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    setBusy(true); setMsg('Reading file…');
    try {
      const r = await importAudiobook(JSON.parse(await readFileText(f)));
      await refresh();
      setMsg(`Imported ${r.imported} clip(s)${r.skipped ? `, skipped ${r.skipped} already present` : ''}.${r.checksum === checksum ? '' : ' (They belong to a different book.)'}`);
    } catch (e) { setMsg('Import failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function doWipe() { await clearAudiobook(checksum); setWipeArm(false); stopPlay(); setMsg('Deleted all audio for this book.'); refresh(); }

  const toggleSec = (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const covered = (secChunks) => secChunks.filter((c) => clipsFor(c.startLine).length).length;
  const totalCovered = chunks.filter((c) => clipsFor(c.startLine).length).length;
  const pct = chunks.length ? Math.round((totalCovered / chunks.length) * 100) : 0;
  const remote = (state.global.remoteAudiobooks || []).find((r) => r.checksum === checksum);
  const remoteHasMore = remote && remote.chunks > totalCovered;

  return (
    <Dialog title="Audiobook Manager" onClose={() => { stopPlay(); onClose(); }} width={760}>
      {/* coverage + voice */}
      <div className="ab-coverage">
        {totalCovered >= chunks.length && chunks.length
          ? <span className="ab-cov-done">✓ Fully generated — {chunks.length} chunk(s)</span>
          : <span><strong>{totalCovered}</strong> / {chunks.length} chunk(s) have audio <strong>({pct}%)</strong></span>}
        <div className="imp-bar ab-cov-bar" title={`${pct}%`}><div className="imp-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      {remoteHasMore && (
        <div className="ab-remote">
          🔊 A more complete audiobook — <strong>{remote.chunks} chunk(s)</strong> — exists
          {remote.device ? <> on <strong>{remote.device}</strong></> : ' on another device'}. Export it there and Import here to skip regenerating.
        </div>
      )}

      {(piperSupported() || elVoices.length > 0) ? (
        <div className="ab-genbar">
          <label>Voice
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} title="Voice used when you Generate (offline Piper, or ElevenLabs cloud if a key is set in Audio Settings)">
              <optgroup label="Offline (Piper)">
                {(voices.length ? voices : (voiceId.startsWith('el:') ? [] : [voiceId])).map((v) => <option key={v} value={v}>{voiceLabel(v)}</option>)}
              </optgroup>
              {elVoices.length > 0 && (
                <optgroup label="ElevenLabs (cloud · your quota)">
                  {elVoices.map((v) => <option key={v.id} value={`el:${v.id}`}>☁ {v.name}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {gen ? (
            <>
              <div className="imp-bar" style={{ flex: '1 1 160px', maxWidth: 280 }}><div className="imp-fill" style={{ width: `${gen.total ? (gen.done / gen.total) * 100 : 0}%` }} /></div>
              <span className="settings-note" style={{ margin: 0 }}>Generating {gen.done}/{gen.total}…</span>
              <button onClick={() => { abort.current = true; }}>Stop</button>
            </>
          ) : (
            <>
              <button className="toggle-on" onClick={() => askGenerate('fill')} title="Generate every chunk that has no audio yet">🎙 Generate gaps</button>
              <button onClick={() => askGenerate('all')} title="Add a fresh render for every non-recorded chunk">↻ Regenerate all</button>
              <button onClick={() => askGenerate('othervoice')} title="Regenerate only chunks whose current audio uses a different voice">🎚 Match this voice</button>
            </>
          )}
        </div>
      ) : <p className="settings-note">Offline Piper voice isn’t available in this browser. Add an ElevenLabs key in Audio Settings to generate in the cloud instead.</p>}

      <div className="ab-genbar">
        <button className="toggle-on" onClick={() => setShowExport(true)} disabled={!totalCovered} title="Save the generated narration as standalone audio tracks (WAV/MP3 + playlist) to play on your phone">🎧 Export as audiobook…</button>
        <button onClick={doExport} disabled={busy || !size.clips} title="Save this book's clips as a Tachyread transfer file for another device">⬆ Transfer file…</button>
        <button onClick={doImport} disabled={busy} title="Load an exported Tachyread audiobook transfer file">⬇ Import…</button>
      </div>
      {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}

      {/* ToC-grouped chunk list */}
      <div className="ab-sections">
        {sections.map((sec) => {
          const cov = covered(sec.chunks), tot = sec.chunks.length, spct = tot ? Math.round((cov / tot) * 100) : 0;
          const open = !collapsed.has(sec.id);
          return (
            <div key={sec.id} className="ab-section">
              <div className="ab-sec-head" onClick={() => toggleSec(sec.id)}>
                <span className="ab-sec-caret">{open ? '▾' : '▸'}</span>
                <span className="ab-sec-title">{sec.title}</span>
                <span className={`ab-sec-cov${cov >= tot ? ' full' : ''}`}>{cov}/{tot} · {spct}%</span>
                <div className="imp-bar ab-sec-bar"><div className="imp-fill" style={{ width: `${spct}%` }} /></div>
              </div>
              {open && (
                <table className="history-table ab-table">
                  <tbody>
                    {sec.chunks.map((chunk) => {
                      const li = chunk.startLine;
                      const cl = clipsFor(li);
                      const top = cl[0];
                      const lineLabel = chunk.endLine > chunk.startLine ? `${chunk.startLine + 1}–${chunk.endLine + 1}` : `${chunk.startLine + 1}`;
                      const isPlaying = playingKey === `${li}`;
                      return (
                        <tr key={li}>
                          <td className="ab-lines">{lineLabel}</td>
                          <td className="ab-preview" title="Click to read the full chunk text" onClick={() => setFullText(chunk)}>{chunk.text.slice(0, 80)}{chunk.text.length > 80 ? '…' : ''}</td>
                          <td className="ab-voice">{top ? (top.source === 'mic' ? '🎤 you' : (top.voiceId?.startsWith('el:') ? <span title={labelVoice(top.voiceId)}>{labelVoice(top.voiceId)}</span> : <span title={voiceLabel(top.voiceId)}>🤖 {voiceLabel(top.voiceId).split(' · ')[0]}</span>)) : ''}{cl.length > 1 ? <span className="ab-clipcount"> ·{cl.length}</span> : ''}</td>
                          <td className="ab-dur">{top ? fmtDur(top.durationMs) : ''}</td>
                          <td className="ab-actions">
                            {top && <button className={isPlaying ? 'toggle-on' : ''} onClick={() => playClip(li)} title={isPlaying ? 'Stop' : 'Play'}>{isPlaying ? '■' : '▶'}</button>}{' '}
                            {(piperSupported() || elVoices.length > 0) && <button onClick={() => setConfirmJob({ kind: 'one', targets: [chunk], sections: [sec.title], words: (chunk.text || '').split(/\s+/).filter(Boolean).length })} title="Generate this chunk">Gen</button>}{' '}
                            {recordingLi === li ? <button className="toggle-on" onClick={stopRecord}>Stop</button> : <button onClick={() => record(chunk)}>Rec</button>}{' '}
                            {cl.length > 0 && <button onClick={() => setClipMgr(chunk)} title="Manage the clips for this chunk">Clips ({cl.length})</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* storage details + wipe */}
      <div className="ab-storage">
        <div className="field-section" style={{ marginTop: 10 }}>Storage</div>
        <p className="settings-note" style={{ margin: 0 }}>
          {size.clips} clip(s) across {size.chunks} chunk(s) · <strong>{fmtBytes(size.bytes)}</strong> in this browser’s
          storage (IndexedDB — there’s no file path to open; use <strong>Export</strong> above to save a real file).
        </p>
        <div className="data-row" style={{ marginTop: 6 }}>
          {!wipeArm
            ? <button className="grab-trash" disabled={!size.clips} onClick={() => setWipeArm(true)}>🗑 Delete all audio for this book…</button>
            : <>
                <button className="grab-trash" onClick={doWipe}>⚠ Confirm — delete {size.clips} clip(s) ({fmtBytes(size.bytes)})</button>
                <button onClick={() => setWipeArm(false)}>Cancel</button>
              </>}
        </div>
      </div>

      {/* Generate confirmation */}
      {confirmJob && (
        <Dialog title="Confirm generation" onClose={() => setConfirmJob(null)} width={460}
          buttons={<>
            <button className="toggle-on" onClick={runJob}>Generate {confirmJob.targets.length} chunk(s)</button>
            <button onClick={() => setConfirmJob(null)}>Cancel</button>
          </>}>
          <p>Generate <strong>{confirmJob.targets.length}</strong> chunk(s) (~{confirmJob.words.toLocaleString()} words) with{' '}
            <strong>{labelVoice(voiceId)}</strong>{confirmJob.kind === 'othervoice' ? ' (replacing other-voice renders)' : ''}.</p>
          {confirmJob.sections?.length ? (
            <p className="settings-note" style={{ marginTop: 0 }}>Sections: {confirmJob.sections.slice(0, 8).join(' · ')}{confirmJob.sections.length > 8 ? ` +${confirmJob.sections.length - 8} more` : ''}</p>
          ) : null}
          {voiceId.startsWith('el:')
            ? <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>☁ Sends ~{confirmJob.words.toLocaleString()} words to ElevenLabs — spends your API quota. Existing clips are kept; recordings are never touched.</p>
            : <p className="settings-note">Runs on-device — budget a few seconds per chunk. Existing clips are kept (a new one is added); recordings are never touched.</p>}
        </Dialog>
      )}

      {/* Full-text preview */}
      {fullText && (
        <Dialog title={`Chunk ${fullText.startLine + 1}${fullText.endLine > fullText.startLine ? `–${fullText.endLine + 1}` : ''}`} onClose={() => setFullText(null)} width={520} buttons={<button onClick={() => setFullText(null)}>Close</button>}>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{fullText.text}</p>
        </Dialog>
      )}

      {/* Per-chunk clip manager */}
      {clipMgr && (() => {
        const li = clipMgr.startLine;
        const cl = clipsFor(li);
        const move = async (id, dir) => {
          const ids = cl.map((c) => c.id); const i = ids.indexOf(id); const j = i + dir;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          await reorderAudioClips(checksum, li, ids); await refresh();
        };
        return (
          <Dialog title={`Clips — chunk ${li + 1}`} onClose={() => setClipMgr(null)} width={560} buttons={<button onClick={() => setClipMgr(null)}>Close</button>}>
            <p className="settings-note" style={{ marginTop: 0 }}>The top clip plays. Recordings (🎤) always outrank Piper renders. Reorder or delete stale clips.</p>
            {cl.map((c, i) => (
              <div key={c.id} className={`clip-card${i === 0 ? ' active' : ''}`}>
                <div className="clip-card-main">
                  <span className="clip-pri">{i === 0 ? '★' : i + 1}</span>
                  <span className="clip-src">{c.source === 'mic' ? '🎤 recording' : (c.voiceId?.startsWith('el:') ? labelVoice(c.voiceId) : `🤖 ${voiceLabel(c.voiceId)}`)}</span>
                  <span className="clip-meta">{fmtDur(c.durationMs)} · {fmtBytes(c.sizeBytes)} · {fmtWhen(c.createdAt)}</span>
                </div>
                <div className="clip-card-row">
                  <ClipWave checksum={checksum} line={li} clipId={c.id} />
                  <button className={playingKey === `${li}:${c.id}` ? 'toggle-on' : ''} onClick={() => playClip(li, c.id)}>{playingKey === `${li}:${c.id}` ? '■' : '▶'}</button>
                  <button disabled={i === 0 || c.source !== cl[i - 1]?.source} onClick={() => move(c.id, -1)} title="Higher priority">↑</button>
                  <button disabled={i === cl.length - 1 || c.source !== cl[i + 1]?.source} onClick={() => move(c.id, 1)} title="Lower priority">↓</button>
                  <button className="grab-trash" onClick={async () => { if (playingKey === `${li}:${c.id}`) stopPlay(); await deleteAudioClipById(checksum, li, c.id); await refresh(); if (clipsFor(li).length === 0) setClipMgr(null); }}>🗑</button>
                </div>
              </div>
            ))}
            {cl.length === 0 && <p className="settings-note">No clips.</p>}
            <div className="data-row" style={{ marginTop: 8 }}>
              <button className="grab-trash" onClick={async () => { stopPlay(); await deleteAudioChunk(checksum, li); await refresh(); setClipMgr(null); }}>Delete all clips for this chunk</button>
            </div>
          </Dialog>
        );
      })()}

      {showExport && (
        <AudiobookExportWizard
          checksum={checksum}
          fileName={tab.doc.fileName}
          sections={sections}
          manifest={manifest}
          onClose={() => setShowExport(false)}
        />
      )}
    </Dialog>
  );
}
