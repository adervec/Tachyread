import { useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getAudioClip, getSectionExtraBlob, entryClips, getBinding, getLibraryBook } from '../state/storage.js';
import { buildM4b, encodeAac } from '../features/m4b.js';
import { bookCoverUrl } from '../features/openLibrary.js';
import { saveBlobToFile } from '../features/fileSystem.js';
import {
  planTracks, trackFileName, buildM3u, encodeWav, buildId3v2, estimateBytes, fmtDuration, sanitizeFilename, orderSectionItems, buildSubtitles,
} from '../features/audiobookExport.js';

const fmtBytes = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX_CHAPTER_MS = 30 * 60000; // split a chapter longer than this into parts, even in chapter mode

// Assemble one track's clips into a single audio Blob. mp3 → concatenate the ElevenLabs mp3 blobs
// directly (fast, stays small). Otherwise decode every clip and re-render to one mono 22.05 kHz WAV
// (handles Piper WAV, mic WebM/Opus, mixed) — universal, no encoder dependency.
export async function assembleTrack(checksum, track, format, tags) {
  const blobs = [];
  for (const it of track.items) {
    const blob = it.kind === 'sec'
      ? await getSectionExtraBlob(checksum, it.firstLine, it.role, it.clipId)
      : (await getAudioClip(checksum, it.startLine))?.blob || null;
    if (blob) blobs.push(blob);
  }
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

// Covered chunks in reading order, with each section's intro/title/outro extras woven in
// (intro → title → chunks → outro), each carrying its play duration + section + voice + top clip id
// (the clip id is what folder sync diffs against to rewrite only changed tracks). Shared with the
// AudiobookDialog's download-folder sync engine.
export function buildExportItems(sections, manifest) {
  const out = [];
  for (const sec of sections) {
    const firstLine = sec.chunks[0]?.startLine;
    const lastEnd = sec.chunks.length ? sec.chunks[sec.chunks.length - 1].endLine : firstLine;
    const chunkItems = [];
    for (const c of sec.chunks) {
      const clips = entryClips(manifest.lines[c.startLine]);
      if (!clips.length) continue;
      chunkItems.push({ startLine: c.startLine, endLine: c.endLine, ms: clips[0].durationMs || 0, sectionTitle: sec.title, voiceId: clips[0].voiceId, clipId: clips[0].id, text: c.text || '' });
    }
    const extras = firstLine != null ? (manifest.sections?.[firstLine] || {}) : {};
    // A section with neither narration nor extras contributes nothing.
    if (!chunkItems.length && !extras.intro && !extras.title && !extras.outro) continue;
    out.push(...orderSectionItems(sec.title, chunkItems, extras, firstLine, lastEnd));
  }
  return out;
}

// The whole book as ONE .m4b: every clip decoded at 44.1 kHz, mixed to mono, AAC-encoded clip by
// clip (memory stays small), with a chapter at each track start and the book's cover when Trackyread
// has one. Returns { blob, chapters }.
const canM4b = typeof window !== 'undefined' && typeof window.AudioEncoder === 'function';
async function bookCover(checksum) {
  try {
    const id = (await getBinding())?.map?.[checksum];
    const book = id ? await getLibraryBook(id) : null;
    const url = book ? bookCoverUrl(book, 'L') : null;
    if (!url) return null;
    const r = await fetch(url);
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/jpe?g|png/.test(type)) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: /png/.test(type) ? 'png' : 'jpeg' };
  } catch { return null; } // cover hosts without CORS just mean no cover
}
export async function assembleM4b(checksum, tracks, tags, { onProgress, isAborted } = {}) {
  const SR = 44100;
  const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  const chapters = [];
  let samples = 0, done = 0;
  const total = tracks.reduce((a, t) => a + t.items.length, 0);
  async function* pcm() {
    for (const t of tracks) {
      chapters.push({ title: t.title, startMs: (samples / SR) * 1000 });
      for (const it of t.items) {
        if (isAborted?.()) return;
        const blob = it.kind === 'sec'
          ? await getSectionExtraBlob(checksum, it.firstLine, it.role, it.clipId)
          : (await getAudioClip(checksum, it.startLine))?.blob || null;
        onProgress?.(++done, total, t.title);
        if (!blob) continue;
        let buf;
        try { buf = await actx.decodeAudioData(await blob.arrayBuffer()); } catch { continue; }
        const mono = new Float32Array(buf.length);
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
        samples += mono.length;
        yield mono;
      }
    }
  }
  try {
    const { frames, asc } = await encodeAac(pcm(), { sampleRate: SR });
    if (!frames.length) return null;
    const cover = await bookCover(checksum);
    const bytes = buildM4b({ frames, asc, sampleRate: SR, chapters, tags: { ...tags, cover } });
    return { blob: new Blob([bytes], { type: 'audio/mp4' }), chapters: chapters.length, cover: !!cover };
  } finally { actx.close(); }
}

