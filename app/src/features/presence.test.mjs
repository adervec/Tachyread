// ponytail: cross-device presence merge — dedupe/freshness/self-exclusion + the per-checksum reader.
// Run: node src/features/presence.test.mjs
import assert from 'node:assert';
import { mergePresence, presenceList, presenceByChecksum, presenceLabel, PRESENCE_MAX_AGE_MS } from './presence.js';

const NOW = 1_000_000_000_000;
const ago = (ms) => NOW - ms;

// ── mergePresence ──
const peers = [
  { deviceId: 'laptop', name: 'Laptop', at: ago(1000), open: ['a', 'b'] },
  { deviceId: 'phone', name: 'Phone', at: ago(5000), open: ['b'] },
];
// A newer laptop entry replaces the old; a stale one is dropped; our own device is excluded.
const incoming = [
  { deviceId: 'laptop', name: 'Laptop', at: NOW, open: ['a', 'c'] },          // newer → wins
  { deviceId: 'old', name: 'Old', at: ago(PRESENCE_MAX_AGE_MS + 1), open: ['z'] }, // stale → dropped
  { deviceId: 'me', name: 'Me', at: NOW, open: ['x'] },                        // self → dropped
];
const merged = mergePresence(peers, incoming, { selfId: 'me', now: NOW });
const laptop = merged.find((e) => e.deviceId === 'laptop');
assert.deepEqual(laptop.open, ['a', 'c'], 'newer laptop entry wins');
assert.ok(!merged.some((e) => e.deviceId === 'old'), 'stale entry dropped');
assert.ok(!merged.some((e) => e.deviceId === 'me'), 'self excluded');
assert.equal(merged.length, 2, 'laptop + phone');
// idempotent-ish: merging the result again is stable
assert.equal(mergePresence(merged, [], { selfId: 'me', now: NOW }).length, 2);
// dedupes checksums within a device
assert.deepEqual(mergePresence([], [{ deviceId: 'd', at: NOW, open: ['a', 'a', 'b'] }], { now: NOW })[0].open, ['a', 'b']);

// ── presenceList (what goes into the exported bundle) ──
const list = presenceList({ open: ['a', 'b'], at: NOW }, peers, { selfId: 'me', name: 'My PC', now: NOW });
const self = list.find((e) => e.deviceId === 'me');
assert.ok(self && self.name === 'My PC' && self.open.includes('a'), 'self entry added with my open files');
assert.ok(list.some((e) => e.deviceId === 'laptop'), 'fresh peers carried forward');
assert.equal(presenceList(null, [], { selfId: 'me', now: NOW }).length, 0, 'no self open + no peers → empty');
assert.equal(presenceList({ open: [] }, [], { selfId: 'me', now: NOW }).length, 0, 'empty open list → no self entry');

// ── presenceByChecksum (what the tab bar reads) ──
const byCs = presenceByChecksum(merged, { now: NOW });
assert.deepEqual(byCs.a.map((e) => e.deviceId).sort(), ['laptop'], 'a is open on laptop');
assert.deepEqual(byCs.b.map((e) => e.deviceId).sort(), ['phone'], 'b is open on phone only (laptop moved off b)');
assert.deepEqual(byCs.c.map((e) => e.deviceId), ['laptop'], 'c is open on laptop');
assert.ok(!byCs.z, 'nothing from the dropped stale device');
// a memory-aged list hides even without a re-merge
assert.deepEqual(presenceByChecksum([{ deviceId: 'x', at: ago(PRESENCE_MAX_AGE_MS + 1), open: ['a'] }], { now: NOW }), {}, 'aged peer hidden');

// ── presenceLabel ──
assert.equal(presenceLabel([{ name: 'Laptop', deviceId: 'l' }]), 'Laptop');
assert.equal(presenceLabel([{ name: 'Laptop' }, { name: 'Phone' }]), 'Laptop & Phone');
assert.equal(presenceLabel([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'A, B & C');
assert.equal(presenceLabel([{ deviceId: 'x' }]), 'another device', 'unnamed single');
assert.equal(presenceLabel([{ deviceId: 'x' }, { deviceId: 'y' }]), '2 other devices', 'unnamed multiple');
assert.equal(presenceLabel([]), '');

// defensive: null entries in the label must not throw (guard runs before .name)
assert.doesNotThrow(() => presenceLabel([null, undefined]), 'null entries tolerated');
assert.equal(presenceLabel([null, undefined]), '2 other devices', 'null entries counted, no names');
assert.equal(presenceLabel([null, { name: 'Laptop' }]), 'Laptop', 'a null beside a named device');

console.log('presence: all cases pass');
