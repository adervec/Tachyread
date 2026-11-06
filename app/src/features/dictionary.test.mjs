import assert from 'node:assert/strict';
import { parseDictionaryApi, glossOf, lookupForm } from './dictionary.js';

const sample = [
  { word: 'sere', phonetic: '/sɪə/', meanings: [
    { partOfSpeech: 'adjective', definitions: [{ definition: 'Dry, withered.', example: 'the sere leaves' }, { definition: 'Worn.' }, { definition: 'Third (dropped).' }] },
    { partOfSpeech: 'noun', definitions: [{ definition: 'A series of ecological communities.' }] },
  ] },
  { word: 'sere', meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'More adjective (over the cap).' }] }, { partOfSpeech: 'verb', definitions: [{ definition: 'To dry.' }] }, { partOfSpeech: 'adverb', definitions: [{ definition: 'Cut by maxSenses.' }] }] },
];
const p = parseDictionaryApi(sample);
assert.equal(p.phonetic, '/sɪə/');
assert.deepEqual(p.senses.map((s) => s.pos), ['adjective', 'noun', 'verb'], 'grouped by part of speech, capped at 3');
assert.equal(p.senses[0].defs.length, 2, 'two definitions per part of speech');
assert.equal(p.senses[0].defs[0].example, 'the sere leaves');
assert.equal(glossOf(p.senses), 'adjective: Dry, withered.; noun: A series of ecological communities.; verb: To dry.');
assert.deepEqual(parseDictionaryApi({ title: 'No Definitions Found' }), { phonetic: '', senses: [] }, 'API error object');
assert.equal(lookupForm('“Arrakis’s,'), 'Arrakis');
assert.equal(lookupForm('mind-killer.'), 'mind-killer');
console.log('dictionary: all cases pass');
