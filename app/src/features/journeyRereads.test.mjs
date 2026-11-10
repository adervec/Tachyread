import assert from 'node:assert/strict';
import { logReread, withRereads, readStatus, finishMs, finishCount } from './journeyLibrary.js';
import { yearGoal, cumulativeFinishes } from './journeyAnalytics.js';

const dune = { id: 'd', title: 'Dune', completion: true, finishTime: '2024-04-02' };
const twice = logReread(dune, '2026-11-20');
assert.equal(finishCount(twice), 2);
const ex = withRereads([twice, { id: 'x', title: 'Other' }]);
assert.equal(ex.length, 3, 'one extra entry per earlier finish');
const past = ex.find((b) => b.reread);
assert.equal(past.id, 'd#r1');
assert.equal(finishMs(past), Date.parse('2024-04-02T00:00:00'));
assert.equal(readStatus(past), 'finished');
assert.equal(withRereads([dune])[0], dune, 'no history → same books');
// each finish counts in its own year
assert.equal(yearGoal(ex, 10, new Date(2024, 11, 31).getTime()).finished, 1);
assert.equal(yearGoal(ex, 10, new Date(2026, 11, 31).getTime()).finished, 1);
assert.equal(yearGoal([twice], 10, new Date(2024, 11, 31).getTime()).finished, 0, 'without expansion the 2024 finish was lost');
assert.equal(cumulativeFinishes(ex).length, 2);
console.log('journeyRereads: all cases pass');
