// node src/features/coworkSnapshotPick.test.mjs — a request carries the snapshot files its instructions read.
import assert from 'node:assert/strict';
import { snapshotForOps } from './coworkApply.js';

const f = { 'typing.json': 'T', 'speaking.json': 'S', 'activity-log.md': 'A', 'books.json': 'B', 'goals.json': 'G' };
assert.deepEqual(snapshotForOps(f, 'From snapshot/typing.json analyse'), { 'typing.json': 'T' }, 'only the files named');
assert.deepEqual(snapshotForOps(f, 'read the snapshot/ files'), { 'activity-log.md': 'A', 'goals.json': 'G' }, 'the overview set (those present)');
assert.deepEqual(snapshotForOps(f, 'no snapshot mentioned'), {});
assert.deepEqual(snapshotForOps(null, 'snapshot/typing.json'), {}, 'no snapshot written: nothing');
const big = snapshotForOps({ 'typing.json': 'x'.repeat(200_001) }, 'snapshot/typing.json')['typing.json'];
assert.ok(big.length < 200_100 && big.endsWith('too long to send whole)'), 'a huge file is cut, and says so');
console.log('coworkSnapshotPick: all cases pass');
