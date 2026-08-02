// Self-check: avatar mood — typing eye colour by consensus WPM tiers + idle drowsiness staging.
// Run: node src/features/avatarMood.test.mjs
import assert from 'node:assert/strict';
import { TYPING_EYE_TIERS, typingEyeColor, idleStage } from './avatarMood.js';

// The tier ladder mirrors the run tiers (Beginner … Exceptional), colours cold → hot.
assert.equal(typingEyeColor(0).tier, 'Beginner');
assert.equal(typingEyeColor(35).tier, 'Improving');
assert.equal(typingEyeColor(45).tier, 'Average');
assert.equal(typingEyeColor(60).tier, 'Proficient');
assert.equal(typingEyeColor(80).tier, 'Fast');
assert.equal(typingEyeColor(100).tier, 'Advanced');
assert.equal(typingEyeColor(150).tier, 'Exceptional');
assert.equal(typingEyeColor(110).tier, 'Exceptional', 'boundary lands on the higher tier');
assert.equal(typingEyeColor(-5).tier, 'Beginner');
assert.equal(typingEyeColor(NaN).tier, 'Beginner', 'garbage → floor tier');
// Every tier has a distinct colour.
assert.equal(new Set(TYPING_EYE_TIERS.map(([, c]) => c)).size, TYPING_EYE_TIERS.length);
assert.notEqual(typingEyeColor(20).color, typingEyeColor(120).color);

// Idle staging: awake while active, drowsy as the idle underline nearly drains, asleep on idle.
assert.equal(idleStage(1, false), 'awake');
assert.equal(idleStage(0.8, false), 'awake');
assert.equal(idleStage(0.3, false), 'drowsy');
assert.equal(idleStage(0.05, false), 'drowsy');
assert.equal(idleStage(0.9, true), 'asleep', 'idle wins regardless of fraction');
assert.equal(idleStage(null, false), 'awake', 'no fraction → awake');

console.log('avatarMood: all checks passed');
