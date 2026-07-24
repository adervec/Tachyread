// ponytail: the cover collection (master selection, add/remove) + spec→SVG render + AI-spec parsing.
// Run: node src/features/bookCovers.test.mjs
import assert from 'node:assert';
import {
  bookCovers, masterCover, bookCoverSrc, hasCover, addCover, removeCover, setMaster,
  coverSpecToSvg, proceduralCover, proceduralSpec, coverPromptFor, parseCoverSpec, MOTIFS,
} from './bookCovers.js';

// ── collection: add / master / remove ──────────────────────────────────────────
let b = { id: 'x', title: 'A Book', covers: [] };
assert.equal(hasCover(b), false, 'no covers yet');
b = { ...b, ...addCover(b, { src: 'data:one', source: 'upload' }) };
assert.equal(b.covers.length, 1, 'cover added');
assert.equal(b.coverMaster, b.covers[0].id, 'first cover auto-becomes master');
assert.equal(bookCoverSrc(b), 'data:one', 'master src resolves');

b = { ...b, ...addCover(b, { src: 'data:two', source: 'link' }) };
assert.equal(b.covers.length, 2, 'second cover added');
assert.equal(bookCoverSrc(b), 'data:one', 'master unchanged when a second is added');
const secondId = b.covers[1].id;
assert.notEqual(b.covers[0].id, secondId, 'ids are unique');

b = { ...b, ...setMaster(b, secondId) };
assert.equal(bookCoverSrc(b), 'data:two', 'setMaster switches which cover shows');
assert.deepEqual(setMaster(b, 'nope'), {}, 'setMaster to a missing id is a no-op');

b = { ...b, ...removeCover(b, secondId) };
assert.equal(b.covers.length, 1, 'removed');
assert.equal(b.coverMaster, b.covers[0].id, 'removing the master promotes the next cover');

b = { ...b, ...removeCover(b, b.covers[0].id) };
assert.equal(b.covers.length, 0, 'all removed');
assert.equal(masterCover(b), null, 'no master when empty');
assert.equal(bookCovers({}).length, 0, 'a book with no covers array → empty');

// ── spec → SVG ──────────────────────────────────────────────────────────────────
const url = coverSpecToSvg({ bg: ['#112233', '#001122'], accent: '#ffcc00', motif: 'tower', font: 'serif' }, { title: 'The Very Long Title That Wraps Across Lines', author: 'Jane Doe' });
assert.ok(url.startsWith('data:image/svg+xml,'), 'returns an svg data url');
const decoded = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
assert.ok(decoded.includes('<svg') && decoded.includes('linearGradient'), 'renders a gradient svg');
assert.ok(decoded.includes('Jane Doe'), 'author is drawn');
assert.ok(decoded.includes('#ffcc00'), 'accent colour used');
// XSS: a malicious title must be escaped, never injected as markup.
const evil = coverSpecToSvg({}, { title: '<script>alert(1)</script>', author: '"><rect/>' });
const evilDec = decodeURIComponent(evil.slice('data:image/svg+xml,'.length));
assert.ok(!/<script>/.test(evilDec) && evilDec.includes('&lt;script&gt;'), 'title markup is escaped');
// Invalid colours fall back rather than injecting.
const bad = coverSpecToSvg({ bg: ['red; }', 'url(evil)'], accent: 'javascript:' }, { title: 'X' });
const badDec = decodeURIComponent(bad.slice('data:image/svg+xml,'.length));
assert.ok(!/javascript:/.test(badDec) && !/url\(evil\)/.test(badDec), 'invalid colours are rejected');

// ── procedural cover is deterministic ──────────────────────────────────────────
assert.equal(proceduralCover({ title: 'Same', author: 'A' }), proceduralCover({ title: 'Same', author: 'A' }), 'same book → same cover');
assert.notEqual(proceduralSpec({ title: 'Alpha' }).bg[0], proceduralSpec({ title: 'Zeta zzzz' }).bg[0], 'different titles → different palettes (usually)');
assert.equal(proceduralSpec({ title: 'T', genre: 'Fantasy' }).motif, 'tower', 'genre steers the motif');

// ── AI spec parsing ─────────────────────────────────────────────────────────────
assert.ok(coverPromptFor({ title: 'T', author: 'A', genre: 'Sci-Fi' }).includes('JSON'), 'prompt asks for JSON');
const parsed = parseCoverSpec('here you go: {"bg":["#101010","#202020"],"accent":"#00ffcc","font":"mono","motif":"orbit"} enjoy');
assert.equal(parsed.motif, 'orbit', 'motif parsed from a spec embedded in prose');
assert.equal(parsed.font, 'mono', 'valid font kept');
assert.deepEqual(parsed.bg, ['#101010', '#202020'], 'gradient parsed');
const junk = parseCoverSpec('{"motif":"skulls","font":"comic","accent":"notacolor"}');
assert.equal(junk.motif, 'none', 'an unknown motif falls back to none');
assert.equal(junk.font, 'serif', 'an unknown font falls back to serif');
assert.equal(junk.accent, '#d9b25a', 'a bad colour falls back');
assert.equal(parseCoverSpec('no json here'), null, 'no JSON → null');
assert.ok(MOTIFS.includes('none') && MOTIFS.length > 5, 'a motif vocabulary exists');

console.log('bookCovers: all cases pass');
