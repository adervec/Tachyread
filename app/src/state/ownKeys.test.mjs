// Self-check: "delete everything" touches only Tachyread's keys. Run: node src/state/ownKeys.test.mjs
import assert from 'node:assert/strict';
import { ownLocalKeys, withoutOurPortalEntry } from './ownKeys.js';

const keys = ['tachyread-found-paths', 'tachyread-q-layout', 'tachyread-instance-lock', 'maker-font', 'gymtracker-state', 'portal-installed', 'tachyreadish', null];
assert.deepEqual(ownLocalKeys(keys), ['tachyread-found-paths', 'tachyread-q-layout'], 'only our prefixed keys, never the lock or other apps');
assert.deepEqual(ownLocalKeys(undefined), []);

assert.deepEqual(JSON.parse(withoutOurPortalEntry('{"Tachyread":1,"GymTracker":2}')), { GymTracker: 2 }, 'other apps stay registered');
assert.equal(withoutOurPortalEntry('{"GymTracker":2}'), null, 'not registered → leave it alone');
assert.equal(withoutOurPortalEntry('not json'), null);
assert.equal(withoutOurPortalEntry(null), null);
console.log('ownKeys: all cases pass');
