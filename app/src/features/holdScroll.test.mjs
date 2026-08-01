// Self-check: hold-to-scroll — "hold gesture X for > Y seconds" → steady scroll until release.
// Run: node src/features/holdScroll.test.mjs
import assert from 'node:assert/strict';
import { createHoldScroll, holdScrollRows, activeHoldScrollRows, holdScrollOwns, clampHoldSecs, HOLD_SCROLL_SPEED, HOLD_SCROLL_DEFAULT_SECS } from './holdScroll.js';

// ── config folding ──────────────────────────────────────────────────────────
const rows = holdScrollRows(null);
assert.equal(rows.length, 2, 'always two rows (up + down)');
assert.deepEqual(rows.map((r) => r.dir), ['up', 'down']);
assert.ok(rows.every((r) => r.gesture === '' && r.on), 'defaults: off (no gesture), enabled');
assert.equal(rows[0].secs, HOLD_SCROLL_DEFAULT_SECS);

const folded = holdScrollRows([{ dir: 'down', gesture: 'fist', secs: 2 }]);
assert.equal(folded[1].gesture, 'fist', 'stored down row folds in');
assert.equal(folded[0].gesture, '', 'missing up row stays off');

assert.equal(clampHoldSecs(0.01), 0.3, 'secs floor');
assert.equal(clampHoldSecs(99), 5, 'secs ceiling');
assert.equal(clampHoldSecs('junk'), HOLD_SCROLL_DEFAULT_SECS, 'garbage → default');

assert.equal(activeHoldScrollRows([{ dir: 'up', gesture: 'fist', secs: 1, on: false }]).length, 0, 'disabled row is inactive');
assert.ok(holdScrollOwns([{ dir: 'up', gesture: 'fist', secs: 1 }], 'fist'), 'ownership: configured gesture');
assert.ok(!holdScrollOwns([{ dir: 'up', gesture: 'fist', secs: 1 }], 'victory'), 'ownership: other gestures free');
assert.ok(!holdScrollOwns(null, 'fist'), 'no config → owns nothing');

// ── frame-driven controller ─────────────────────────────────────────────────
const cfg = [{ dir: 'up', gesture: 'fist', secs: 1 }, { dir: 'down', gesture: 'victory', secs: 0.5 }];
let hs = createHoldScroll();
// Below threshold: nothing.
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 0 }), 0);
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 900 }), 0, 'still under 1s');
// Past threshold: scrolls up (negative), and keeps scrolling while held.
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 1000 }), -HOLD_SCROLL_SPEED, 'crosses 1s → up');
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 5000 }), -HOLD_SCROLL_SPEED, 'keeps scrolling while held');
assert.equal(hs.activeKind(), 'fist');
// One-frame detection miss inside the grace: the hold survives.
assert.equal(hs.feed({ rows: cfg, kind: null, now: 5100 }), -HOLD_SCROLL_SPEED, 'grace bridges a missed frame');
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 5200 }), -HOLD_SCROLL_SPEED, 'reacquired within grace — no reset');
// Release for longer than the grace: stops, and a new hold restarts the clock.
assert.equal(hs.feed({ rows: cfg, kind: null, now: 5300 }), -HOLD_SCROLL_SPEED, 'grace still holding');
assert.equal(hs.feed({ rows: cfg, kind: null, now: 5700 }), 0, 'released past the grace → stop');
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 6000 }), 0, 'new hold starts from zero');
assert.equal(hs.feed({ rows: cfg, kind: 'fist', now: 7100 }), -HOLD_SCROLL_SPEED, 'fires again after a full new hold');

// Down direction + per-row threshold.
hs = createHoldScroll();
assert.equal(hs.feed({ rows: cfg, kind: 'victory', now: 0 }), 0);
assert.equal(hs.feed({ rows: cfg, kind: 'victory', now: 520 }), HOLD_SCROLL_SPEED, 'victory 0.5s → down (positive)');

// Switching poses mid-hold restarts the clock on the new pose.
hs = createHoldScroll();
hs.feed({ rows: cfg, kind: 'fist', now: 0 });
assert.equal(hs.feed({ rows: cfg, kind: 'victory', now: 900 }), 0, 'switch restarts — victory held 0ms');
assert.equal(hs.feed({ rows: cfg, kind: 'victory', now: 1450 }), HOLD_SCROLL_SPEED, 'then fires on ITS threshold');

// Unconfigured poses and empty config are inert.
hs = createHoldScroll();
assert.equal(hs.feed({ rows: cfg, kind: 'thumbUp', now: 0 }), 0);
assert.equal(hs.feed({ rows: cfg, kind: 'thumbUp', now: 9000 }), 0, 'unconfigured pose never scrolls');
assert.equal(hs.feed({ rows: [], kind: 'fist', now: 0 }), 0, 'no config → inert');

console.log('holdScroll: all checks passed');
