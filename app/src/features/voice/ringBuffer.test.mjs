import assert from 'node:assert/strict';
import { createRing, downsample, resizeRing } from './ringBuffer.js';

const r = createRing(1, 4); // 4 samples
assert.deepEqual([...r.read()], []);
r.push([1, 2, 3]);
assert.deepEqual([...r.read()], [1, 2, 3]);
assert.equal(r.seconds(), 0.75);
r.push([4, 5, 6]); // wraps: oldest two overwritten
assert.deepEqual([...r.read()], [3, 4, 5, 6]);
assert.equal(r.seconds(), 1);
r.push([7, 8, 9, 10, 11]); // longer than the ring
assert.deepEqual([...r.read()], [8, 9, 10, 11]);

assert.deepEqual([...downsample([1, 3, 5, 7, 9], 2)], [2, 6]);
assert.deepEqual([...downsample([1, 2], 1)], [1, 2]);
const s = resizeRing(r, 0.5, 4); // shrink keeps the newest
assert.deepEqual([...s.read()], [10, 11]);
const g = resizeRing(s, 2, 4); // grow keeps everything
assert.deepEqual([...g.read()], [10, 11]);
assert.equal(g.capacity(), 2);
assert.deepEqual([...resizeRing(g, 1, 8).read()], [], 'rate change starts fresh');
console.log('ringBuffer: all cases pass');
