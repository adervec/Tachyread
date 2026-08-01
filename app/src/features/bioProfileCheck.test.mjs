// Self-check: whole-profile biometric conflict/overlap checker.
// Run: node src/features/bioProfileCheck.test.mjs
import assert from 'node:assert/strict';
import { checkBioProfile } from './bioProfileCheck.js';

const levels = (flags) => flags.map((f) => f.level);
const has = (flags, level, re) => flags.some((f) => f.level === level && re.test(f.message));

// A clean default profile has nothing to say.
assert.deepEqual(checkBioProfile({}), [], 'defaults → no flags');

// ── hold-to-scroll conflicts ────────────────────────────────────────────────
// Same gesture on both directions → error.
let f = checkBioProfile({ holdScroll: [{ dir: 'up', gesture: 'fist', secs: 1 }, { dir: 'down', gesture: 'fist', secs: 1 }] });
assert.ok(has(f, 'error', /BOTH up and down/), 'both directions on one gesture');

// Open palm can't hold-scroll (it's the joystick).
f = checkBioProfile({ holdScroll: [{ dir: 'up', gesture: 'openPalm', secs: 1 }] });
assert.ok(has(f, 'error', /open palm/i), 'palm rejected');

// Non-holdable gesture (wave) rejected.
f = checkBioProfile({ holdScroll: [{ dir: 'up', gesture: 'wave', secs: 1 }] });
assert.ok(has(f, 'error', /isn't a holdable pose/), 'wave rejected');

// Hold-scroll gesture also enabled + mapped → ownership warning naming the shadowed command.
f = checkBioProfile({
  holdScroll: [{ dir: 'down', gesture: 'fist', secs: 1 }],
  handGestureSet: { fist: true },
  gestureMap: { fist: 'pause' },
});
assert.ok(has(f, 'warn', /owned by hold-to-scroll.*will NOT fire/i), 'ownership shadows the mapping');

// Hold-to-pause and hold-to-scroll on the same gesture → error.
f = checkBioProfile({ holdScroll: [{ dir: 'down', gesture: 'fist', secs: 1 }], holdPauseGesture: 'fist' });
assert.ok(has(f, 'error', /pause AND scroll/), 'hold-pause vs hold-scroll');

// A disabled hold-scroll row conflicts with nothing.
f = checkBioProfile({ holdScroll: [{ dir: 'down', gesture: 'fist', secs: 1, on: false }], holdPauseGesture: 'fist' });
assert.ok(!has(f, 'error', /pause AND scroll/), 'disabled row is inert');

// ── hold-to-pause vs mapping / joystick ─────────────────────────────────────
f = checkBioProfile({ holdPauseGesture: 'victory', handGestureSet: { victory: true }, gestureMap: { victory: 'nextPara' } });
assert.ok(has(f, 'warn', /fires while you hold to pause/), 'hold-pause gesture still mapped');
f = checkBioProfile({ holdPauseGesture: 'openPalm', handGestureSet: { scroll: true } });
assert.ok(has(f, 'info', /joystick/), 'palm hold-pause + joystick is an info');

// ── confusable poses ────────────────────────────────────────────────────────
f = checkBioProfile({ handGestureSet: { iLoveYou: true, horns: true } });
assert.ok(has(f, 'warn', /similar poses/), 'ILY + horns confusion');
f = checkBioProfile({ handGestureSet: { iLoveYou: true } });
assert.ok(!has(f, 'warn', /similar poses/), 'one of a group is fine');

// ── per-hand overrides with Distinguish hands off ───────────────────────────
f = checkBioProfile({ gestureHands: false, gestureMap: { 'fist:L': 'pause' } });
assert.ok(has(f, 'info', /Distinguish hands.*off/), 'stray per-hand override flagged');
f = checkBioProfile({ gestureHands: true, gestureMap: { 'fist:L': 'pause' } });
assert.ok(!has(f, 'info', /Distinguish hands/), 'fine when the toggle is on');

// ── voice phrases ───────────────────────────────────────────────────────────
f = checkBioProfile({ voiceCommands: [
  { phrase: 'play', commandId: 'play' },
  { phrase: 'play', commandId: 'pause' },
] });
assert.ok(has(f, 'error', /mapped twice/), 'duplicate phrase, different commands');

f = checkBioProfile({ voiceCommands: [
  { phrase: 'play', commandId: 'play' },
  { phrase: 'play faster', commandId: 'wpmUp' },
] });
assert.ok(has(f, 'warn', /whichever row is first wins/), 'contained phrase overlap');

f = checkBioProfile({ voiceCommands: [
  { phrase: 'play', commandId: 'play' },
  { phrase: 'next', commandId: 'nextWord' },
] });
assert.ok(!f.some((x) => x.area === 'voice'), 'distinct phrases are clean');

// Disabled rows can't collide.
f = checkBioProfile({ voiceCommands: [
  { phrase: 'play', commandId: 'play' },
  { phrase: 'play', commandId: 'pause', on: false },
] });
assert.ok(!f.some((x) => x.area === 'voice'), 'disabled row excluded');

// ── sequences ───────────────────────────────────────────────────────────────
f = checkBioProfile({ triggerSeqs: [
  { steps: ['g:fist', 'c:1'], commandId: 'restart', on: true },
  { steps: ['g:victory', 'g:fist', 'c:1'], commandId: 'pause', on: true },
] });
assert.ok(has(f, 'error', /can never complete|eats the chain/), 'suffix sequence shadows the longer one');

f = checkBioProfile({ triggerSeqs: [
  { steps: ['g:fist', 'c:1'], commandId: 'restart', on: true },
  { steps: ['g:fist', 'c:1'], commandId: 'pause', on: true },
] });
assert.ok(has(f, 'error', /exact steps/), 'duplicate sequences');

f = checkBioProfile({
  triggerSeqs: [{ steps: ['g:fist', 'c:1'], commandId: 'restart', on: true }],
  handGestureSet: { fist: true },
  gestureMap: { fist: 'pause' },
});
assert.ok(has(f, 'info', /also run their own mapping/), 'live step mapping noted');

// ── eye mapping summary ─────────────────────────────────────────────────────
f = checkBioProfile({ eyeGestures: { rows: [
  { kind: 'blink', minMs: 600, maxMs: 1000, commandId: 'playPause', on: true },
  { kind: 'blink', minMs: 800, maxMs: 1200, commandId: 'pause', on: true },
] } });
assert.ok(has(f, 'error', /eye\/face mapping error/), 'eye overlap surfaces in the summary');

// Errors sort before warnings before infos.
f = checkBioProfile({
  holdScroll: [{ dir: 'up', gesture: 'fist', secs: 1 }, { dir: 'down', gesture: 'fist', secs: 1 }],
  handGestureSet: { iLoveYou: true, horns: true },
  gestureHands: false,
  gestureMap: { 'victory:L': 'pause' },
});
const lv = levels(f);
assert.deepEqual([...lv].sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a] - { error: 0, warn: 1, info: 2 }[b])), lv, 'sorted by severity');

console.log('bioProfileCheck: all checks passed');
