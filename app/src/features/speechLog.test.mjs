import assert from 'node:assert/strict';
import { speechSession, keepSession } from './speechLog.js';

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
assert.deepEqual(r.m, [[0, 3, 60, 60], [1, 1, 100, 80]]);
assert.ok(keepSession(r));
assert.ok(!keepSession(speechSession({ at: 0 }).finish(1000)));
console.log('speechLog: all cases pass');
