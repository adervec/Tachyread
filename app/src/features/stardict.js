// Offline StarDict dictionaries for the 📖 Define popup. A StarDict dictionary is three files:
//   .ifo  — text header (bookname, wordcount, idxoffsetbits, sametypesequence)
//   .idx  — sorted entries: word (UTF-8, NUL-terminated) + offset + size (big-endian uint32, or
//           uint64 offsets when idxoffsetbits=64) into the .dict
//   .dict — the definitions; .dict.dz is the same gzip-compressed (dictzip), which the browser's
//           DecompressionStream reads as plain gzip.
// Pure parsing here; storage/lookup lives in state/storage.js.

export function parseIfo(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-z_]+)=(.*)$/i.exec(line.trim());
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  if (!/StarDict's dict ifo file/i.test(text) && !out.bookname) throw new Error('Not a StarDict .ifo file');
  return { bookname: out.bookname || 'Dictionary', wordcount: Number(out.wordcount) || 0, offsetBits: out.idxoffsetbits === '64' ? 64 : 32, type: out.sametypesequence || '' };
}

// .idx bytes → Map(lowercased word → [offset, size]) (first entry wins on case clashes).
export function parseIdx(bytes, offsetBits = 32) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const dec = new TextDecoder('utf-8');
  const map = new Map();
  let i = 0;
  while (i < u8.length) {
    let j = i;
    while (j < u8.length && u8[j] !== 0) j++;
    if (j + 1 + (offsetBits === 64 ? 12 : 8) > u8.length) break; // truncated tail
    const word = dec.decode(u8.subarray(i, j)).toLowerCase();
    let p = j + 1;
    const off = offsetBits === 64 ? dv.getUint32(p) * 2 ** 32 + dv.getUint32(p + 4) : dv.getUint32(p);
    p += offsetBits === 64 ? 8 : 4;
    const size = dv.getUint32(p);
    if (!map.has(word)) map.set(word, [off, size]);
    i = p + 4;
  }
  return map;
}

// One entry's text. Markup types (h = HTML, x = XDXF, g = Pango) are stripped to plain text.
export function entryText(dictBytes, off, size, type = '') {
  const u8 = dictBytes instanceof Uint8Array ? dictBytes : new Uint8Array(dictBytes);
  let s = new TextDecoder('utf-8').decode(u8.subarray(off, off + size));
  if (/[hxg]/.test(type) || /<\/?[a-z][^>]*>/i.test(s)) {
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|k|def)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  return s.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The three files of one dictionary out of a multi-file pick (any order; .dict or .dict.dz).
export function pickStardictFiles(files) {
  const by = (re) => [...files].find((f) => re.test(f.name));
  const ifo = by(/\.ifo$/i), idx = by(/\.idx$/i), dict = by(/\.dict(\.dz)?$/i);
  if (!ifo || !idx || !dict) throw new Error('Pick the .ifo, .idx and .dict (or .dict.dz) files of one dictionary together');
  return { ifo, idx, dict, compressed: /\.dz$/i.test(dict.name) };
}
