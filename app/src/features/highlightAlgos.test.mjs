// Self-check: highlight algorithms (word classification + sentence-boundary detection).
// Run: node src/features/highlightAlgos.test.mjs
import assert from 'node:assert/strict';
import { HIGHLIGHT_ALGOS, HIGHLIGHT_STYLES, highlightAlgoById, hlWordClass, endsSentence } from './highlightAlgos.js';

// Catalog sanity: unique ids, every algorithm ships its research rationale.
const ids = HIGHLIGHT_ALGOS.map((a) => a.id);
assert.equal(new Set(ids).size, ids.length);
assert.ok(HIGHLIGHT_ALGOS.every((a) => a.id === 'off' || a.desc.length > 30), 'each algorithm explains its science');
assert.ok(HIGHLIGHT_STYLES.length >= 4);
assert.equal(highlightAlgoById('nope').id, 'off', 'unknown id falls back to off');

// off / empty → nothing.
assert.equal(hlWordClass('anything', 'off'), null);
assert.equal(hlWordClass('word', null), null);
assert.equal(hlWordClass('...', 'content'), null, 'pure punctuation earns nothing');

// content: function words fade, content words don't; punctuation and case don't confuse it.
assert.equal(hlWordClass('the', 'content'), 'hl-fade');
assert.equal(hlWordClass('The', 'content'), 'hl-fade');
assert.equal(hlWordClass('"and,"', 'content'), 'hl-fade');
assert.equal(hlWordClass('reading', 'content'), null);
assert.equal(hlWordClass('dragon', 'content'), null);

// long: 9+ letters after stripping punctuation.
assert.equal(hlWordClass('important', 'long'), 'hl-mark');
assert.equal(hlWordClass('word', 'long'), null);
assert.equal(hlWordClass('“wonderful”', 'long'), 'hl-mark');

// rare: uncommon and 7+ letters; common/function words never flag regardless of length.
assert.equal(hlWordClass('serendipity', 'rare'), 'hl-mark');
assert.equal(hlWordClass('quixotic', 'rare'), 'hl-mark');
assert.equal(hlWordClass('important', 'rare'), null, 'common word list wins');
assert.equal(hlWordClass('between', 'rare'), null, 'function word never rare');
assert.equal(hlWordClass('cat', 'rare'), null, 'short words never rare');

// sentence: only the flagged first word marks.
assert.equal(hlWordClass('Hello', 'sentence', { sentenceStart: true }), 'hl-mark');
assert.equal(hlWordClass('Hello', 'sentence', { sentenceStart: false }), null);

// endsSentence: terminators with trailing quotes/brackets; commas and bare words don't.
assert.ok(endsSentence('It was done.'));
assert.ok(endsSentence('Really?!'));
assert.ok(endsSentence('he said."'));
assert.ok(endsSentence('(done.)'));
assert.ok(endsSentence('wait…'));
assert.ok(!endsSentence('however,'));
assert.ok(!endsSentence('plain words'));
assert.ok(!endsSentence(''));

console.log('highlightAlgos: all checks passed');
