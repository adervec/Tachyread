// Self-check: the camera eye-rotoscope model (styles, WPM glow, cover-crop point mapping).
// Run: node src/features/eyeFx.test.mjs
import assert from 'node:assert/strict';
import { EYE_FX_STYLE_IDS, DEFAULT_EYE_FX, normalizeEyeFx, wpmGlowIntensity, eyeShadow, mapEyePoint } from './eyeFx.js';

// Normalize: clamps + fallbacks.
const n = normalizeEyeFx({ style: 'nonsense', size: 99, opacity: -1, emoji: '', color: 0, wpmGlow: 1, on: 'yes' });
assert.equal(n.style, 'glow');
assert.equal(n.size, 2.2);
assert.equal(n.opacity, 0.1);
assert.equal(n.emoji, '👁');
assert.equal(n.color, DEFAULT_EYE_FX.color);
assert.equal(n.on, true);
assert.ok(EYE_FX_STYLE_IDS.includes('laser') && EYE_FX_STYLE_IDS.includes('emoji') && new Set(EYE_FX_STYLE_IDS).size >= 6, 'a rich style set');
assert.deepEqual(normalizeEyeFx(null), DEFAULT_EYE_FX, 'null → defaults (off)');

// WPM glow: monotonic, floored so the eyes never go dark, saturating at a blazing pace.
assert.equal(wpmGlowIntensity(0), 0.15, 'idle floor');
assert.ok(wpmGlowIntensity(300) > wpmGlowIntensity(150), 'faster reading → brighter');
assert.equal(wpmGlowIntensity(2000), 1, 'caps at 1');
const sLow = eyeShadow('#4fd8ff', 0.15);
const sHigh = eyeShadow('#4fd8ff', 1);
assert.ok(parseInt(sHigh.match(/0 0 (\d+)px/)[1], 10) > parseInt(sLow.match(/0 0 (\d+)px/)[1], 10), 'shadow grows with intensity');

// Cover-crop mapping: a 4:3 video (320×240) displayed in a wide short box (272×150, cover) crops
// top/bottom; the centre maps to the centre, and mirroring flips x.
const box = { vw: 320, vh: 240, W: 272, H: 150, mirrored: false };
const c = mapEyePoint({ x: 0.5, y: 0.5 }, box);
assert.ok(Math.abs(c.x - 136) < 0.01 && Math.abs(c.y - 75) < 0.01, `centre stays centred, got ${JSON.stringify(c)}`);
const left = mapEyePoint({ x: 0.25, y: 0.5 }, box);
assert.ok(left.x < c.x, 'left of frame maps left when unmirrored');
const mirrored = mapEyePoint({ x: 0.25, y: 0.5 }, { ...box, mirrored: true });
assert.ok(Math.abs(mirrored.x - (272 - left.x)) < 0.01, 'mirroring flips x across the box');
// Vertical crop: y=0 (frame top) maps ABOVE the box (cover cropped it off).
assert.ok(mapEyePoint({ x: 0.5, y: 0 }, box).y < 0, 'cropped top maps off-box');
// Scale sanity: cover scale is the LARGER ratio (272/320 = 0.85 wins over 150/240 = 0.625).
const dx = mapEyePoint({ x: 0.75, y: 0.5 }, box).x - c.x;
assert.ok(Math.abs(dx - 0.25 * 320 * 0.85) < 0.01, 'x distances scale by the cover factor');
assert.equal(mapEyePoint({ x: 0.5, y: 0.5 }, { vw: 0, vh: 240, W: 272, H: 150 }), null, 'no video dims → null');

console.log('eyeFx: all checks passed');
