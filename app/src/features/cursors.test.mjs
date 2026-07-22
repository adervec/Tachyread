// Self-check for the reading-cursor helpers.
// Run: node app/src/features/cursors.test.mjs
import assert from 'node:assert';
import {
  PREMADE_CURSORS, PREMADE_BY_ID, SVG_CURSORS, cursorCss, resolveCursorCss, customCursorId,
  clampCursorSize, CURSOR_MIN_SIZE, CURSOR_MAX_SIZE, DEFAULT_CURSOR_SIZE,
} from './cursors.js';

// ── the premade set ───────────────────────────────────────────────────────────
assert.ok(PREMADE_CURSORS.length >= 15, `a rich set of premades, got ${PREMADE_CURSORS.length}`);
assert.ok(SVG_CURSORS.length >= 10, `plenty of recolourable SVG shapes, got ${SVG_CURSORS.length}`);
assert.ok(new Set(PREMADE_CURSORS.map((c) => c.id)).size === PREMADE_CURSORS.length, 'ids are unique');
assert.ok(PREMADE_CURSORS.every((c) => c.label), 'every cursor has a label');
assert.ok(PREMADE_CURSORS.some((c) => c.native) && PREMADE_CURSORS.some((c) => c.svg), 'both native and SVG kinds');

// ── native passthrough ─────────────────────────────────────────────────────────
assert.equal(cursorCss(PREMADE_BY_ID.pointerHand), 'pointer', 'native keyword passes straight through');
assert.equal(cursorCss(PREMADE_BY_ID.none), 'none', 'hidden cursor');
assert.equal(cursorCss(null), 'auto', 'no def → auto');

// ── SVG → data-URI ──────────────────────────────────────────────────────────────
const dot = cursorCss(PREMADE_BY_ID.dot, { color: '#00ff00', size: 24 });
assert.ok(dot.startsWith('url("data:image/svg+xml,'), `an inline SVG data-URI, got ${dot.slice(0, 30)}`);
assert.ok(dot.endsWith(', auto'), 'ends with the mandatory fallback');
assert.match(dot, /\s\d+\s\d+, auto$/, 'carries an integer hotspot');
// A centred shape's hotspot is the middle; the arrow's is its tip (top-left).
assert.match(cursorCss(PREMADE_BY_ID.dot, { size: 24 }), /"\)\s12\s12, auto$/, 'dot hotspot centred');
assert.match(cursorCss(PREMADE_BY_ID.arrow, { size: 24 }), /"\)\s1\s1, auto$/, 'arrow hotspot at the tip');
// The colour actually lands in the markup (decoded).
assert.ok(decodeURIComponent(dot).includes('#00ff00') || dot.includes('%2300ff00') || dot.includes('#00ff00'), 'the chosen colour is in the SVG');
// No raw characters that break inside url("…") survive (spaces, <, >, quotes) — extract just the
// encoded SVG between the scheme and the closing `")`.
const body = dot.match(/svg\+xml,(.*?)"\)/)[1];
assert.ok(!/[<>\s]/.test(body), 'angle brackets and whitespace are encoded');
assert.ok(!body.includes('"'), 'no double-quotes inside the url()');

// ── size clamping ────────────────────────────────────────────────────────────────
assert.equal(clampCursorSize(5), CURSOR_MIN_SIZE, 'too small → floor');
assert.equal(clampCursorSize(999), CURSOR_MAX_SIZE, 'too big → ceiling');
assert.equal(clampCursorSize('abc'), DEFAULT_CURSOR_SIZE, 'garbage → default');
assert.equal(clampCursorSize(30), 30, 'in range → itself');
// A bigger cursor yields a bigger declared image + hotspot.
assert.match(cursorCss(PREMADE_BY_ID.dot, { size: 40 }), /width='40'/, 'size flows into the SVG width');

// ── resolve (premade id, custom, or fallback) ────────────────────────────────────
assert.equal(resolveCursorCss('default'), '', 'the default id means "don\'t override"');
assert.equal(resolveCursorCss(''), '', 'empty id → no override');
assert.equal(resolveCursorCss('pointerHand'), 'pointer', 'a premade id resolves');
assert.ok(resolveCursorCss('ring').startsWith('url('), 'an SVG premade resolves to a data-URI');
const customs = [{ id: 'mine', base: 'star', color: '#123456', size: 32 }];
const mine = resolveCursorCss('mine', customs);
assert.ok(mine.startsWith('url(') && decodeURIComponent(mine).includes('#123456'), 'a custom cursor resolves with its colour');
assert.match(mine, /width='32'/, 'and its size');
assert.equal(resolveCursorCss('ghost', customs), '', 'an unknown id → no override (never leaves reader blank)');
assert.equal(resolveCursorCss('mine', []), '', 'a custom id with no matching record → no override');

// ── custom ids are stable + collision-safe ───────────────────────────────────────
assert.equal(customCursorId('star', '#ff0000', 24, []), 'star-ff0000-24', 'derived from content, deterministic');
assert.equal(customCursorId('star', '#ff0000', 24, []), customCursorId('star', '#ff0000', 24, []), 'same inputs → same id');
const existing = [{ id: 'star-ff0000-24' }];
assert.equal(customCursorId('star', '#ff0000', 24, existing), 'star-ff0000-24-2', 'collides → suffixed');

console.log('cursors: all assertions passed ✅');
