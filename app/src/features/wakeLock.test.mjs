// Self-check for the keep-awake policy. The browser half (the Wake Lock sentinel) can't run in
// node; this pins WHEN the lock should be held, which is where the bugs would be.
import assert from 'node:assert/strict';
import { shouldKeepAwake, wakeLockSupported, keepAwakeHeld, setKeepAwake } from './wakeLock.js';

// The three activities that run for minutes without a tap — the reason a phone locks mid-use.
assert.equal(shouldKeepAwake({ playing: true }), true, 'RSVP playback');
assert.equal(shouldKeepAwake({ readAloud: true }), true, 'read-aloud');
assert.equal(shouldKeepAwake({ recording: true }), true, 'a narration recording session');
assert.equal(shouldKeepAwake({ playing: true, readAloud: true, recording: true }), true);

// Idle reading is NOT a reason to pin the screen on — you're touching it to scroll, and holding a
// wake lock through an unattended tab would just drain the battery.
assert.equal(shouldKeepAwake({}), false);
assert.equal(shouldKeepAwake({ playing: false, readAloud: false, recording: false }), false);

// The setting wins over everything.
assert.equal(shouldKeepAwake({ enabled: false, playing: true }), false);
assert.equal(shouldKeepAwake({ enabled: false, readAloud: true, recording: true }), false);
// Absent `enabled` defaults to on, so a caller that forgets it still gets the protection.
assert.equal(shouldKeepAwake({ playing: true, enabled: undefined }), true);

// Without the API nothing is held, and asking for it must not throw in a browser that lacks it.
assert.equal(wakeLockSupported(), false, 'node has no navigator.wakeLock');
setKeepAwake(true);
assert.equal(keepAwakeHeld(), false, 'unsupported → nothing held, no crash');
setKeepAwake(false);
assert.equal(keepAwakeHeld(), false);
setKeepAwake(true); setKeepAwake(true); setKeepAwake(false); setKeepAwake(false); // idempotent

console.log('wakeLock: all cases pass');
