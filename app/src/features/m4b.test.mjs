import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildM4b } from './m4b.js';

// Fake AAC: 100 frames of 1024 samples at 44.1 kHz ≈ 2.32 s; ASC for AAC-LC 44.1 kHz mono = 0x12 0x08.
const frames = Array.from({ length: 100 }, (_, i) => ({ data: new Uint8Array(20 + (i % 7)).fill(i), samples: 1024 }));
const bytes = buildM4b({
  frames, asc: new Uint8Array([0x12, 0x08]), sampleRate: 44100,
  chapters: [{ title: 'Opening', startMs: 0 }, { title: 'Chapter Two — Ü', startMs: 1500 }],
  tags: { title: 'Dune', artist: 'Tachyread', album: 'Dune', cover: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), type: 'jpeg' } },
});

// Walk the box tree back (self-check that every size adds up).
function walk(b, start, end, depth = 0, out = []) {
  const C = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'dinf', 'ilst']);
  for (let i = start; i < end;) {
    const size = new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0);
    const type = new TextDecoder('latin1').decode(b.slice(i + 4, i + 8));
    assert.ok(size >= 8 && i + size <= end, `box ${type} fits`);
    out.push(`${'  '.repeat(depth)}${type}`);
    if (C.has(type)) walk(b, i + 8, i + size, depth + 1, out);
    if (type === 'meta') walk(b, i + 12, i + size, depth + 1, out);
    i += size;
  }
  return out;
}
const tree = walk(bytes, 0, bytes.length).map((s) => s.trim());
for (const t of ['ftyp', 'mdat', 'moov', 'mvhd', 'trak', 'stsd', 'stts', 'stsz', 'stco', 'udta', 'chpl', 'meta', 'ilst', 'covr']) assert.ok(tree.includes(t), `has ${t}`);

// stco points at the first frame's bytes inside mdat
const stcoAt = bytes.findIndex((_, i) => bytes[i] === 0x73 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x6f);
const off = new DataView(bytes.buffer).getUint32(stcoAt + 12);
assert.deepEqual([...bytes.slice(off, off + 20)], [...frames[0].data], 'chunk offset → first frame');

// Independent reader: mutagen (installed for this check; skipped where it isn't).
const pylib = process.env.MUTAGEN_PATH;
let checked = false;
if (pylib) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4b-'));
  fs.writeFileSync(path.join(dir, 't.m4b'), bytes);
  const out = execSync(`python -c "import json,mutagen.mp4 as m;f=m.MP4('t.m4b');print(json.dumps({'len':round(f.info.length,2),'sr':f.info.sample_rate,'ch':f.info.channels,'codec':f.info.codec,'nam':f.tags['\\xa9nam'],'covr':len(f.tags['covr'][0]),'chapters':[[round(c.start,2),c.title] for c in f.chapters]}))"`, { cwd: dir, encoding: 'utf8', env: { ...process.env, PYTHONPATH: pylib, PYTHONIOENCODING: 'utf-8' } });
  const m = JSON.parse(out);
  assert.equal(m.len, 2.32); assert.equal(m.sr, 44100); assert.equal(m.ch, 1); assert.equal(m.codec, 'mp4a.40.2');
  assert.deepEqual(m.nam, ['Dune']);
  assert.equal(m.covr, 7);
  assert.deepEqual(m.chapters, [[0, 'Opening'], [1.5, 'Chapter Two — Ü']]);
  fs.rmSync(dir, { recursive: true, force: true });
  checked = true;
}
console.log(`m4b: all cases pass${checked ? ' (read back by mutagen)' : ' (set MUTAGEN_PATH to also read it back with mutagen)'}`);
