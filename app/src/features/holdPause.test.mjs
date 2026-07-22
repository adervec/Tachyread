// Self-check for the hold-to-pause state machine. Run: node app/src/features/holdPause.test.mjs
import assert from 'node:assert';
import { createHoldPause, rawToKind, HOLD_RESUME_GRACE_MS } from './holdPause.js';

assert.equal(rawToKind('Open_Palm'), 'openPalm', 'raw palm maps');
assert.equal(rawToKind('Closed_Fist'), 'fist');
assert.equal(rawToKind('Nonsense'), null, 'unknown raw → null');

// Off: no `want` means it never touches playback.
let h = createHoldPause();
assert.equal(h.feed({ want: '', raw: 'Open_Palm', playing: true, now: 0 }), null, 'no hold gesture set → nothing');

// Hold the palm while playing → pause once, and only once.
h = createHoldPause({ graceMs: 300 });
assert.equal(h.feed({ want: 'openPalm', raw: 'Open_Palm', playing: true, now: 0 }), 'pause', 'holding the palm pauses');
assert.equal(h.feed({ want: 'openPalm', raw: 'Open_Palm', playing: false, now: 100 }), null, 'still held → no repeat');
assert.equal(h.isPaused(), true, 'we are holding the pause');
// Drop it → resume, but only after the grace.
assert.equal(h.feed({ want: 'openPalm', raw: null, playing: false, now: 200 }), null, 'just dropped — grace not elapsed');
assert.equal(h.feed({ want: 'openPalm', raw: null, playing: false, now: 450 }), null, 'still inside the 300ms grace? no — 250ms since lost');
assert.equal(h.feed({ want: 'openPalm', raw: null, playing: false, now: 550 }), 'resume', 'past the grace → resume');
assert.equal(h.isPaused(), false, 'no longer holding');

// A one-frame detection miss inside the grace must NOT resume (this is the whole point of the grace).
h = createHoldPause({ graceMs: 300 });
h.feed({ want: 'fist', raw: 'Closed_Fist', playing: true, now: 0 }); // pause
assert.equal(h.feed({ want: 'fist', raw: null, playing: false, now: 100 }), null, 'blip: gesture lost for one frame');
assert.equal(h.feed({ want: 'fist', raw: 'Closed_Fist', playing: false, now: 180 }), null, 'gesture back within grace — stays paused');
assert.equal(h.isPaused(), true, 'a momentary miss did not resume');
assert.equal(h.feed({ want: 'fist', raw: null, playing: false, now: 300 }), null, 'lost again — grace restarts');
assert.equal(h.feed({ want: 'fist', raw: null, playing: false, now: 700 }), 'resume', 'sustained loss → resume');

// A different gesture than the configured one is treated as "not held".
h = createHoldPause({ graceMs: 100 });
h.feed({ want: 'openPalm', raw: 'Open_Palm', playing: true, now: 0 }); // pause
assert.equal(h.feed({ want: 'openPalm', raw: 'Closed_Fist', playing: false, now: 50 }), null, 'a fist is not the palm — grace begins');
assert.equal(h.feed({ want: 'openPalm', raw: 'Closed_Fist', playing: false, now: 200 }), 'resume', 'and resumes');

// Never pauses when autoplay is already off (nothing to pause).
h = createHoldPause();
assert.equal(h.feed({ want: 'openPalm', raw: 'Open_Palm', playing: false, now: 0 }), null, 'not playing → no pause');
assert.equal(h.isPaused(), false);

// Turning the feature off mid-hold clears the state.
h = createHoldPause();
h.feed({ want: 'openPalm', raw: 'Open_Palm', playing: true, now: 0 });
assert.equal(h.feed({ want: '', raw: 'Open_Palm', playing: false, now: 100 }), null, 'disabling clears');
assert.equal(h.isPaused(), false, 'no longer considered paused');

// Grace default is sane.
assert.ok(HOLD_RESUME_GRACE_MS >= 200 && HOLD_RESUME_GRACE_MS <= 600, 'default grace is a reasonable few hundred ms');

console.log('holdPause: all assertions passed ✅');
