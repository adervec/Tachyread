// ponytail: fixed yyyy-mm-dd / 24h formatting, locale-independent. Uses local-component timestamps so
// the assertions are timezone-stable (format with the same local getters the code uses).
// Run: node src/features/dateFmt.test.mjs
import assert from 'node:assert';
import { fmtDate, fmtTime, fmtDateTime } from './dateFmt.js';

const ts = new Date(2026, 0, 5, 9, 3, 7).getTime(); // 2026-01-05 09:03:07 LOCAL
assert.equal(fmtDate(ts), '2026-01-05', 'zero-padded date');
assert.equal(fmtTime(ts), '09:03', 'zero-padded 24h time, no seconds by default');
assert.equal(fmtTime(ts, true), '09:03:07', 'seconds when asked');
assert.equal(fmtDateTime(ts), '2026-01-05 09:03', 'combined');
assert.equal(fmtDateTime(ts, true), '2026-01-05 09:03:07', 'combined with seconds');

// padding at single digits + midnight + late times
assert.equal(fmtDate(new Date(2026, 8, 9, 0, 0, 0).getTime()), '2026-09-09', 'month/day padded');
assert.equal(fmtTime(new Date(2026, 0, 1, 0, 0, 0).getTime()), '00:00', 'midnight');
assert.equal(fmtTime(new Date(2026, 0, 1, 23, 59, 0).getTime()), '23:59', '24h late');

// shape holds for an arbitrary Date.now()-style value
assert.match(fmtDateTime(Date.now()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, 'shape is yyyy-mm-dd HH:mm');

console.log('dateFmt: all cases pass');
