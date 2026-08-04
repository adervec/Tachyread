// Self-check: avatar expression tiers are calibrated to REAL sustained reading speeds.
// Run: node src/engine/faceExpression.test.mjs
import assert from 'node:assert/strict';
import { faceTier, faceExpression, FACE_TIERS, FACE_TIER_LABELS, FACE_WPM_MAX } from './faceExpression.js';

// Bands: ascending, one label each, and the top is ATTAINABLE — a sustained pace a fast human
// reader actually holds, not the old 1000-wpm ceiling nobody reaches.
assert.equal(FACE_TIERS.length, 8);
assert.equal(FACE_TIER_LABELS.length, 8);
for (let i = 1; i < FACE_TIERS.length; i++) assert.ok(FACE_TIERS[i] > FACE_TIERS[i - 1], 'thresholds ascend');
assert.equal(FACE_WPM_MAX, 600, 'top tier is an exceptional-but-real sustained pace');
assert.ok(FACE_WPM_MAX <= 700, 'top tier stays inside human sustained reading');

// The meta-analytic average adult (~238 non-fiction / ~260 fiction) sits mid-scale, not near the
// bottom — the whole point of the recalibration.
assert.equal(faceTier(238), 2);
assert.equal(faceTier(260), 3, 'average adult reads at the middle tier');
assert.ok(faceTier(300) >= 3, 'a good reader is above average');
assert.equal(faceTier(400), 5);
assert.equal(faceTier(600), 7, 'top tier reachable at 600');
assert.equal(faceTier(5000), 7, 'absurd speeds just cap');
assert.equal(faceTier(0), 0);
assert.equal(faceTier(119), 0);
assert.equal(faceTier(120), 1, 'threshold is inclusive');

// Expression interpolates monotonically toward wide-awake: lids open, glow arrives at speed.
const slow = faceExpression(60);
const avg = faceExpression(260);
const fast = faceExpression(600);
assert.ok(slow.lidDroop > avg.lidDroop && avg.lidDroop > fast.lidDroop, 'lids open as pace climbs');
assert.equal(fast.lidDroop, 0);
assert.ok(fast.glow > 0 && slow.glow === 0, 'only real speed glows');
assert.ok(fast.browOff < slow.browOff, 'brows raise');
assert.ok(fast.mouthCtrl < slow.mouthCtrl, 'mouth curves into a smile');
assert.equal(faceExpression(700).tier, 7, 'past the top just holds the top expression');
assert.deepEqual(faceExpression(-5).iris, faceExpression(0).iris, 'negative wpm clamps to zero');
assert.equal(faceExpression(260).iris.length, 3);

console.log('faceExpression: all checks passed');
