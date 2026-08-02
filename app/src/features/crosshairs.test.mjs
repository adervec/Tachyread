// Self-check: crosshair stable model (layers, fx, placement helpers).
// Run: node src/features/crosshairs.test.mjs
import assert from 'node:assert/strict';
import {
  XH_SHAPES, XH_ANIMS, XH_ANIM_LABELS, newCrosshair, newShapeLayer, newImageLayer, newEmojiLayer,
  normalizeCrosshair, backdropFilterOf, placeCrosshair, moveCrosshair, resizeCrosshair,
  removeCrosshair, starterStable, animPeriodSecs,
} from './crosshairs.js';

// Fresh designs are valid and unique.
const a = newCrosshair('A', 1);
const b = newCrosshair('B', 1);
assert.notEqual(a.id, b.id, 'ids unique even at the same timestamp');
assert.equal(a.layers.length, 1);
assert.equal(a.layers[0].kind, 'shape');

// Normalize: garbage clamps, unknown layer kinds drop, defaults fill.
const norm = normalizeCrosshair({
  id: 'x', opacity: 99,
  fx: { blur: 999, invert: -3, contrast: 0, warp: 1000, hueRotate: 720 },
  layers: [
    { kind: 'shape', shape: 'nonsense', thickness: 99, scale: 99, rotate: 999, opacity: 42 },
    { kind: 'image', src: 'data:x', scale: 0.001 },
    { kind: 'emoji', char: '🎯' },
    { kind: 'wat' },
    null,
  ],
});
assert.equal(norm.opacity, 1, 'opacity clamped');
assert.equal(norm.fx.blur, 12, 'blur clamped');
assert.equal(norm.fx.invert, 0, 'invert clamped up');
assert.equal(norm.fx.warp, 60, 'warp clamped');
assert.equal(norm.fx.hueRotate, 360, 'hue clamped');
assert.equal(norm.layers.length, 3, 'unknown/null layers dropped');
assert.equal(norm.layers[0].shape, 'cross', 'unknown shape falls back');
assert.equal(norm.layers[0].thickness, 12, 'thickness clamped');
assert.equal(norm.layers[1].scale, 0.1, 'scale floor');
assert.ok(XH_SHAPES.includes('ring') && XH_SHAPES.length >= 10, 'a rich shape set');

// Animations: defaults fill, garbage clamps, every style has a label.
assert.deepEqual(normalizeCrosshair({ id: 'x' }).anim, { style: 'none', periodMode: 'fixed', secs: 3 }, 'anim defaults');
const animNorm = normalizeCrosshair({ id: 'x', anim: { style: 'wat', periodMode: 'sometimes', secs: 999 } }).anim;
assert.equal(animNorm.style, 'none', 'unknown style falls back');
assert.equal(animNorm.periodMode, 'fixed', 'unknown period mode falls back');
assert.equal(animNorm.secs, 30, 'secs capped');
assert.equal(normalizeCrosshair({ id: 'x', anim: { style: 'fractal', periodMode: 'line', secs: 0.01 } }).anim.secs, 0.4, 'secs floor');
for (const a of XH_ANIMS) assert.ok(XH_ANIM_LABELS[a], `label for ${a}`);
assert.ok(XH_ANIMS.length >= 9, 'a rich animation set');

// Period resolution: fixed uses secs; 'line' uses the measured display-line time when present,
// clamps it, and falls back to the fixed secs when unmeasurable (empty pane / editor preview).
assert.equal(animPeriodSecs({ style: 'breathe', periodMode: 'fixed', secs: 2 }), 2);
assert.equal(animPeriodSecs({ style: 'breathe', periodMode: 'fixed', secs: 2 }, 9), 2, 'fixed ignores lineSecs');
assert.equal(animPeriodSecs({ style: 'breathe', periodMode: 'line', secs: 2 }, 7.5), 7.5, 'line mode follows the line');
assert.equal(animPeriodSecs({ style: 'breathe', periodMode: 'line', secs: 2 }, 0.05), 0.4, 'line period floored');
assert.equal(animPeriodSecs({ style: 'breathe', periodMode: 'line', secs: 2 }, null), 2, 'no measurement → fixed secs');
assert.equal(animPeriodSecs({ style: 'breathe', periodMode: 'line', secs: 2 }, NaN), 2, 'NaN measurement → fixed secs');
assert.equal(animPeriodSecs(undefined), 3, 'no anim at all → sane default');

// Backdrop filter string builder.
assert.equal(backdropFilterOf({}), '', 'no fx → empty (no fx disc rendered)');
assert.equal(backdropFilterOf({ blur: 3 }), 'blur(3px)');
assert.equal(backdropFilterOf({ blur: 2, invert: 0.8, contrast: 1.4 }), 'blur(2px) invert(0.8) contrast(1.4)');
assert.equal(backdropFilterOf({ warp: 20 }), '', 'warp without a filter id is silent');
assert.equal(backdropFilterOf({ warp: 20 }, 'xh-w1'), 'url(#xh-w1)', 'warp rides the SVG turbulence filter');
assert.equal(backdropFilterOf({ hueRotate: 90, grayscale: 1 }), 'grayscale(1) hue-rotate(90deg)');

// Placement helpers: fractional coords, clamped, index-targeted.
let pl = placeCrosshair([], 'id1');
pl = placeCrosshair(pl, 'id2');
assert.equal(pl.length, 2);
assert.ok(pl[0].y !== pl[1].y, 'stacked placements offset so they don\'t hide each other');
pl = moveCrosshair(pl, 1, 2, -1);
assert.equal(pl[1].x, 0.98, 'x clamped into the pane');
assert.equal(pl[1].y, 0.02, 'y clamped into the pane');
pl = resizeCrosshair(pl, 0, 9999);
assert.equal(pl[0].size, 400, 'size capped');
pl = removeCrosshair(pl, 0);
assert.equal(pl.length, 1);
assert.equal(pl[0].id, 'id2');

// Starters: unique ids, valid after normalize, at least one uses a distortion.
const starters = starterStable(5);
assert.ok(starters.length >= 4);
assert.equal(new Set(starters.map((s) => s.id)).size, starters.length, 'starter ids unique');
for (const s of starters) {
  const n = normalizeCrosshair(s);
  assert.ok(n.layers.length >= 1, `${s.name} has layers`);
}
assert.ok(starters.some((s) => backdropFilterOf(s.fx, 'w') !== ''), 'a starter shows off the distortion fx');
assert.ok(starters.some((s) => normalizeCrosshair(s).anim.style !== 'none'), 'a starter shows off animation');
assert.ok(starters.some((s) => normalizeCrosshair(s).anim.periodMode === 'line'), 'a starter uses the line-paced period');

console.log('crosshairs: all checks passed');
