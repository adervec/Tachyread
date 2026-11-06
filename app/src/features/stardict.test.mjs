import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseIfo, parseIdx, entryText, gunzip, pickStardictFiles } from './stardict.js';

// Build a tiny StarDict pair in memory.
function build(entries, bits = 32) {
  const enc = new TextEncoder();
  const dictParts = [], idxParts = [];
  let off = 0;
  for (const [word, def] of entries) {
    const d = enc.encode(def);
    dictParts.push(d);
    const w = enc.encode(word);
    const rec = new Uint8Array(w.length + 1 + (bits === 64 ? 12 : 8));
    rec.set(w, 0);
    const dv = new DataView(rec.buffer);
    let p = w.length + 1;
    if (bits === 64) { dv.setUint32(p, 0); dv.setUint32(p + 4, off); p += 8; } else { dv.setUint32(p, off); p += 4; }
    dv.setUint32(p, d.length);
    idxParts.push(rec);
    off += d.length;
  }
  const cat = (parts) => { const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of parts) { out.set(x, i); i += x.length; } return out; };
  return { idx: cat(idxParts), dict: cat(dictParts) };
}

const ifo = parseIfo("StarDict's dict ifo file\nversion=2.4.2\nbookname=Tiny Test\nwordcount=3\nsametypesequence=h\n");
assert.deepEqual(ifo, { bookname: 'Tiny Test', wordcount: 3, offsetBits: 32, type: 'h' });
assert.throws(() => parseIfo('hello'), /Not a StarDict/);

const { idx, dict } = build([['Arrakis', 'A desert <b>planet</b>.<br>Also called Dune.'], ['sere', 'dry &amp; withered'], ['Sere', 'case clash (ignored)']]);
const map = parseIdx(idx);
assert.equal(map.size, 2, 'lowercased; first wins');
const [o, s] = map.get('arrakis');
assert.equal(entryText(dict, o, s, 'h'), 'A desert planet.\nAlso called Dune.');
assert.equal(entryText(dict, ...map.get('sere'), 'h'), 'dry & withered');
assert.equal(entryText(dict, ...map.get('sere'), 'm'), 'dry &amp; withered', 'plain type left alone (no tags)');

const b64 = build([['x', 'ex']], 64);
assert.deepEqual(parseIdx(b64.idx, 64).get('x'), [0, 2], '64-bit offsets');
{ const two = build([['one', 'a'], ['two', 'b']]).idx; assert.equal(parseIdx(two.subarray(0, two.length - 3)).size, 1, 'truncated tail ignored'); }

assert.equal(new TextDecoder().decode(await gunzip(gzipSync(Buffer.from('dictzip body')))), 'dictzip body');

const f = (name) => ({ name });
assert.equal(pickStardictFiles([f('a.dict.dz'), f('a.idx'), f('a.ifo')]).compressed, true);
assert.throws(() => pickStardictFiles([f('a.ifo'), f('a.idx')]), /Pick the .ifo/);
console.log('stardict: all cases pass');
