// Planning + encoding for exporting a generated audiobook as standalone tracks. The per-chunk clips
// (one per sentence/paragraph) would be thousands of tiny files or, concatenated whole, one giant
// file — neither is a usable audiobook. So we group chunks into TRACKS: by chapter (ToC section, with
// long chapters split into parts) or by a target duration. Pure here (planning + WAV byte-encoding, no
// Web Audio / storage) so it's testable — see audiobookExport.demo.mjs. The audio assembly (decode +
// concatenate) lives in the wizard, which is inherently browser-only.

export function sanitizeFilename(s) {
  return String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'track';
}

const sumMs = (items) => items.reduce((s, x) => s + (x.ms || 0), 0);
function mkTrack(index, title, items) {
  return { index, title: title || '', items, chunkCount: items.length, ms: sumMs(items), startLine: items[0].startLine };
}

// items: ordered covered chunks `{ startLine, endLine, ms, sectionTitle }`.
// mode 'chapter' → one track per ToC section, splitting a section longer than maxMs into "(Part n)".
// mode 'duration' → pack chunks to ~targetMs each, breaking only at chunk boundaries.
export function planTracks(items, { mode = 'chapter', targetMs = 12 * 60000, maxMs = 30 * 60000 } = {}) {
  const tracks = [];
  if (!items || !items.length) return tracks;
  if (mode === 'chapter') {
    let i = 0;
    while (i < items.length) {
      const title = items[i].sectionTitle || 'Section';
      const group = [];
      while (i < items.length && (items[i].sectionTitle || 'Section') === title) { group.push(items[i]); i++; }
      const parts = [];
      let part = [], partMs = 0;
      for (const it of group) {
        if (partMs + it.ms > maxMs && part.length) { parts.push(part); part = []; partMs = 0; }
        part.push(it); partMs += it.ms;
      }
      if (part.length) parts.push(part);
      const multi = parts.length > 1;
      parts.forEach((p, pi) => tracks.push(mkTrack(tracks.length, multi ? `${title} (Part ${pi + 1})` : title, p)));
    }
  } else {
    let part = [], partMs = 0;
    for (const it of items) {
      if (partMs + it.ms > targetMs && part.length) { tracks.push(mkTrack(tracks.length, '', part)); part = []; partMs = 0; }
      part.push(it); partMs += it.ms;
    }
    if (part.length) tracks.push(mkTrack(tracks.length, '', part));
    tracks.forEach((t, i) => { t.title = `Track ${i + 1}${t.items[0].sectionTitle ? ' — ' + t.items[0].sectionTitle : ''}`; });
  }
  return tracks;
}

// Weave a section's boundary extras around its chunk items, in listening order:
// intro music → spoken title → narration chunks → outro music. Missing slots are skipped. Pure.
// `extras` = { intro?, title?, outro? } (each { id, durationMs }); firstLine/lastEnd position the
// sec items so mkTrack.startLine stays sane and outro sorts after the last chunk.
export function orderSectionItems(sectionTitle, chunkItems, extras = {}, firstLine = 0, lastEnd = 0) {
  const mk = (role, meta, at) => ({ kind: 'sec', role, firstLine, clipId: meta.id, ms: meta.durationMs || 0, sectionTitle, startLine: at });
  const out = [];
  if (extras.intro) out.push(mk('intro', extras.intro, firstLine));
  if (extras.title) out.push(mk('title', extras.title, firstLine));
  for (const it of chunkItems) out.push(it);
  if (extras.outro) out.push(mk('outro', extras.outro, lastEnd));
  return out;
}

// Zero-padded "NN Title.ext" so a phone's file browser sorts them in reading order.
export function trackFileName(track, total, ext) {
  const pad = String(total).length;
  return `${String(track.index + 1).padStart(pad, '0')} ${sanitizeFilename(track.title)}.${ext}`;
}

