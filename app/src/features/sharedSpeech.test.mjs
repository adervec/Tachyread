// node src/features/sharedSpeech.test.mjs — the merge, and a flush against a pretend cloud.
import assert from 'node:assert/strict';
import { mergeShared, flushSharedSpeech, shareSpeechLog, SHARED_SPEECH } from './sharedSpeech.js';

const L = (id, at) => ({ id, log: { protocol: 'tachyread-speaking', version: 1, createdAt: at } });
const m = mergeShared({ logs: [L('b', '2026-11-02'), L('a', '2026-11-01')] }, { logs: [L('a', '2026-11-01'), L('c', '2026-11-03')] });
assert.deepEqual(m.logs.map((e) => e.id), ['a', 'b', 'c'], 'one entry per id, oldest first');
assert.equal(m.owner, 'tachyread');
assert.equal(m.updated, '2026-11-03', 'updated is the newest log, so an unchanged file stays unchanged');
assert.deepEqual(mergeShared(m, m), m, 'merging a synced copy changes nothing');
assert.equal(mergeShared({ logs: [{ id: 'x' }, null, { log: {} }] }, null).logs.length, 0, 'malformed entries dropped');

// a pretend cloud with syncDoc's contract: load, merge with the cloud copy, write
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
let file = JSON.stringify({ schema: 1, owner: 'tachyread', logs: [L('phone', '2026-11-01')] });
const cloud = {
  signedIn: () => true,
  read: async (n) => (n === SHARED_SPEECH ? file : null),
  syncDoc: async (n, h) => { const doc = h.merge(await h.load(), JSON.parse(file)); file = JSON.stringify(doc); },
};
const rec = { at: Date.UTC(2026, 10, 5, 9), end: Date.UTC(2026, 10, 5, 9, 5), name: 'Dune.epub', words: 300 };
assert.equal(await flushSharedSpeech({ cloud, getSpeechLog: async () => [rec] }), true);
let ids = JSON.parse(file).logs.map((e) => e.id);
assert.ok(ids.includes('phone') && ids.some((i) => i.startsWith('tachyread-speaking-')), "backfill joins the other device's log, never replaces it");

globalThis.window = { appFont: { cloud } };
shareSpeechLog('tachyread-narration-x.json', { protocol: 'tachyread-narration', version: 1, createdAt: '2026-11-06' });
await new Promise((r) => setTimeout(r, 10));
ids = JSON.parse(file).logs.map((e) => e.id);
assert.ok(ids.includes('tachyread-narration-x.json') && ids.includes('phone'), 'a new session is added, nothing lost');
assert.deepEqual(JSON.parse(mem['tachyread-shared-speech-pending']), [], 'sent logs leave the queue');
console.log('sharedSpeech: ok');
