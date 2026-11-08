import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { oggCrc, oggPage, opusHead, buildOggOpus } from './oggOpus.js';

// CRC: the table is the plain (non-reflected) 0x04c11db7 — the two one-byte checks below are the
// polynomial's first table entries, and the page check against mutagen covers whole pages.
assert.equal(oggCrc(new Uint8Array([0])), 0);
assert.equal(oggCrc(new Uint8Array([1])), 0x04c11db7);

// Fake Opus: 130 packets of 20 ms (960 samples) ≈ 2.6 s; one is exactly 255 bytes (lacing edge case).
const packets = Array.from({ length: 130 }, (_, i) => ({ data: new Uint8Array(i === 3 ? 255 : 40 + (i % 9)).fill(i + 1), samples: 960 }));
const head = opusHead({ preSkip: 312 });
assert.equal(head.length, 19);
assert.equal(new TextDecoder().decode(head.slice(0, 8)), 'OpusHead');
const bytes = buildOggOpus(packets, head, { totalSamples: 130 * 960 - 500 }); // last page trimmed by 500 padding samples

// Page framing: every page starts "OggS"; the lacing for a 255-byte packet is [255, 0].
const pageStarts = [];
for (let i = 0; i + 4 <= bytes.length; i++) if (bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53) pageStarts.push(i);
assert.equal(pageStarts.length, 2 + Math.ceil(130 / 50), 'head + tags + 3 audio pages');
const p255 = oggPage([new Uint8Array(255)], { granule: 0, serial: 1, seq: 0 });
assert.deepEqual([...p255.slice(26, 29)], [2, 255, 0], '255-byte packet laces as 255 then 0');
assert.equal(bytes[5], 2, 'first page: beginning-of-stream flag');
assert.equal(bytes[pageStarts[pageStarts.length - 1] + 5], 4, 'last page: end-of-stream flag');

// Independent reader: mutagen writes the same page bytes (CRC included) and reads the stream back.
const pylib = process.env.MUTAGEN_PATH;
let checked = false;
if (pylib) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogg-'));
  fs.writeFileSync(path.join(dir, 't.opus'), bytes);
  fs.writeFileSync(path.join(dir, 'page.bin'), oggPage([new Uint8Array([1, 2, 3]), new Uint8Array(255).fill(9)], { granule: 123456789012, serial: 0x54524f50, seq: 7, eos: true }));
  const out = execSync(`python -c "import json,mutagen.ogg as o,mutagen.oggopus as op;p=o.OggPage();p.packets=[bytes([1,2,3]),bytes([9])*255];p.position=123456789012;p.serial=0x54524f50;p.sequence=7;p.last=True;f=op.OggOpus('t.opus');print(json.dumps({'same':p.write()==open('page.bin','rb').read(),'len':round(f.info.length,3),'ch':f.info.channels,'vendor':f.tags.vendor}))"`, { cwd: dir, encoding: 'utf8', env: { ...process.env, PYTHONPATH: pylib, PYTHONIOENCODING: 'utf-8' } });
  const m = JSON.parse(out);
  assert.equal(m.same, true, 'page bytes (incl. CRC) identical to mutagen’s');
  assert.equal(m.len, Math.round(((130 * 960 - 500) / 48000) * 1000) / 1000, 'length = trimmed samples / 48 kHz');
  assert.equal(m.ch, 1);
  assert.equal(m.vendor, 'tachyread');
  fs.rmSync(dir, { recursive: true, force: true });
  checked = true;
}
console.log(`oggOpus: all cases pass${checked ? ' (read back by mutagen)' : ' (set MUTAGEN_PATH to also read it back with mutagen)'}`);
