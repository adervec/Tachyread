import assert from 'node:assert/strict';
import { readingStreak, todaySummary } from './todaySummary.js';

const now = Date.parse('2026-10-18T15:00:00Z');
const days = [
  { date: '2026-10-15', wordsRead: 100 }, { date: '2026-10-16', wordsRead: 100 }, { date: '2026-10-17', wordsRead: 100 },
  { date: '2026-10-18', wordsRead: 6000, activeSecs: 1500, aloudWords: 1000, aloudSecs: 500 },
  { date: '2026-10-10', wordsRead: 100 },
];
assert.deepEqual(readingStreak(days, now), { days: 4, readToday: true });
assert.deepEqual(readingStreak(days.filter((d) => d.date !== '2026-10-18'), now), { days: 3, readToday: false }, 'not read yet today: streak still alive');
assert.deepEqual(readingStreak([{ date: '2026-10-15', wordsRead: 5 }], now), { days: 0, readToday: false });

const s = todaySummary({
  dayAgg: days, now,
  fileStats: { a: { fileName: 'a.epub', coverage: 0.5, today: { words: 4000, secs: 900 } }, b: { fileName: 'b.epub', coverage: 0.2, today: { words: 2000, secs: 600 } }, c: { fileName: 'c.epub' } },
  bookOf: (cs) => (cs === 'a' ? { id: 'A', title: 'Alpha' } : null),
  books: [{ id: 'A', finishTime: '2026-10-18' }, { id: 'B', finishTime: '2026-10-01' }],
});
assert.equal(s.words, 6000);
assert.equal(s.wpm, 300, '5000 words in 1000 s of silent reading');
assert.deepEqual(s.files.map((f) => [f.name, f.words, f.book?.title ?? null]), [['a.epub', 4000, 'Alpha'], ['b.epub', 2000, null]]);
assert.deepEqual(s.finished.map((b) => b.id), ['A']);
console.log('todaySummary: all cases pass');
