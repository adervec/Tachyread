// Self-check for the AI session-review request builder. Run: node src/features/sessionReview.test.mjs
import assert from 'node:assert/strict';
import { sessionsForReview, allSessionIds, sessionIdOf, SESSION_ID, reviewText, appScores } from './sessionReview.js';

const runs = [
  { ts: 1000, netWpm: 60, grossWpm: 64, accuracy: 96.5, grade: 'B', tier: 'fast', errorKeys: { e: 3, t: 1 }, problemWords: ['their'], durationMs: 60000 },
  { ts: 3000, netWpm: 72, accuracy: 98, grade: 'A', durationMs: 60000 },
];
const log = [{ at: 2000, end: 302000, name: 'Emma.epub', words: 400, moves: 50, misses: 2, exact: 380, near: 15, skip: 5, q: 88, voice: { overall: 71 }, face: { overall: 64 }, m: [[0, 80, 90, null, 0]] }];

const s = sessionsForReview(runs, log, {});
assert.deepEqual(s.due.map((d) => d.id), ['typing:3000', 'speech:2000', 'typing:1000'], 'every unreviewed session, newest first');
const t = s.due.find((d) => d.id === 'typing:1000');
assert.deepEqual(t.appScore.grade, 'B', "the app's own score rides along");
assert.deepEqual(t.mostMissedKeys[0], ['e', 3], 'raw detail: most-missed keys');
const sp = s.due.find((d) => d.kind === 'reading-aloud');
assert.equal(sp.minutes, 5);
assert.equal(sp.appScore.matchQuality, 88);
assert.equal(sp.appScore.presentingOverall, 64);
assert.equal(s.recent.typing.length, 2, 'history for trend');

const after = sessionsForReview(runs, log, { 'typing:3000': { grade: 'A-' } });
assert.ok(!after.due.some((d) => d.id === 'typing:3000'), 'a reviewed session is not sent again');
assert.equal(sessionsForReview(runs, log, {}, { max: 1 }).due.length, 1, 'capped');
assert.deepEqual(sessionsForReview(), { due: [], recent: { typing: [], speaking: [] } });

assert.deepEqual([...allSessionIds(runs, log)].sort(), ['speech:2000', 'typing:1000', 'typing:3000']);
assert.equal(sessionIdOf('typing', 5), 'typing:5');
assert.ok(SESSION_ID.test('speech:123') && !SESSION_ID.test('book:x'));
assert.match(reviewText({ summary: 'Solid.', strengths: ['steady'], fixes: ['e key'], next: 'drill e' }), /Solid\.\nStrengths:\n- steady\nFix:\n- e key\nNext: drill e/);
assert.deepEqual(appScores(runs, log), { 'typing:1000': 'B · 60 WPM · 96.5%', 'typing:3000': 'A · 72 WPM · 98%', 'speech:2000': 'match 88 · voice 71 · presenting 64' });
console.log('sessionReview: all cases pass');
