// Self-check for the miscategorised-content scan.
// Run: node app/src/features/journeyRecat.test.mjs
import assert from 'node:assert';
import {
  suggestType, scanMiscategorized, applyRecat, retypeBooks, recatSummary,
  LONG_MIN_WORDS, SHORT_MAX_WORDS, TINY_WORDS,
} from './journeyRecat.js';

const book = (o) => ({ id: o.title || 'x', type: 'long', words: 90000, ...o });

// ── nothing to say about a well-labelled library ────────────────────────────
assert.equal(suggestType(book({ title: 'Moby-Dick', author: 'Herman Melville' })), null, 'a long novel labelled long is fine');
assert.equal(suggestType(book({ title: 'A Story', type: 'short', words: 6000 })), null, 'a short story labelled short is fine');
assert.equal(suggestType(null), null, 'no record → no suggestion');
assert.equal(suggestType(book({ title: 'Gone', deleted: true, words: 10 })), null, 'deleted records are left out');

// ── length disagreements ────────────────────────────────────────────────────
const shortish = suggestType(book({ title: 'The Lottery', words: 5000 }));
assert.equal(shortish.to, 'short', `5k words labelled long → short, got ${shortish?.to}`);
assert.match(shortish.why, /5,000 words/, `the reason quotes the evidence: ${shortish.why}`);
assert.equal(shortish.from, 'long');
const tiny = suggestType(book({ title: 'A Note', words: 400 }));
assert.equal(tiny.to, 'article', '400 words is article territory, not short-form');
const big = suggestType(book({ title: 'Epic', type: 'short', words: 120000 }));
assert.equal(big.to, 'long', 'a 120k-word "short story" is a book');
// The boundaries themselves must not fire — a book right at the threshold is left alone.
assert.equal(suggestType(book({ title: 'Novella', words: LONG_MIN_WORDS })), null, `${LONG_MIN_WORDS} words stays long`);
assert.equal(suggestType(book({ title: 'Borderline', type: 'short', words: SHORT_MAX_WORDS })), null, 'a 15k short stays short');
// No word count = no length opinion. Most imported records have none, and guessing from silence
// would bury the real findings.
assert.equal(suggestType(book({ title: 'Unknown Length', words: 0 })), null, 'no word count → no length suggestion');
assert.equal(suggestType(book({ title: 'Unknown Length 2', words: undefined })), null, 'missing word count → no suggestion');

// ── evidence beats length ───────────────────────────────────────────────────
const ai = suggestType(book({ title: 'Notes', author: 'ChatGPT', words: 900 }));
assert.equal(ai.to, 'ai-gen', `an AI author wins over the length rule, got ${ai.to}`);
assert.match(ai.why, /ChatGPT/, 'and names what it saw');
assert.equal(suggestType(book({ title: 'A chat log with the model', words: 900 })).to, 'ai-gen', 'a transcript title reads as AI');
assert.equal(suggestType(book({ title: 'Why X matters — medium.com', words: 800 })).to, 'article', 'a URL in the title is an article');
assert.equal(suggestType(book({ title: 'Deep Dive', source: 'https://example.com/post', words: 800 })).to, 'article', 'or in the source');
assert.equal(suggestType(book({ title: 'The Rust Reference Manual', words: 60000 })).to, 'reference', 'a manual is reference, whatever its length');
assert.equal(suggestType(book({ title: 'Collected Poems', words: 40000 })).to, 'poetry', 'a poetry collection by title');
assert.equal(suggestType(book({ title: 'Untitled', genre: 'Poetry', words: 40000 })).to, 'poetry', '…or by genre');
// Claude as an AUTHOR is AI-generated; Claude as a recommender is not (the whole seed library is
// Claude's picks — that must not relabel the entire library).
assert.equal(suggestType(book({ title: 'Dune', author: 'Frank Herbert', recBy: 'Claude' })), null, 'a Claude RECOMMENDATION is not AI-generated');

// ── respecting the user ─────────────────────────────────────────────────────
assert.equal(suggestType(book({ title: 'The Lottery', words: 5000, typeLocked: true })), null,
  'a type the user set by hand is never second-guessed');

// ── scan / apply ────────────────────────────────────────────────────────────
const lib = [
  book({ id: 'a', title: 'Moby-Dick', author: 'Herman Melville' }),
  book({ id: 'b', title: 'The Lottery', words: 5000 }),
  book({ id: 'c', title: 'Prompt experiments', author: 'Claude', words: 1200 }),
  book({ id: 'd', title: 'Bash Reference Manual', words: 50000 }),
  book({ id: 'e', title: 'Epic', type: 'short', words: 120000 }),
];
const found = scanMiscategorized(lib);
assert.equal(found.length, 4, `4 of 5 look wrong, got ${found.length}`);
assert.ok(!found.some((s) => s.id === 'a'), 'Moby-Dick is left alone');
assert.equal(found[0].to, 'ai-gen', 'strongest evidence first — AI author leads');
assert.deepEqual(recatSummary(found), { 'ai-gen': 1, reference: 1, short: 1, long: 1 }, JSON.stringify(recatSummary(found)));
// Stable between runs.
assert.deepEqual(scanMiscategorized(lib).map((s) => s.id), found.map((s) => s.id), 'the order is stable');

// Apply only what was ticked.
const picked = found.filter((s) => s.id === 'b' || s.id === 'd');
const updated = applyRecat(lib, picked);
assert.equal(updated.length, 2, 'only the accepted records come back');
assert.equal(updated.find((b) => b.id === 'b').type, 'short');
assert.equal(updated.find((b) => b.id === 'd').type, 'reference');
assert.ok(updated.every((b) => b.typeLocked), 'accepting locks the type');
assert.equal(updated.find((b) => b.id === 'b').title, 'The Lottery', 'the rest of the record is untouched');
// Applying is idempotent: a second scan of the fixed library no longer flags them.
const after = lib.map((b) => updated.find((u) => u.id === b.id) || b);
const second = scanMiscategorized(after);
assert.ok(!second.some((s) => s.id === 'b' || s.id === 'd'), `fixed records stop being flagged, got ${JSON.stringify(second.map((s) => s.id))}`);
assert.equal(applyRecat(lib, []).length, 0, 'accepting nothing changes nothing');

// ── manual bulk retype ──────────────────────────────────────────────────────
const manual = retypeBooks(lib, ['a', 'e'], 'reference');
assert.equal(manual.length, 2);
assert.ok(manual.every((b) => b.type === 'reference' && b.typeLocked), 'a manual retype also locks');
assert.deepEqual(retypeBooks(lib, ['a'], 'not-a-type'), [], 'an unknown type is refused');
assert.deepEqual(retypeBooks(lib, [], 'short'), [], 'no ids → nothing');

console.log(`journeyRecat: all assertions passed ✅ (thresholds ${TINY_WORDS}/${SHORT_MAX_WORDS}/${LONG_MIN_WORDS})`);
