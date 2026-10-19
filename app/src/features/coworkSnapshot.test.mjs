import assert from 'node:assert/strict';
import { buildSnapshot } from './coworkSnapshot.js';
import { localDate } from './todaySummary.js';

const now = new Date(2026, 9, 19, 9, 0).getTime(); // local 2026-10-19 09:00
const today = localDate(now), yday = localDate(now - 86400000);
const snap = buildSnapshot({
  now,
  files: [{ checksum: 'c1', fileName: 'dune.epub', totalWords: 1000, persistentWordsRead: 500, persistentPacedWords: 400, persistentActiveTimeSecs: 600, completions: [],
    dailyHistory: [{ date: yday, wordsRead: 300, activeTimeSecs: 60 }, { date: today, wordsRead: 200, activeTimeSecs: 90, aloudWords: 50, aloudSecs: 30 }] }],
  books: [{ id: 'A', title: 'Dune', author: 'Herbert', words: 1000, inProgress: true }, { id: 'B', title: 'Emma', author: 'Austen', words: 2000 }, { id: 'X', title: 'Gone', deleted: true }],
  bindMap: { c1: 'A' },
  queues: [{ id: 'q', name: 'Now', ids: ['A', 'B'] }],
  goals: { [new Date(now).getFullYear()]: 12 },
  typingRuns: [{ ts: now - 3600000, netWpm: 60, grossWpm: 65, accuracy: 97, words: 50, durationMs: 50000, errorKeys: { e: 3 } }],
  speechLog: [{ at: now - 1000, words: 50, q: 90 }],
  manifests: [{ checksum: 'c1', chunks: 10, lines: { 3: { clips: [{ source: 'mic', createdAt: now, durationMs: 5000, quality: { score: 88, accuracy: 95, completeness: 90 } }, { source: 'tts' }] } } }],
});
const J = (f) => JSON.parse(snap[f]);
assert.deepEqual(Object.keys(snap).sort(), ['README.md', 'activity-log.md', 'books.json', 'focus.json', 'goals.json', 'meta.json', 'narration.json', 'queues.json', 'reading-days.json', 'speaking.json', 'typing.json']);
const days = J('reading-days.json');
assert.deepEqual(days.map((d) => [d.date, d.wordsRead]), [[yday, 300], [today, 200]]);
assert.equal(days[1].wpm, 150, '150 silent words in 60 silent seconds — read-aloud excluded');
const books = J('books.json');
assert.equal(books.length, 2, 'deleted books left out');
assert.deepEqual([books[0].status, books[0].queue, books[0].file.percentRead, books[0].file.pacedWords], ['reading', { queue: 'Now', position: 1 }, 50, 400]);
assert.equal(J('queues.json')[0].books, 2);
const g = J('goals.json');
assert.deepEqual([g.streak.days, g.today.words, g.booksGoal.target], [2, 200, 12]);
assert.equal(J('typing.json').topErrorKeys[0][0], 'e');
assert.deepEqual(J('narration.json')[0].recorded.map((r) => r.score), [88]);
assert.match(snap['activity-log.md'], new RegExp(`${today} — 200 words`));
assert.match(snap['README.md'], /read-only/);
assert.ok(!JSON.stringify(snap).includes('fullText'), 'no document text');
console.log('coworkSnapshot: all cases pass');
