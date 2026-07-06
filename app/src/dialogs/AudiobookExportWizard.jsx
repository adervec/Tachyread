import { useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getAudioClip, entryClips } from '../state/storage.js';
import { saveBlobToFile } from '../features/fileSystem.js';
import {
  planTracks, trackFileName, buildM3u, encodeWav, buildId3v2, estimateBytes, fmtDuration, sanitizeFilename,
} from '../features/audiobookExport.js';

const fmtBytes = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX_CHAPTER_MS = 30 * 60000; // split a chapter longer than this into parts, even in chapter mode

// Assemble one track's clips into a single audio Blob. mp3 → concatenate the ElevenLabs mp3 blobs
// directly (fast, stays small). Otherwise decode every clip and re-render to one mono 22.05 kHz WAV
// (handles Piper WAV, mic WebM/Opus, mixed) — universal, no encoder dependency.
async function assembleTrack(checksum, track, format, tags) {
  const blobs = [];
  for (const it of track.items) { const rec = await getAudioClip(checksum, it.startLine); if (rec?.blob) blobs.push(rec.blob); }
  if (!blobs.length) return null;
  // mp3 → prepend an ID3v2 tag so the phone shows book/title/track instead of the filename.
  if (format === 'mp3') return new Blob([buildId3v2(tags), ...blobs], { type: 'audio/mpeg' });
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  const bufs = [];
  for (const b of blobs) { try { bufs.push(await actx.decodeAudioData(await b.arrayBuffer())); } catch { /* skip undecodable */ } }
  actx.close();
  if (!bufs.length) return null;
  const SR = 22050;
  const total = bufs.reduce((s, b) => s + b.duration, 0);
  const octx = new OfflineAudioContext(1, Math.max(1, Math.ceil(total * SR)), SR);
  let t = 0;
  for (const b of bufs) { const src = octx.createBufferSource(); src.buffer = b; src.connect(octx.destination); src.start(t); t += b.duration; }
  const rendered = await octx.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0), SR, tags)], { type: 'audio/wav' });
}

