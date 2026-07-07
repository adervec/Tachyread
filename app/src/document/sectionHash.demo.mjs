// Self-check for sectionHash. Run: node app/src/document/sectionHash.demo.mjs
import assert from 'node:assert';
import { sectionChecksum } from './sectionHash.js';

const mk = (n, seed = 'word') => Array.from({ length: n }, (_, i) => `${seed}${i}`);

// Deterministic + 16 hex chars for a long-enough range.
const a = mk(40);
const h = sectionChecksum(a, 0, 40);
assert.ok(/^[0-9a-f]{16}$/.test(h), h);
assert.equal(sectionChecksum(a, 0, 40), h); // pure/stable

// Same content re-tokenized with different punctuation/case/whitespace → same fingerprint
// (an "edition" of the same chapter).
const b = a.map((w, i) => (i % 2 ? '  ' + w.toUpperCase() + ',' : '“' + w + '”'));
assert.equal(sectionChecksum(b, 0, 40), h, 'formatting-only differences must match');

// A changed word → different fingerprint.
const c = a.slice(); c[10] = 'DIFFERENT';
assert.notEqual(sectionChecksum(c, 0, 40), h);

// Different range of the same doc → different fingerprint.
assert.notEqual(sectionChecksum(mk(80), 0, 40), sectionChecksum(mk(80), 40, 80));

// Too short to fingerprint → null (avoids false matches on tiny sections).
assert.equal(sectionChecksum(mk(5), 0, 5), null);
// Only punctuation/empty tokens → null.
assert.equal(sectionChecksum(['.', ',', '—', '  '], 0, 4), null);

// Range clamps to the array bounds.
assert.equal(sectionChecksum(a, 0, 999), h);

console.log('sectionHash.demo: all assertions passed ✅');
