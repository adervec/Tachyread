import assert from 'node:assert/strict';
import { speechSession, keepSession, countFillers } from './speechLog.js';

const s = speechSession({ at: 0, cs: 'abc', from: 10 });
s.move([[10, 1], [11, 0.8], [12, 0]], 13, 5000);
s.miss();
s.voice({ overall: 60, scores: { clarity: 50, pace: 70 } }, 6000);
s.move([[13, 1]], 14, 65000);
s.voice({ overall: 80, scores: { clarity: 70 } }, 70000);
const r = s.finish(90000);
assert.deepEqual([r.words, r.moves, r.misses, r.exact, r.near, r.skip, r.from, r.to], [4, 2, 1, 2, 1, 1, 10, 14]);
assert.equal(r.q, 70); // (1 + .8 + 0 + 1) / 4
assert.deepEqual(r.voice, { overall: 70, scores: { clarity: 60, pace: 70 } });
assert.deepEqual(r.m, [[0, 3, 60, 60, 0], [1, 1, 100, 80, 0]]);
assert.ok(keepSession(r));
assert.ok(!keepSession(speechSession({ at: 0 }).finish(1000)));
// filler words: counted only when they aren't in the text being read
assert.equal(countFillers('um the spice uh must flow', 'the spice must flow'), 2);
assert.equal(countFillers('it was like a dream', 'it was like a dream'), 0, '"like" in the book is just reading');
assert.equal(countFillers('you know I mean it is like really', 'it is really'), 3, 'two phrases + like');
assert.equal(countFillers('Um, UH... erm', ''), 3, 'punctuation / case ignored');
assert.equal(countFillers('', 'x'), 0);
{
  const s2 = speechSession({ at: 0 });
  s2.fillers(2, 30000); s2.fillers(1, 90000); s2.fillers(0, 95000);
  const r = s2.finish(100000);
  assert.equal(r.f, 3);
  assert.deepEqual(r.m.map((m) => m[4]), [2, 1], 'per-minute filler column');
}
console.log('speechLog: all cases pass');
