// Ogg Opus writer: Opus packets from WebCodecs' AudioEncoder → one .ogg/.opus file, the container
// every Chromium / Firefox <audio> and decodeAudioData reads. Hand-written: Ogg is page framing plus
// a CRC, so a muxer dependency would be bigger than this file. Pure: bytes in, bytes out.
// ponytail: Safari can't play Ogg Opus (it wants CAF/WebM) — clipCodec keeps WAV on such browsers.

// Ogg's CRC-32: polynomial 0x04c11db7, no reflection, init 0, no final xor.
const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = (r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1) >>> 0; CRC[i] = r; }
export function oggCrc(bytes) { let c = 0; for (const b of bytes) c = (((c << 8) >>> 0) ^ CRC[((c >>> 24) ^ b) & 0xff]) >>> 0; return c; }

const le = (n, bytes) => { const b = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) { b[i] = n % 256; n = Math.floor(n / 256); } return b; };
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u8 = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// One Ogg page holding whole packets. granule = samples (48 kHz) decodable through this page.
export function oggPage(packets, { granule, serial, seq, bos = false, eos = false }) {
  const lacing = [];
  for (const p of packets) { let L = p.length; while (L >= 255) { lacing.push(255); L -= 255; } lacing.push(L); }
  const head = new Uint8Array(27 + lacing.length);
  head.set([0x4f, 0x67, 0x67, 0x53, 0, (bos ? 2 : 0) | (eos ? 4 : 0)]);
  head.set(le(granule, 8), 6); head.set(le(serial, 4), 14); head.set(le(seq, 4), 18); // crc (22..25) is 0 while summing
  head[26] = lacing.length; head.set(lacing, 27);
  const out = u8(head, ...packets);
  out.set(le(oggCrc(out), 4), 22);
  return out;
}

// The 19-byte OpusHead when the encoder didn't hand one over (312 = libopus' 48 kHz lookahead).
export function opusHead({ channels = 1, preSkip = 312, inputRate = 48000 } = {}) {
  return u8(ascii('OpusHead'), new Uint8Array([1, channels]), le(preSkip, 2), le(inputRate, 4), le(0, 2), new Uint8Array([0]));
}

// packets: [{ data: Uint8Array, samples }] (samples per packet at 48 kHz, normally 960 = 20 ms).
// head: OpusHead bytes (the encoder's decoderConfig.description, or opusHead()).
// totalSamples: the real sample count, so the last page's granule trims the encoder's padding.
export function buildOggOpus(packets, head = opusHead(), { totalSamples = Infinity, perPage = 50, serial = 0x54524f50 } = {}) {
  const preSkip = head[10] | (head[11] << 8);
  const tags = u8(ascii('OpusTags'), le(9, 4), ascii('tachyread'), le(0, 4));
  const pages = [oggPage([head], { granule: 0, serial, seq: 0, bos: true }), oggPage([tags], { granule: 0, serial, seq: 1 })];
  let granule = preSkip;
  for (let i = 0; i < packets.length; i += perPage) {
    const group = packets.slice(i, i + perPage);
    const last = i + perPage >= packets.length;
    granule += group.reduce((a, p) => a + p.samples, 0);
    if (last) granule = Math.min(granule, preSkip + totalSamples);
    pages.push(oggPage(group.map((p) => p.data), { granule, serial, seq: 2 + i / perPage, eos: last }));
  }
  return u8(...pages);
}
