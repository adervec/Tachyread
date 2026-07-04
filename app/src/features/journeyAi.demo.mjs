// Self-check for journeyAi.js — run: node app/src/features/journeyAi.demo.mjs
import assert from 'node:assert';
import { buildDataset, buildDigest, buildApiMessages, parseAiOutput, applyAiOutput, contentHash, getInstruction, LIGHT_INSTRUCTION } from './journeyAi.js';

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

console.log('journeyAi.demo: all assertions passed ✅');