export default function AudiobookExportWizard({ checksum, fileName, sections, manifest, onClose }) {
  const [mode, setMode] = useState('chapter');
  const [targetMin, setTargetMin] = useState(12);
  const [forceWav, setForceWav] = useState(false);
  const [prog, setProg] = useState(null); // { done, total, label }
  const [msg, setMsg] = useState('');
  const abort = useRef(false);

  // Covered chunks in reading order, with their play duration + section + voice.
  const items = useMemo(() => {
    const out = [];
    for (const sec of sections) for (const c of sec.chunks) {
      const clips = entryClips(manifest.lines[c.startLine]);
      if (!clips.length) continue;
      out.push({ startLine: c.startLine, endLine: c.endLine, ms: clips[0].durationMs || 0, sectionTitle: sec.title, voiceId: clips[0].voiceId });
    }
    return out;
  }, [sections, manifest]);

  const allMp3 = items.length > 0 && items.every((it) => (it.voiceId || '').startsWith('el:'));
  const format = allMp3 && !forceWav ? 'mp3' : 'wav';
  const ext = format;
  const tracks = useMemo(() => planTracks(items, { mode, targetMs: targetMin * 60000, maxMs: mode === 'duration' ? targetMin * 60000 : MAX_CHAPTER_MS }), [items, mode, targetMin]);
  const totalMs = items.reduce((s, it) => s + it.ms, 0);
  const totalBytes = tracks.reduce((s, t) => s + estimateBytes(t.ms, format), 0);
  const album = sanitizeFilename((fileName || 'Audiobook').replace(/\.[a-z0-9]+$/i, ''));

  async function run() {
    if (!tracks.length) { setMsg('No generated audio to export.'); return; }
    abort.current = false;
    setProg({ done: 0, total: tracks.length, label: 'Preparing…' });
    const names = tracks.map((t) => trackFileName(t, tracks.length, ext));
    let dir = null;
    if (typeof window.showDirectoryPicker === 'function') {
      try { dir = await window.showDirectoryPicker({ id: 'tachyread-audiobook-out', mode: 'readwrite' }); }
      catch (e) { if (e?.name === 'AbortError') { setProg(null); return; } }
    }
    try {
      for (let i = 0; i < tracks.length; i++) {
        if (abort.current) break;
        setProg({ done: i, total: tracks.length, label: tracks[i].title });
        const tags = { title: tracks[i].title, album, artist: 'Tachyread', track: i + 1, trackTotal: tracks.length };
        const blob = await assembleTrack(checksum, tracks[i], format, tags);
        if (!blob) continue;
        if (dir) {
          const fh = await dir.getFileHandle(names[i], { create: true });
          const w = await fh.createWritable(); await w.write(blob); await w.close();
        } else {
          await saveBlobToFile(blob, names[i], [{ description: 'Audio', accept: { [format === 'mp3' ? 'audio/mpeg' : 'audio/wav']: [`.${ext}`] } }]);
        }
        setProg({ done: i + 1, total: tracks.length, label: tracks[i].title });
      }
      // Playlist so a phone player shows the tracks in order with titles.
      const m3u = new Blob([buildM3u(tracks, names, album)], { type: 'audio/x-mpegurl' });
      if (dir) { const fh = await dir.getFileHandle(`${album}.m3u`, { create: true }); const w = await fh.createWritable(); await w.write(m3u); await w.close(); }
      else await saveBlobToFile(m3u, `${album}.m3u`, [{ description: 'Playlist', accept: { 'audio/x-mpegurl': ['.m3u'] } }]);
      setProg(null);
      setMsg(abort.current ? 'Export stopped.' : `Exported ${tracks.length} track(s)${dir ? ` to “${dir.name}”` : ' to your downloads'} + a playlist.`);
    } catch (e) { setProg(null); setMsg('Export failed: ' + (e?.message || e)); }
  }

  return (
    <Dialog title="Export as audiobook" onClose={onClose} width={640}
      buttons={prog
        ? <button onClick={() => { abort.current = true; }}>Stop</button>
        : <><button className="toggle-on" disabled={!tracks.length} onClick={run}>Export {tracks.length} track{tracks.length === 1 ? '' : 's'}…</button><button onClick={onClose}>Close</button></>}>
      {items.length === 0 ? (
        <p className="settings-note">Nothing generated yet — create the narration first, then come back to export it as standalone tracks.</p>
      ) : (
        <>
          <p className="settings-note" style={{ marginTop: 0 }}>
            Save the finished narration as standalone tracks to copy onto your phone and play in any audiobook / podcast app.
            Chunks are grouped into sensible tracks — not one giant file, not thousands of tiny ones.
          </p>

          <div className="field-section">Tracks</div>
          <div className="lj-inline">
            <label><input type="radio" checked={mode === 'chapter'} onChange={() => setMode('chapter')} /> By chapter (split long chapters into ≤30-min parts)</label>
            <label><input type="radio" checked={mode === 'duration'} onChange={() => setMode('duration')} /> By duration</label>
            {mode === 'duration' && (
              <label>≈ <input type="number" min={3} max={60} value={targetMin} onChange={(e) => setTargetMin(Math.max(3, Math.min(60, Number(e.target.value) || 12)))} style={{ width: 54 }} /> min / track</label>
            )}
          </div>

          <div className="field-section">Format</div>
          <div className="lj-inline">
            <span className="settings-note" style={{ margin: 0 }}>
              {allMp3
                ? (forceWav ? 'WAV (re-encoded; larger, universal).' : 'MP3 — kept as-is from ElevenLabs (small, phone-friendly).')
                : 'WAV, mono 22 kHz — mixed / offline voices are re-encoded to one universal format.'}
            </span>
            {allMp3 && <label><input type="checkbox" checked={forceWav} onChange={(e) => setForceWav(e.target.checked)} /> Force WAV</label>}
          </div>

          <p className="settings-note">
            {tracks.length} track(s) · {fmtDuration(totalMs)} total · ≈ {fmtBytes(totalBytes)} as {format.toUpperCase()}.
            {typeof window.showDirectoryPicker !== 'function' && ' Your browser will download each file separately (a Chromium browser lets you pick one folder).'}
          </p>

          <div className="abx-list">
            <table className="history-table">
              <tbody>
                {tracks.map((t) => (
                  <tr key={t.index}>
                    <td className="abx-num">{String(t.index + 1).padStart(2, '0')}</td>
                    <td className="abx-title">{t.title}</td>
                    <td className="abx-meta">{t.chunkCount} chunk{t.chunkCount === 1 ? '' : 's'}</td>
                    <td className="abx-meta">{fmtDuration(t.ms)}</td>
                    <td className="abx-meta">≈ {fmtBytes(estimateBytes(t.ms, format))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {prog && (
            <div className="lj-inline" style={{ marginTop: 8 }}>
              <div className="imp-bar" style={{ flex: '1 1 160px', maxWidth: 320 }}><div className="imp-fill" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
              <span className="settings-note" style={{ margin: 0 }}>Track {prog.done}/{prog.total} — {prog.label}…</span>
            </div>
          )}
        </>
      )}
      {msg && <p className="settings-note">{msg}</p>}
    </Dialog>
  );
}
