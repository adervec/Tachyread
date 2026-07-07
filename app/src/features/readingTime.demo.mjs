// Self-check for readingTime. Run: node app/src/features/readingTime.demo.mjs
import assert from 'node:assert';
import { AUDIOBOOK_WPM, bookWordCount, audiobookSecs, estimateTotalSecs, fmtDur, daysBetween, readingTimeSummary } from './readingTime.js';

// word count: prefer words, else pages*275
assert.equal(bookWordCount({ words: 90000 }), 90000);
assert.equal(bookWordCount({ pages: 300 }), 82500);
assert.equal(bookWordCount({}), 0);

// audiobook remainder at 1x: 30000 unread words / 150 wpm = 200 min = 12000 s
assert.equal(audiobookSecs(60000, 0.5), Math.round((30000 / AUDIOBOOK_WPM) * 60));
assert.equal(audiobookSecs(60000, 0.5), 12000);
assert.equal(audiobookSecs(60000, 1), 0);   // fully read by eye → no audiobook time
assert.equal(audiobookSecs(60000, 0), Math.round((60000 / AUDIOBOOK_WPM) * 60)); // whole book by audio

// estimate total = eye time + audiobook remainder (only when flagged)
assert.equal(estimateTotalSecs({ readSecs: 3600, words: 60000, audiobookFinish: true, eyeFrac: 0.5 }), 3600 + 12000);
assert.equal(estimateTotalSecs({ readSecs: 3600, words: 60000, audiobookFinish: false, eyeFrac: 0.5 }), 3600);
assert.equal(estimateTotalSecs({}), 0);

// duration formatting
assert.equal(fmtDur(0), '0m');
assert.equal(fmtDur(90), '2m');
assert.equal(fmtDur(3600), '1h 0m');
assert.equal(fmtDur(3661), '1h 1m');

// days between
assert.equal(daysBetween('2024-01-01', '2024-01-11'), 10);
assert.equal(daysBetween('', '2024-01-11'), null);
assert.equal(daysBetween('2024-01-01', 'nope'), null);

// summary composes started + duration + audiobook estimate
const s = readingTimeSummary({ startTime: '2024-01-01', words: 60000, readSecs: 3600, audiobookFinish: true, audiobookEyePct: 50 }, '2024-01-11');
assert.ok(/Started 2024-01-01/.test(s) && /10 days/.test(s) && /audiobook \(1×\)/.test(s) && /total/.test(s), s);
const s2 = readingTimeSummary({ readSecs: 7200 }, null);
assert.ok(/No start date/.test(s2) && /2h 0m reading/.test(s2), s2);

console.log('readingTime.demo: all assertions passed ✅');
