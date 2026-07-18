// Run: node src/features/triggerSequences.test.mjs
import assert from 'node:assert';
import { createSequenceMatcher, stepMatches, stepLabel } from './triggerSequences.js';

const rows = [
  { steps: ['g:fist', 'v:play'], commandId: 'playPause', on: true },
  { steps: ['c:2', 'c:2'], commandId: 'restart', on: true },
  { steps: ['g:thumbUp:L', 'g:thumbUp:R'], commandId: 'wpmUp100', on: true },
  { steps: ['g:victory', 'v:go'], commandId: 'nextPara', on: false }, // disabled — preserved but inert
];

let m = createSequenceMatcher();
assert.equal(m.feed('g:fist', 1000, rows), null, 'first step alone does not fire');
assert.equal(m.feed('v:play', 2000, rows), 'playPause', 'fist → “play” fires');
assert.equal(m.feed('v:play', 2100, rows), null, 'buffer consumed — no double fire');

// Window: too slow breaks the chain.
m = createSequenceMatcher({ windowMs: 5000 });
m.feed('g:fist', 1000, rows);
assert.equal(m.feed('v:play', 7000, rows), null, 'steps too far apart do not fire');

// A stray event in between breaks the chain (strict contiguity).
m = createSequenceMatcher();
m.feed('g:fist', 1000, rows);
m.feed('c:1', 1500, rows);
assert.equal(m.feed('v:play', 2000, rows), null, 'stray event between steps breaks the sequence');

// Clap doubles work.
m = createSequenceMatcher();
m.feed('c:2', 1000, rows);
assert.equal(m.feed('c:2', 2000, rows), 'restart', 'clap-clap pattern chain fires');

// Hand-qualified steps: left-then-right thumbs; a hand-agnostic step matches either hand.
m = createSequenceMatcher();
m.feed('g:thumbUp:L', 1000, rows);
assert.equal(m.feed('g:thumbUp:R', 1800, rows), 'wpmUp100', 'L-then-R thumb sequence fires');
assert.ok(stepMatches('g:fist', 'g:fist:L'), 'agnostic step matches left-hand event');
assert.ok(!stepMatches('g:fist:L', 'g:fist:R'), 'left step does not match right event');
assert.ok(!stepMatches('g:fist:L', 'g:fist'), 'hand-specific step needs a hand-qualified event');

// Disabled rows never fire.
m = createSequenceMatcher();
m.feed('g:victory', 1000, rows);
assert.equal(m.feed('v:go', 1500, rows), null, 'disabled sequence stays inert');

// Labels.
assert.equal(stepLabel('v:play'), '🗣 “play”');
assert.equal(stepLabel('c:3'), '👏×3');
assert.equal(stepLabel('g:fist:L', { fist: { icon: '✊', label: 'Fist' } }), '✊ Fist (left)');
console.log('ok');
