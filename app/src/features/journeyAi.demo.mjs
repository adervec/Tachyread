// Self-check for journeyAi.js — run: node app/src/features/journeyAi.demo.mjs
import assert from 'node:assert';
import { buildDataset, buildDigest, buildProgress, buildApiMessages, parseAiOutput, applyAiOutput, contentHash, getInstruction, LIGHT_INSTRUCTION } from './journeyAi.js';

const books = [
  { id: 'a', title: 'A', author: 'X', genre: 'SciFi', fnf: 'F', difficultyLevel: 3, recScore: 6, completion: true, finishTime: '2024-01-01', rating: 4 },
  { id: 'b', title: 'B', author: 'Y', genre: 'History', fnf: 'NF', difficultyLevel: 4, recScore: 9, completion: false },
  { id: 'c', title: 'C', author: 'Z', genre: 'Fantasy', fnf: 'F', difficultyLevel: 2, recScore: 7, completion: false },
];

// default instruction is light
assert.equal(getInstruction(null).mode, 'light');
assert.equal(getInstruction(null).text, LIGHT_INSTRUCTION);

// dataset: light omits allBooks, heavy includes it
const light = buildDataset(books, { light: true });
assert.ok(!light.allBooks, 'light has no full book list');
assert.equal(light.unreadCandidates.length, 2, 'two unread candidates');
assert.equal(light.recentFinishes.length, 1);
const heavy = buildDataset(books, { light: false });
assert.equal(heavy.allBooks.length, 3, 'heavy carries every book');

// digest embeds the instruction + the schema + ids
const dig = buildDigest(light, getInstruction(null));
assert.ok(dig.includes('Task (light)'));
assert.ok(dig.includes('bookPatches'));
assert.ok(dig.includes('"id": "b"'));

// api messages: system forbids prose, heavy mentions tree caveat
const api = buildApiMessages(light, { mode: 'light', text: LIGHT_INSTRUCTION });
assert.ok(/ONLY a single JSON/.test(api.system));
const apiHeavy = buildApiMessages(heavy, { mode: 'heavy', text: 'rebuild tree' });
assert.ok(/cowork export/.test(apiHeavy.messages[0].content));

// parse: fenced and bare
assert.deepEqual(parseAiOutput('```json\n{"analysis":"ok"}\n```'), { analysis: 'ok' });
assert.deepEqual(parseAiOutput('here you go {"analysis":"ok","x":1} bye'), { analysis: 'ok', x: 1 });

// apply: whitelist — recScore/genre change, title change ignored; ai patch collected
const byId = Object.fromEntries(books.map((b) => [b.id, b]));
const out = { analysis: 'A summary', recommendations: [{ title: 'B', author: 'Y', why: 'strong' }], bookPatches: [{ id: 'a', recScore: 10, title: 'HACKED' }, { id: 'zzz', recScore: 1 }] };
const { bookUpdates, aiPatch } = applyAiOutput(out, byId);
assert.equal(bookUpdates.length, 1, 'only known ids patched');
assert.equal(bookUpdates[0].recScore, 10);
assert.equal(bookUpdates[0].title, 'A', 'title is NOT overwritten by AI');
assert.equal(aiPatch.analysis, 'A summary');
assert.equal(aiPatch.recommendations.length, 1);

// ledger hash stable + differs by content
assert.equal(contentHash('hello'), contentHash('hello'));
assert.notEqual(contentHash('hello'), contentHash('world'));

