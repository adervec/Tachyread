// ponytail: one truth-table check for the compact-layout predicate. Run: node src/state/device.test.mjs
import { compactFor } from './device.js';
import assert from 'node:assert';

assert(compactFor(390, 844, true), 'phone portrait → compact');
assert(compactFor(844, 390, true), 'phone landscape → compact (the bug being fixed)');
assert(!compactFor(1366, 768, false), 'laptop 1366×768 mouse → NOT compact');
assert(compactFor(600, 900, false), 'narrow desktop window → compact');
assert(!compactFor(1920, 1080, false), 'desktop → NOT compact');
console.log('ok');