// mp3 fast-path only when every item is an ElevenLabs mp3 clip; any imported music / section extra
// forces the decode-and-re-render WAV path (robust for mixed formats).
export const allItemsMp3 = (items) =>
  items.length > 0 && items.every((it) => it.kind !== 'sec' && (it.voiceId || '').startsWith('el:'));

export default function AudiobookExportWizard({ checksum, fileName, sections, manifest, onClose }) {
  const [mode, setMode] = useState('chapter');
  const [targetMin, setTargetMin] = useState(12);
  const [forceWav, setForceWav] = useState(false);
  const [subs, setSubs] = useState(''); // '' | 'srt' | 'vtt' — a timed subtitle file beside each track
  const [asM4b, setAsM4b] = useState(false); // one .m4b with chapters instead of separate tracks
  const [prog, setProg] = useState(null); // { done, total, label }
  const [msg, setMsg] = useState('');
  const abort = useRef(false);

  const items = useMemo(() => buildExportItems(sections, manifest), [sections, manifest]);
  const allMp3 = allItemsMp3(items);
  const format = allMp3 && !forceWav ? 'mp3' : 'wav';
  const ext = format;
  const tracks = useMemo(() => planTracks(items, { mode, targetMs: targetMin * 60000, maxMs: mode === 'duration' ? targetMin * 60000 : MAX_CHAPTER_MS }), [items, mode, targetMin]);
  const totalMs = items.reduce((s, it) => s + it.ms, 0);
  const totalBytes = tracks.reduce((s, t) => s + estimateBytes(t.ms, format), 0);
  const album = sanitizeFilename((fileName || 'Audiobook').replace(/\.[a-z0-9]+$/i, ''));

  async function run() {
    if (!tracks.length) { setMsg('No generated audio to export.'); return; }
    abort.current = false;
    if (asM4b) {
      setProg({ done: 0, total: items.length, label: 'Encoding…' });
      try {
        const r = await assembleM4b(checksum, tracks, { title: album, album, artist: 'Tachyread' }, {
          onProgress: (done, total, label) => setProg({ done, total, label }), isAborted: () => abort.current,
        });
        if (!r || abort.current) { setProg(null); setMsg(abort.current ? 'Export stopped.' : 'Nothing could be encoded.'); return; }
        await saveBlobToFile(r.blob, `${album}.m4b`, [{ description: 'Audiobook', accept: { 'audio/mp4': ['.m4b'] } }]);
        setProg(null);
        setMsg(`Exported “${album}.m4b” — ${r.chapters} chapter(s)${r.cover ? ', with cover' : ''}.`);
      } catch (e) { setProg(null); setMsg('Export failed: ' + (e?.message || e)); }
      return;
    }
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
        if (subs) {
          const subName = names[i].replace(/\.[a-z0-9]+$/i, `.${subs}`);
          const sb = new Blob([buildSubtitles(tracks[i].items, subs)], { type: subs === 'vtt' ? 'text/vtt' : 'application/x-subrip' });
          if (dir) { const fh = await dir.getFileHandle(subName, { create: true }); const w = await fh.createWritable(); await w.write(sb); await w.close(); }
          else await saveBlobToFile(sb, subName, [{ description: 'Subtitles', accept: { [sb.type]: [`.${subs}`] } }]);
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
        : <><button className="toggle-on" disabled={!tracks.length} onClick={run}>{asM4b ? `Export .m4b (${tracks.length} chapter${tracks.length === 1 ? '' : 's'})…` : `Export ${tracks.length} track${tracks.length === 1 ? '' : 's'}…`}</button><button onClick={onClose}>Close</button></>}>
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
          {canM4b && (
            <div className="lj-inline">
              <label title="One audiobook file (AAC, 96 kbps) with a chapter at every track — what audiobook apps and Apple Books expect. Encoded on this device.">
                <input type="checkbox" checked={asM4b} onChange={(e) => setAsM4b(e.target.checked)} /> One .m4b audiobook with chapters (instead of separate tracks)
              </label>
            </div>
          )}
          <div className="lj-inline">
            <label title="A subtitle file beside each track, one cue per narrated chunk timed to the audio — for video captions, read-along players or other tools">
              Subtitles <select value={subs} onChange={(e) => setSubs(e.target.value)}>
                <option value="">none</option><option value="srt">.srt (SubRip)</option><option value="vtt">.vtt (WebVTT)</option>
              </select>
            </label>
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
