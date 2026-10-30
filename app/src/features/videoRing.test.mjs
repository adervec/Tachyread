import assert from 'node:assert/strict';
import { trimSegments, totalMs } from './videoRing.js';

const seg = (id, ms) => ({ id, ms });
const s = [seg('a', 15000), seg('b', 15000), seg('c', 15000), seg('d', 7000)];
assert.deepEqual(trimSegments(s, 30000).map((x) => x.id), ['b', 'c', 'd'], 'covers 30 s with the newest: 37 s kept, dropping b would leave 22 s');
assert.deepEqual(trimSegments(s, 22000).map((x) => x.id), ['c', 'd']);
assert.deepEqual(trimSegments(s, 999999).map((x) => x.id), ['a', 'b', 'c', 'd'], 'not enough yet → keep all');
assert.deepEqual(trimSegments(s, 1000).map((x) => x.id), ['d'], 'always keeps the newest');
assert.deepEqual(trimSegments(s, 0), [], '0 = off');
assert.equal(trimSegments(s, 999999), s, 'unchanged list returned as-is');
assert.equal(totalMs(s), 52000);
console.log('videoRing: all cases pass');
