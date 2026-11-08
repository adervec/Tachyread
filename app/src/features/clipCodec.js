// Stored narration clips are compressed to Ogg Opus with WebCodecs' built-in encoder (every
// Chromium and Firefox has it — unlike AAC, which Chrome on Windows/Linux can't encode) and the
// small muxer in oggOpus.js. A WAV clip (Piper, Kokoro, trimmed mic takes) shrinks ~15–30×;
// anything already compressed (mp3, webm/opus) passes through, as does everything on a browser
// that couldn't play the result (Safari) — playback never depends on this.
// ponytail: fixed 24 kbps mono (speech-transparent for TTS; ~11 MB per hour) — a setting if asked.
import { buildOggOpus, opusHead } from './oggOpus.js';
import { allAudiobookManifests, entryClips, getAudioClipById, replaceAudioClipBlob } from '../state/storage.js';

const RATE = 48000, BITRATE = 24000;
export const OPUS_TYPE = 'audio/ogg; codecs=opus';
let supported = null;
async function usable() {
  if (supported == null) {
    try {
      supported = typeof AudioEncoder !== 'undefined' && !!document.createElement('audio').canPlayType(OPUS_TYPE)
        && (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: BITRATE })).supported === true;
    } catch { supported = false; }
  }
  return supported;
}
const isWav = async (blob) => { try { return (await blob.slice(0, 4).text()) === 'RIFF'; } catch { return false; } };

// Float32 48 kHz mono → { packets: [{ data, samples }], head: OpusHead | null }
async function encodeOpus(pcm) {
  const packets = []; let head = null, err = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !head) head = new Uint8Array(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      packets.push({ data, samples: Math.round(((chunk.duration || 20000) / 1e6) * RATE) });
    },
    error: (e) => { err = e; },
  });
  enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: BITRATE });
  for (let i = 0; i < pcm.length && !err; i += RATE) { // one-second blocks keep the queue shallow
    const block = pcm.subarray(i, i + RATE);
    enc.encode(new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: block.length, numberOfChannels: 1, timestamp: Math.round((i * 1e6) / RATE), data: block }));
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  return { packets, head };
}

// WAV blob → Ogg Opus blob (mono, 48 kHz). Returns the input itself when it isn't WAV, can't be
// encoded or played here, or wouldn't get smaller.
export async function compressClip(blob) {
  if (!blob || !(await isWav(blob)) || !(await usable())) return blob;
  try {
    const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await blob.arrayBuffer()); // resamples to 48 kHz
    let pcm = buf.getChannelData(0);
    if (buf.numberOfChannels > 1) { // average the channels
      pcm = Float32Array.from(pcm);
      for (let c = 1; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < pcm.length; i++) pcm[i] += d[i]; }
      for (let i = 0; i < pcm.length; i++) pcm[i] /= buf.numberOfChannels;
    }
    const { packets, head } = await encodeOpus(pcm);
    if (!packets.length) return blob;
    const out = new Blob([buildOggOpus(packets, head || opusHead(), { totalSamples: pcm.length })], { type: OPUS_TYPE });
    return out.size < blob.size ? out : blob;
  } catch { return blob; }
}

// Compress every stored WAV clip in place. onProgress({ done, total, changed, before, after }).
export async function compressAllClips(onProgress) {
  const jobs = [];
  for (const m of await allAudiobookManifests()) {
    for (const [line, entry] of Object.entries(m.lines || {})) for (const c of entryClips(entry)) jobs.push({ checksum: m.checksum, line: +line, id: c.id });
  }
  const r = { done: 0, total: jobs.length, changed: 0, before: 0, after: 0 };
  for (const j of jobs) {
    const rec = await getAudioClipById(j.checksum, j.line, j.id);
    if (rec?.blob) {
      const out = await compressClip(rec.blob);
      if (out !== rec.blob) { await replaceAudioClipBlob(j.checksum, j.line, j.id, out); r.changed++; r.before += rec.blob.size; r.after += out.size; }
    }
    r.done++;
    onProgress?.({ ...r });
  }
  return r;
}
