// Self-check for audiobookExport.js — run: node app/src/features/audiobookExport.demo.mjs
import assert from 'node:assert';
import { planTracks, trackFileName, buildM3u, encodeWav, buildId3v2, sanitizeFilename, estimateBytes, fmtDuration, orderSectionItems } from './audiobookExport.js';

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

// ID3v2 tag: "ID3" magic, v2.3, synchsafe size = frame bytes, and TIT2/TALB/TRCK present.
const id3 = buildId3v2({ title: 'Chapter 1', album: 'My Book', artist: 'Tachyread', track: 2, trackTotal: 9 });
assert.equal(String.fromCharCode(id3[0], id3[1], id3[2]), 'ID3');
assert.equal(id3[3], 3); // v2.3
const id3str = String.fromCharCode(...id3);
assert.ok(id3str.includes('TIT2') && id3str.includes('TALB') && id3str.includes('TRCK'));
assert.ok(id3str.includes('2/9')); // track/total
const synch = (id3[6] << 21) | (id3[7] << 14) | (id3[8] << 7) | id3[9];
assert.equal(synch, id3.length - 10); // synchsafe size = everything after the 10-byte header

// WAV with tags: a RIFF INFO LIST chunk is appended and RIFF size accounts for it.
const wavT = encodeWav(new Float32Array([0, 0.5, -0.5]), 22050, { title: 'Chapter 1', album: 'My Book', track: 2, trackTotal: 9 });
const wavTstr = String.fromCharCode(...wavT);
assert.ok(wavTstr.includes('LIST') && wavTstr.includes('INFO') && wavTstr.includes('INAM'));
assert.ok(wavTstr.includes('IPRD') && wavTstr.includes('ITRK'));
const dvT = new DataView(wavT.buffer);
assert.equal(dvT.getUint32(4, true), wavT.length - 8); // RIFF size = whole file minus "RIFF"+size

assert.ok(estimateBytes(60000, 'mp3') < estimateBytes(60000, 'wav')); // mp3 smaller
assert.equal(fmtDuration(3661000), '1:01:01');
assert.equal(fmtDuration(65000), '1:05');

// orderSectionItems: intro → title → chunks → outro, missing slots skipped, all one section title.
const chunkItems = [{ startLine: 10, ms: 1000, sectionTitle: 'Ch 1' }, { startLine: 13, ms: 1000, sectionTitle: 'Ch 1' }];
const full = orderSectionItems('Ch 1', chunkItems, { intro: { id: 'i', durationMs: 500 }, title: { id: 't', durationMs: 300 }, outro: { id: 'o', durationMs: 500 } }, 10, 15);
assert.deepEqual(full.map((x) => x.role || 'chunk'), ['intro', 'title', 'chunk', 'chunk', 'outro'], 'listening order');
assert.ok(full.every((x) => x.sectionTitle === 'Ch 1'), 'all items stay in the section (one track)');
assert.equal(full[0].clipId, 'i'); assert.equal(full[4].clipId, 'o');
assert.equal(full[4].startLine, 15, 'outro sits after the last chunk');
// only some slots
const some = orderSectionItems('Ch 1', chunkItems, { title: { id: 't', durationMs: 300 } }, 10, 15);
assert.deepEqual(some.map((x) => x.role || 'chunk'), ['title', 'chunk', 'chunk']);
// no extras → unchanged
assert.deepEqual(orderSectionItems('Ch 1', chunkItems, {}, 10, 15), chunkItems);
// a music-only section (no narration) is just the extras
assert.deepEqual(orderSectionItems('Interlude', [], { intro: { id: 'i', durationMs: 500 } }, 5, 5).map((x) => x.role), ['intro']);

console.log('audiobookExport.demo: all assertions passed ✅');
