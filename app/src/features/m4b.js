// M4B (MP4 audiobook) writer: AAC frames from WebCodecs' AudioEncoder → one .m4b with Nero chapter
// marks (chpl — read by audiobook players, VLC, mutagen…) and iTunes-style tags (title, artist,
// album, cover). Hand-written instead of a muxer dependency: audio-only MP4 is a fixed set of boxes,
// and the libraries don't write chapters. Pure: bytes in, bytes out.
// ponytail: whole file assembled in memory (~43 MB per hour at 96 kbps) and a single 32-bit stco
// chunk — fine below 4 GB; stream to disk with co64 if a book ever gets that long.

const enc = new TextEncoder();
const u8 = (...parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const be = (n, bytes) => { const b = new Uint8Array(bytes); for (let i = bytes - 1; i >= 0; i--) { b[i] = n % 256; n = Math.floor(n / 256); } return b; };
// Box types and fixed ASCII fields are one byte per char — Latin-1, so '©nam' is the 4 bytes A9 6E 61 6D.
const str = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const box = (type, ...payload) => { const body = u8(...payload); return u8(be(8 + body.length, 4), str(type), body); };
const full = (type, version, flags, ...payload) => box(type, u8(new Uint8Array([version]), be(flags, 3)), ...payload);

// MPEG-4 descriptor with the 4-byte length form (always valid, simplest).
const desc = (tag, body) => u8(new Uint8Array([tag, 0x80, 0x80, 0x80, body.length & 0x7f]), body);

// frames: [{ data: Uint8Array, samples: number }] (samples per frame, normally 1024)
// asc: AudioSpecificConfig bytes (AudioEncoder's decoderConfig.description)
// chapters: [{ title, startMs }] · tags: { title, artist, album, cover?: { bytes, type: 'jpeg'|'png' } }
export function buildM4b({ frames, asc, sampleRate, channels = 1, chapters = [], tags = {}, bitrate = 96000 }) {
  const totalSamples = frames.reduce((a, f) => a + f.samples, 0);
  const durMs = Math.round((totalSamples / sampleRate) * 1000);
  const ftyp = box('ftyp', str('M4B '), be(0, 4), str('M4B '), str('M4A '), str('mp42'), str('isom'));
  const mdatHeader = 8;
  const dataOffset = ftyp.length + mdatHeader;
  const mdat = box('mdat', ...frames.map((f) => f.data));

  const matrix = u8(be(0x10000, 4), be(0, 4), be(0, 4), be(0, 4), be(0x10000, 4), be(0, 4), be(0, 4), be(0, 4), be(0x40000000, 4));
  const mvhd = full('mvhd', 0, 0, be(0, 4), be(0, 4), be(1000, 4), be(durMs, 4), be(0x10000, 4), be(0x100, 2), new Uint8Array(10), matrix, new Uint8Array(24), be(2, 4));
  const tkhd = full('tkhd', 0, 7, be(0, 4), be(0, 4), be(1, 4), be(0, 4), be(durMs, 4), new Uint8Array(8), be(0, 2), be(0, 2), be(0x100, 2), be(0, 2), matrix, be(0, 4), be(0, 4));
  const mdhd = full('mdhd', 0, 0, be(0, 4), be(0, 4), be(sampleRate, 4), be(totalSamples, 4), be(0x55c4, 2), be(0, 2)); // language 'und'
  const hdlr = full('hdlr', 0, 0, be(0, 4), str('soun'), new Uint8Array(12), str('SoundHandler\0'));
  const esds = full('esds', 0, 0, desc(0x03, u8(be(1, 2), new Uint8Array([0]),
    desc(0x04, u8(new Uint8Array([0x40, 0x15]), be(0, 3), be(bitrate, 4), be(bitrate, 4), desc(0x05, asc))),
    desc(0x06, new Uint8Array([0x02])))));
  const mp4a = box('mp4a', new Uint8Array(6), be(1, 2), new Uint8Array(8), be(channels, 2), be(16, 2), be(0, 2), be(0, 2), be(sampleRate * 65536, 4), esds);
  // stts: runs of equal frame durations
  const runs = [];
  for (const f of frames) { const r = runs[runs.length - 1]; if (r && r[1] === f.samples) r[0]++; else runs.push([1, f.samples]); }
  const stbl = box('stbl',
    full('stsd', 0, 0, be(1, 4), mp4a),
    full('stts', 0, 0, be(runs.length, 4), ...runs.map(([n, d]) => u8(be(n, 4), be(d, 4)))),
    full('stsc', 0, 0, be(1, 4), be(1, 4), be(frames.length, 4), be(1, 4)),
    full('stsz', 0, 0, be(0, 4), be(frames.length, 4), ...frames.map((f) => be(f.data.length, 4))),
    full('stco', 0, 0, be(1, 4), be(dataOffset, 4)));
  const minf = box('minf', full('smhd', 0, 0, be(0, 4)), box('dinf', full('dref', 0, 0, be(1, 4), full('url ', 0, 1))), stbl);
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));

  // Nero chapters: version 1, reserved, count, then [100-ns start (u64), title length (u8), UTF-8 title].
  const chs = chapters.slice(0, 255).map((c) => { const t = enc.encode(String(c.title || 'Chapter')).slice(0, 255); return u8(be(Math.round(c.startMs * 10000), 8), new Uint8Array([t.length]), t); });
  const chpl = full('chpl', 1, 0, be(0, 4), new Uint8Array([chs.length]), ...chs);
  const dataAtom = (type, value) => box(type, box('data', be(type === 'covr' ? (value.type === 'png' ? 14 : 13) : 1, 4), be(0, 4), type === 'covr' ? value.bytes : enc.encode(String(value))));
  const items = [['©nam', tags.title], ['©ART', tags.artist], ['©alb', tags.album], ['©gen', 'Audiobook']].filter(([, v]) => v);
  const ilst = box('ilst', ...items.map(([k, v]) => dataAtom(k, v)), ...(tags.cover?.bytes?.length ? [dataAtom('covr', tags.cover)] : []));
  const meta = full('meta', 0, 0, full('hdlr', 0, 0, be(0, 4), str('mdir'), str('appl'), new Uint8Array(9)), ilst);
  const udta = box('udta', ...(chs.length ? [chpl] : []), meta);

  return u8(ftyp, mdat, box('moov', mvhd, trak, udta));
}

// Encode a stream of mono Float32 PCM blocks to AAC frames with WebCodecs (browser only).
export async function encodeAac(blocks, { sampleRate = 44100, bitrate = 96000, onProgress } = {}) {
  const frames = [];
  let asc = null, err = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !asc) asc = new Uint8Array(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      frames.push({ data, samples: Math.max(1, Math.round(((chunk.duration || 0) / 1e6) * sampleRate)) || 1024 });
    },
    error: (e) => { err = e; },
  });
  encoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 1, bitrate });
  let ts = 0, i = 0;
  for await (const pcm of blocks) {
    if (err) throw err;
    if (!pcm?.length) continue;
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: Math.round((ts / sampleRate) * 1e6), data: pcm }));
    ts += pcm.length;
    onProgress?.(++i);
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
  }
  await encoder.flush();
  encoder.close();
  if (err) throw err;
  // AAC frames are 1024 samples; trust that over rounded chunk durations
  for (const f of frames) if (Math.abs(f.samples - 1024) < 3) f.samples = 1024;
  return { frames, asc, sampleRate };
}
