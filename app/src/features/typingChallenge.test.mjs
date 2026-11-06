import assert from 'node:assert/strict';
import { encodeChallenge, decodeChallenge, challengeFromHash, runsCsv } from './typingChallenge.js';

const c = { mode: 'homeRow', runMode: 'seconds', limit: 30, seed: 7, wpm: 84.6 };
const code = encodeChallenge(c);
assert.match(code, /^[A-Za-z0-9_-]+$/, 'URL-safe');
assert.deepEqual(decodeChallenge(code), { ...c, wpm: 85 });
assert.deepEqual(challengeFromHash(`#challenge=${code}`), { ...c, wpm: 85 });
assert.deepEqual(challengeFromHash(`#foo=1&challenge=${code}`), { ...c, wpm: 85 });
assert.equal(challengeFromHash('#nothing'), null);

// untrusted input: everything off is rejected
const bad = (o) => decodeChallenge(Buffer.from(JSON.stringify(o)).toString('base64url'));
assert.equal(bad({ m: 'passage', r: 'seconds', l: 30, s: 1, w: 50 }), null, 'book passages never travel');
assert.equal(bad({ m: 'review', r: 'seconds', l: 30, s: 1, w: 50 }), null, 'review needs the sender’s own misses');
assert.equal(bad({ m: 'nope', r: 'seconds', l: 30, s: 1, w: 50 }), null);
assert.equal(bad({ m: 'homeRow', r: 'endless', l: 30, s: 1, w: 50 }), null);
assert.equal(bad({ m: 'homeRow', r: 'seconds', l: 99999, s: 1, w: 50 }), null);
assert.equal(bad({ m: 'homeRow', r: 'seconds', l: 30, s: 1, w: 9999 }), null);
assert.equal(decodeChallenge('%%%'), null);
assert.equal(decodeChallenge('x'.repeat(500)), null);

const csv = runsCsv([
  { ts: Date.UTC(2026, 10, 6, 9), mode: 'passage', docName: 'Dune, "Book 1"', netWpm: 80, grossWpm: 84, accuracy: 97.5, words: 120, errors: 3, chars: 600, durationMs: 90000, grade: 'A' },
]).split('\r\n');
assert.equal(csv.length, 2);
assert.ok(csv[0].startsWith('date,mode,text,net_wpm,gross_wpm,accuracy'));
assert.ok(csv[1].startsWith('2026-11-06T09:00:00.000Z,passage,"Dune, ""Book 1""",80,84,97.5'), 'quotes + commas escaped');
assert.ok(csv[1].includes(',90,A,'), 'seconds + grade');
console.log('typingChallenge: all cases pass');
