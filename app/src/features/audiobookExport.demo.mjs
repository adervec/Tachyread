// Self-check for audiobookExport.js — run: node app/src/features/audiobookExport.demo.mjs
import assert from 'node:assert';
import { planTracks, trackFileName, buildM3u, encodeWav, sanitizeFilename, estimateBytes, fmtDuration } from './audiobookExport.js';

// Build 40 chunks across 3 sections, 60s each.
const items = [];
for (let i = 0; i < 40; i++) {
  const sectionTitle = i < 5 ? 'Front matter' : i < 25 ? 'Chapter 1' : 'Chapter 2';
  items.push({ startLine: i * 3, endLine: i * 3 + 2, ms: 60000, sectionTitle });
}

// Chapter mode: one track per section, but Chapter 1 (20 min) splits at maxMs = 10 min → 2 parts.
const ch = planTracks(items, { mode: 'chapter', maxMs: 10 * 60000 });
const titles = ch.map((t) => t.title);
assert.ok(titles.includes('Front matter'));
assert.ok(titles.includes('Chapter 1 (Part 1)') && titles.includes('Chapter 1 (Part 2)'), titles.join(' | '));
assert.ok(titles.includes('Chapter 2 (Part 1)')); // Chapter 2 is 15 min → also splits at the 10-min cap
assert.equal(ch.reduce((n, t) => n + t.chunkCount, 0), 40); // every chunk placed exactly once
assert.ok(ch.every((t) => t.ms <= 10 * 60000 + 60000)); // no track wildly over the cap
// indices are contiguous from 0
assert.deepEqual(ch.map((t) => t.index), ch.map((_, i) => i));

// Duration mode: ~5 min tracks over 40 min → ~8 tracks.
const dur = planTracks(items, { mode: 'duration', targetMs: 5 * 60000 });
assert.ok(dur.length >= 7 && dur.length <= 9, `~8 tracks, got ${dur.length}`);
assert.equal(dur.reduce((n, t) => n + t.chunkCount, 0), 40);
assert.ok(dur[0].title.startsWith('Track 1'));

// Not one-giant / not thousands: both modes yield a sane count for a 40-min book.
assert.ok(ch.length >= 3 && ch.length <= 12);

// filenames zero-pad to sort correctly on a phone
assert.equal(trackFileName({ index: 0, title: 'Intro: Prologue' }, 12, 'mp3'), '01 Intro Prologue.mp3');
assert.equal(sanitizeFilename('a/b\\c:d?'), 'a b c d');

// m3u playlist
const m3u = buildM3u(ch, ch.map((t, i) => trackFileName(t, ch.length, 'wav')), 'My Book');
assert.ok(m3u.startsWith('#EXTM3U'));
assert.ok(m3u.includes('#EXTINF:'));
assert.equal((m3u.match(/#EXTINF:/g) || []).length, ch.length);

// WAV encoding: valid RIFF header + correct data length for N samples
const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 22050);
assert.equal(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), 'RIFF');
assert.equal(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), 'WAVE');
assert.equal(wav.length, 44 + 5 * 2);
const dv = new DataView(wav.buffer);
assert.equal(dv.getUint32(40, true), 5 * 2); // data chunk size
assert.equal(dv.getInt16(44 + 2 * 2, true), Math.round(-0.5 * 0x8000)); // sample index 2 (-0.5) encoded

assert.ok(estimateBytes(60000, 'mp3') < estimateBytes(60000, 'wav')); // mp3 smaller
assert.equal(fmtDuration(3661000), '1:01:01');
assert.equal(fmtDuration(65000), '1:05');

console.log('audiobookExport.demo: all assertions passed ✅');
