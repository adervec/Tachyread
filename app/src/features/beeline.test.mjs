import assert from 'node:assert/strict';
import { beelineMix } from './beeline.js';

// One source line wrapping onto two visual lines, 4 words each, box 0..400.
const rects = [0, 100, 200, 300].map((x) => ({ top: 0, left: x, width: 100 }))
  .concat([0, 100, 200, 300].map((x) => ({ top: 20, left: x, width: 100 })));
const m = beelineMix(rects, 0, 400, 0, 80);
assert.deepEqual(m.slice(0, 4).map((x) => x.pct), [10, 30, 50, 70], 'first visual line fades INTO the accent');
assert.deepEqual(m.slice(4).map((x) => x.pct), [70, 50, 30, 10], 'next visual line fades back OUT');
assert.ok(m.every((x) => x.accent === 1), 'phases 0 and 1 share accent 1');
assert.ok(beelineMix(rects.slice(0, 1), 0, 400, 2).every((x) => x.accent === 2), 'phases 2/3 use the second accent');
assert.equal(beelineMix(rects.slice(3, 4), 0, 400, 1, 80)[0].pct, 10, 'odd source line starts on a fade-out');
assert.deepEqual(beelineMix([{ top: 0, left: 0, width: 0 }], 0, 0, 0), [{ accent: 1, pct: 0 }], 'zero-width box is safe');
console.log('beeline: all cases pass');