export function buildM3u(tracks, fileNames, albumTitle = 'Audiobook') {
  const out = [`#EXTM3U`, `#PLAYLIST:${albumTitle}`];
  tracks.forEach((t, i) => { out.push(`#EXTINF:${Math.round((t.ms || 0) / 1000)},${t.title}`); out.push(fileNames[i]); });
  return out.join('\n');
}

// Rough per-track byte estimate for the preview: mono 22.05 kHz 16-bit WAV ≈ 44100 B/s; spoken MP3 ≈ 16 kB/s.
export function estimateBytes(ms, format) {
  const sec = (ms || 0) / 1000;
  return Math.round(sec * (format === 'mp3' ? 16000 : 44100));
}

// ── Track metadata so a phone media player shows book/title/track order, not raw filenames ──
// Latin-1 bytes for a string (non-latin chars downgrade to '?', enough for the media scanner).
function latin1(s) {
  const out = [];
  for (const ch of String(s ?? '')) { const c = ch.charCodeAt(0); out.push(c > 0xff ? 0x3f : c); }
  return out;
}

// Minimal ID3v2.3 tag (prepended to an MP3) carrying title/artist/album/track. v2.3 frame sizes are
// plain big-endian; only the 10-byte tag header size is synchsafe. Android's media scanner reads it.
export function buildId3v2({ title, artist, album, track, trackTotal } = {}) {
  const frame = (id, text) => {
    const payload = [0x00, ...latin1(text)]; // encoding byte 0 = ISO-8859-1
    const n = payload.length;
    return [...latin1(id), (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, 0, 0, ...payload];
  };
  const frames = [];
  if (title) frames.push(...frame('TIT2', title));
  if (artist) frames.push(...frame('TPE1', artist));
  if (album) frames.push(...frame('TALB', album));
  if (track) frames.push(...frame('TRCK', trackTotal ? `${track}/${trackTotal}` : String(track)));
  const n = frames.length;
  const synchsafe = [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
  return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...synchsafe, ...frames]);
}

// RIFF INFO LIST subchunks — the WAV-native equivalent of ID3 (INAM=title, IART=artist,
// IPRD=album/product, ITRK=track). Returns { len, subs } or null. Pure.
function buildInfoList(tags = {}) {
  const sub = (id, text) => {
    const bytes = [...latin1(text), 0]; // null-terminated
    if (bytes.length % 2) bytes.push(0); // pad to even (RIFF word alignment)
    return { id, bytes };
  };
  const subs = [];
  if (tags.title) subs.push(sub('INAM', tags.title));
  if (tags.artist) subs.push(sub('IART', tags.artist));
  if (tags.album) subs.push(sub('IPRD', tags.album));
  if (tags.track) subs.push(sub('ITRK', tags.trackTotal ? `${tags.track}/${tags.trackTotal}` : String(tags.track)));
  if (!subs.length) return null;
  let len = 4; // "INFO"
  for (const s of subs) len += 8 + s.bytes.length;
  return { len, subs };
}

// Encode mono Float32 PCM to a 16-bit WAV byte array (universal, no dependency). Optional `tags`
// appends a RIFF INFO LIST chunk (title/artist/album/track). Pure.
export function encodeWav(samples, sampleRate, tags = null) {
  const len = samples.length;
  const info = tags ? buildInfoList(tags) : null;
  const listBytes = info ? 8 + info.len : 0; // "LIST" + size + payload
  const buf = new ArrayBuffer(44 + len * 2 + listBytes);
  const view = new DataView(buf);
  const wStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wStr(0, 'RIFF'); view.setUint32(4, 36 + len * 2 + listBytes, true); wStr(8, 'WAVE');
  wStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  wStr(36, 'data'); view.setUint32(40, len * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  if (info) {
    wStr(o, 'LIST'); view.setUint32(o + 4, info.len, true); wStr(o + 8, 'INFO'); o += 12;
    for (const s of info.subs) {
      wStr(o, s.id); view.setUint32(o + 4, s.bytes.length, true); o += 8;
      for (const b of s.bytes) view.setUint8(o++, b);
    }
  }
  return new Uint8Array(buf);
}

export function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
