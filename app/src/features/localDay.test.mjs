// Self-check: calendar days are LOCAL days. Pins the zone to São Paulo (UTC−3, no DST) and a clock
// at 22:30 local — the hour a UTC day key already calls "tomorrow". Run: node src/features/localDay.test.mjs
process.env.TZ = 'America/Sao_Paulo'; // set before any Date is made; modules are imported below
import assert from 'node:assert/strict';
const { localDay, parseDay, shiftDay, mondayOf, daysBetween } = await import('./localDay.js');
const { readingStreak } = await import('./todaySummary.js');
const { buildProgress } = await import('./journeyAi.js');
const { finishMs } = await import('./journeyLibrary.js');
const { yearGoal } = await import('./journeyAnalytics.js');

const NOW = new Date(2026, 10, 9, 22, 30).getTime(); // Mon 9 Nov 2026, 22:30 local
assert.equal(new Date(NOW).getTimezoneOffset(), 180, 'the zone pin took effect');
assert.equal(new Date(NOW).toISOString().slice(0, 10), '2026-11-10', 'precondition: UTC already says tomorrow');

assert.equal(localDay(NOW), '2026-11-09', 'the day key is the local evening');
assert.equal(localDay('nope'), '', 'an invalid date is no day');
assert.equal(parseDay('2026-11-09'), new Date(2026, 10, 9).getTime(), 'a bare day is local midnight');
assert.equal(parseDay('2026-11-09T12:00:00Z'), Date.UTC(2026, 10, 9, 12), 'a full ISO string stays as written');
assert.equal(parseDay(123), 123);
assert.ok(Number.isNaN(parseDay('')));
assert.equal(shiftDay('2026-11-30', 1), '2026-12-01');
assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
assert.equal(daysBetween('2026-11-01', '2026-11-09'), 8);
assert.equal(localDay(mondayOf(NOW)), '2026-11-09', 'Monday evening is still in its own week');
assert.equal(localDay(mondayOf(new Date(2026, 10, 15, 23, 59).getTime())), '2026-11-09', 'Sunday night belongs to the week before');

// The streak counts tonight's reading as today, not tomorrow.
const days = [{ date: '2026-11-07', wordsRead: 10 }, { date: '2026-11-08', wordsRead: 10 }, { date: '2026-11-09', wordsRead: 10 }];
assert.deepEqual(readingStreak(days, NOW), { days: 3, readToday: true });
const files = [{ checksum: 'c', dailyHistory: days.map((d) => ({ ...d, activeTimeSecs: 60 })) }];
assert.equal(buildProgress(files, { now: NOW }).currentStreakDays, 3, 'cowork progress streak agrees');
// Read yesterday and the day before, not yet tonight: still a live 2-day streak. A UTC day key thinks
// "today" is the 10th, steps back to the unread 9th and reports 0.
const notTonight = [{ checksum: 'c', dailyHistory: days.slice(0, 2).map((d) => ({ ...d, activeTimeSecs: 60 })) }];
assert.equal(buildProgress(notTonight, { now: NOW }).currentStreakDays, 2, 'streak survives the evening');

// A finish logged as a bare day stays that day, and New Year's Eve evening counts for the old year.
assert.equal(localDay(finishMs({ finishTime: '2026-11-09' })), '2026-11-09');
const nye = new Date(2026, 11, 31, 22, 30).getTime();
assert.equal(yearGoal([{ completion: true, finishTime: '2026-12-31' }], 10, nye).finished, 1, 'counted in 2026, not 2027');

console.log('localDay: all cases pass');
