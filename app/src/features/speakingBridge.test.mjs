// node src/features/speakingBridge.test.mjs — the pure half (file content + name).
import assert from 'node:assert/strict';
import { speakingLog, speakingLogName, SPEAKING_PROTOCOL } from './speakingBridge.js';

const rec = { v: 1, at: Date.UTC(2026, 10, 8, 10, 0, 0), end: Date.UTC(2026, 10, 8, 10, 5, 0), name: 'Dune.epub', words: 620, f: 2, q: 88, voice: { overall: 71, scores: { pace: 80 } }, face: { eyeContact: 90, overall: 80 } };
const log = speakingLog(rec);
assert.equal(log.protocol, SPEAKING_PROTOCOL);
assert.equal(log.version, 1);
assert.equal(log.app, 'tachyread');
assert.equal(log.docName, 'Dune.epub');
assert.equal(log.createdAt, '2026-11-08T10:05:00.000Z', 'stamped at the session end');
assert.equal(log.session, rec, 'the record rides along untouched');
assert.ok(log.fields.voice && log.fields.face && log.fields.m, 'field meanings travel with the file');
assert.equal(speakingLogName(rec), 'tachyread-speaking-2026-11-08T10-00-00-000Z.json');
assert.equal(speakingLog({ at: 5 }).docName, '');
console.log('speakingBridge: all cases pass');