// buildProgress: day + week rollups, streak, in-flight books — the cowork daily/weekly summary feed
{
  const NOW = Date.parse('2026-07-11T12:00:00Z'); // a Saturday
  const files = [
    { checksum: 'A', fileName: 'Alpha.txt', totalWords: 1000, persistentWordsRead: 400, persistentActiveTimeSecs: 300, dailyHistory: [
      { date: '2026-07-10', wordsRead: 300, activeTimeSecs: 200 },   // Friday
      { date: '2026-07-06', wordsRead: 100, activeTimeSecs: 100 },   // Monday (prior part of week)
    ] },
    { checksum: 'B', fileName: 'Beta.txt', totalWords: 2000, persistentWordsRead: 2000, persistentActiveTimeSecs: 900, dailyHistory: [
      { date: '2026-07-10', wordsRead: 500, activeTimeSecs: 100 },
      { date: '2026-07-11', wordsRead: 200, activeTimeSecs: 60 },    // today
      { date: '2020-01-01', wordsRead: 999, activeTimeSecs: 999 },   // ancient — outside the window
    ] },
  ];
  const p = buildProgress(files, { books: [{ id: 'bk:x', title: 'Alpha (Book)' }], bindMap: { A: 'bk:x' }, days: 35, now: NOW });
  assert.equal(p.days.length, 3, 'three active days in window (ancient one excluded)');
  const fri = p.days.find((d) => d.date === '2026-07-10');
  assert.equal(fri.wordsRead, 800, 'days aggregate across files');
  assert.equal(fri.wpm, Math.round((800 / 300) * 60));
  assert.equal(p.weeks.length, 1, 'Mon 07-06 .. Sat 07-11 all one week');
  assert.equal(p.weeks[0].weekStart, '2026-07-06');
  assert.equal(p.weeks[0].wordsRead, 1100);
  assert.equal(p.weeks[0].daysActive, 3);
  assert.equal(p.currentStreakDays, 2, 'today + yesterday');
  assert.equal(p.activeBooks.length, 2);
  assert.equal(p.activeBooks[0].lastRead, '2026-07-11', 'most recently read first');
  const alpha = p.activeBooks.find((b) => b.fileName === 'Alpha.txt');
  assert.equal(alpha.title, 'Alpha (Book)', 'linked tracker book names the entry');
  assert.equal(alpha.coveragePct, 40);
  // rides into the dataset + the digest calls it out
  const ds = buildDataset([], { light: true, progress: p });
  assert.ok(ds.progress.days.length === 3);
  const digest = buildDigest(ds, getInstruction(null));
  assert.ok(/daily or weekly reading-summary/i.test(digest), 'digest tells the agent the progress data is there');
  assert.ok(digest.includes('"currentStreakDays": 2'));
  const noProg = buildDigest(buildDataset([], { light: true }), getInstruction(null));
  assert.ok(!/reading-summary task/i.test(noProg), 'no note when no progress attached');
}

// aiNotes: categorized notes append to the book, dedupe, unknown types fold to 'other'
{
  const byId = { b1: { id: 'b1', title: 'One', aiNotes: [{ type: 'insight', text: 'old', createdAt: 1 }] } };
  const out = { aiNotes: [
    { bookId: 'b1', type: 'summary', text: 'A tidy summary.' },
    { bookId: 'b1', type: 'section-summary', sectionTitle: 'Ch 2', text: 'Sec two happens.' },
    { bookId: 'b1', type: 'weird-type', text: 'Folded.' },
    { bookId: 'b1', type: 'insight', text: 'old' },       // duplicate text → dropped
    { bookId: 'missing', type: 'insight', text: 'nope' }, // unknown book → ignored
  ] };
  const { bookUpdates } = applyAiOutput(out, byId, 999);
  assert.equal(bookUpdates.length, 1);
  const notes = bookUpdates[0].aiNotes;
  assert.equal(notes.length, 4, 'old + 3 new (dupe dropped)');
  assert.equal(notes[1].type, 'summary');
  assert.equal(notes[2].sectionTitle, 'Ch 2');
  assert.equal(notes[3].type, 'other', 'unknown type folded');
  assert.equal(notes[3].createdAt, 999);
}

// crossNotes + bindings: validated against known books; junk dropped
{
  const byId = { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } };
  const out = {
    crossNotes: [
      { bookIds: ['a', 'b'], type: 'comparison', text: 'A vs B.' },
      { series: 'Saga', type: 'insight', text: 'Across the saga.' },
      { bookIds: ['ghost'], type: 'insight', text: 'No known books, no series.' },
      { bookIds: ['a'], type: 'insight', text: '   ' },
    ],
    bindings: [
      { checksum: 'CS1', bookId: 'a' },
      { checksum: 'CS2', bookId: 'ghost' },
      { bookId: 'b' },
    ],
  };
  const { crossNoteAdds, bindingAdds } = applyAiOutput(out, byId, 5);
  assert.equal(crossNoteAdds.length, 2, 'junk cross notes dropped');
  assert.deepEqual(crossNoteAdds[0].bookIds, ['a', 'b']);
  assert.equal(crossNoteAdds[1].series, 'Saga');
  assert.equal(bindingAdds.length, 1, 'only bindings to known books');
  assert.deepEqual(bindingAdds[0], { checksum: 'CS1', bookId: 'a' });
}

// weeklies: dressed-up weekly summaries validated (week must be a date, text non-empty)
{
  const { weeklyAdds } = applyAiOutput({
    weeklies: [
      { week: '2026-07-06', text: 'A big week of epic fantasy.' },
      { week: 'not-a-date', text: 'dropped' },
      { week: '2026-06-29', text: '   ' },
    ],
  }, {}, 5);
  assert.equal(weeklyAdds.length, 1, 'junk weeklies dropped');
  assert.deepEqual(weeklyAdds[0], { week: '2026-07-06', text: 'A big week of epic fantasy.' });
}

console.log('journeyAi.demo: all assertions passed ✅');
