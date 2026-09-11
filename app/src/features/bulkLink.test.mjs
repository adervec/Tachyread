// Self-check for the bulk-link planner: scoring, tiers, defaults, and the books it would create.
// Run: node src/features/bulkLink.test.mjs
import assert from 'node:assert/strict';
import { tokensOf, matchScore, tierOf, planBulkLinks, newBookFor, statusForCoverage } from './bulkLink.js';

// ── tokens: stop words, extension, diacritics, apostrophes ──
assert.deepEqual([...tokensOf("The Keeper's Daughter, Vol. 2.epub")], ['keepers', 'daughter'], 'one-char tokens and stop words dropped');
assert.ok(tokensOf('1984.txt').has('1984'), 'a numeric title survives');
assert.deepEqual([...tokensOf('Émile Zola')], ['emile', 'zola']);

// ── scores ──
const gatsby = { id: 'g', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', words: 47000 };
const lighthouse = { id: 'l', title: 'The Lighthouse', author: 'Virginia Woolf', pages: 200 };
const pride = { id: 'p', title: 'Pride and Prejudice', author: 'Jane Austen' };
assert.equal(matchScore('The Great Gatsby.txt', gatsby), 1, 'exact title');
assert.equal(matchScore('Pride and Prejudice - Jane Austen.epub', pride), 1, 'title + author, author tokens taken out first');
assert.equal(matchScore('Austen - Pride and Prejudice.epub', pride), 1, 'author-first naming');
assert.ok(Math.abs(matchScore('gatsby.txt', gatsby) - 2 / 3) < 1e-9, 'one of two title words');
assert.equal(matchScore("The Lighthouse Keeper's Daughter.txt", lighthouse), 0.5, 'one shared word out of four is NOT a match');
assert.equal(matchScore('quarterly report.txt', gatsby), 0, 'nothing in common');
assert.equal(matchScore('', gatsby), 0);
assert.equal(matchScore('x.txt', { title: '' }), 0);

// ── tiers ──
assert.equal(tierOf(1, 45000, gatsby).tier, 'strong');
assert.equal(tierOf(0.8, 0, gatsby).tier, 'strong', 'unknown file length never blocks');
assert.equal(tierOf(1, 2000, gatsby).tier, 'weak', 'a 2k-word file is not a 47k-word novel');
assert.match(tierOf(1, 2000, gatsby).why, /2,000 words/);
assert.equal(tierOf(1, 300000, gatsby).tier, 'weak', 'nor is a 300k-word one');
assert.equal(tierOf(1, 45000, lighthouse).tier, 'strong', 'pages-only books estimate at 275 words/page (55k)');
assert.equal(tierOf(0.5, 45000, gatsby).tier, 'weak');
assert.equal(tierOf(0.3, 45000, gatsby).tier, 'none');
assert.equal(tierOf(0).tier, 'none');

// ── planning: defaults per tier, best-first, candidate cap ──
const books = [gatsby, lighthouse, pride, { id: 'k', title: 'The Keeper', author: 'X', words: 80000 }];
const rows = planBulkLinks([
  { cs: 'a', fileName: 'The Great Gatsby.txt', words: 47000, coverage: 1 },
  { cs: 'b', fileName: "The Lighthouse Keeper's Daughter.txt", words: 1800, coverage: 0.4 },
  { cs: 'c', fileName: 'gatsby.txt', words: 46000, coverage: 0 },
  { cs: 'd', fileName: 'My Chat Transcript.txt', words: 900, coverage: 0 },
  { cs: 'e', fileName: 'Keeper of the Lighthouse.txt', words: 0, coverage: 0 },
], books);
const byCs = Object.fromEntries(rows.map((r) => [r.cs, r]));
assert.deepEqual(rows.map((r) => r.cs), ['a', 'c', 'e', 'b', 'd'], 'sorted by best score, then title');
assert.equal(byCs.a.tier, 'strong'); assert.equal(byCs.a.target, 'g', 'strong → linked to the book');
assert.equal(byCs.c.tier, 'weak'); assert.equal(byCs.c.target, 'skip', 'weak → left for review, not guessed');
assert.equal(byCs.b.tier, 'weak', 'one shared word with "The Lighthouse" is weak');
assert.equal(byCs.b.target, 'skip');
assert.deepEqual(byCs.b.cands.map((c) => c.book.id), ['l'], 'no stemming: "keepers" is not "The Keeper"');
assert.equal(byCs.d.tier, 'none'); assert.equal(byCs.d.target, 'new:ai-gen', 'stranger → create as AI-generated');
assert.deepEqual(byCs.d.cands, [], 'no candidates below the 0.25 floor');
assert.equal(byCs.e.tier, 'weak'); assert.equal(byCs.e.target, 'skip');
assert.deepEqual(byCs.e.cands.map((c) => c.book.id).sort(), ['k', 'l'], 'both half-matches offered in the dropdown');
assert.ok(byCs.e.cands[0].score >= byCs.e.cands[1].score, 'candidates best-first');
assert.equal(byCs.a.title, 'The Great Gatsby');
assert.deepEqual(planBulkLinks(null, null), []);
assert.equal(planBulkLinks([{ cs: 'z', fileName: 'z.txt' }], [{ id: 'zz', title: 'z' }])[0].tier, 'none', 'one-letter tokens ignored');

// ── the books a row would create ──
assert.equal(statusForCoverage(1), 'finished');
assert.equal(statusForCoverage(0.3), 'reading');
assert.equal(statusForCoverage(0), 'toread');
const ai = newBookFor(byCs.d, 'ai-gen');
assert.equal(ai.title, 'My Chat Transcript'); assert.equal(ai.type, 'ai-gen');
assert.deepEqual(ai.tags, ['ai-gen']); assert.equal(ai.recBy, 'Claude'); assert.equal(ai.words, 900);
assert.equal(ai.completion, false); assert.equal(ai.inProgress, false);
const lng = newBookFor(byCs.b, 'long');
assert.equal(lng.type, 'long'); assert.equal(lng.tags, undefined); assert.equal(lng.recBy, '');
assert.equal(lng.inProgress, true, 'a partly-read file starts as "reading"');
assert.equal(newBookFor(byCs.a, 'short').completion, true, 'a fully-read file starts as "finished"');
assert.ok(ai.id && ai.id.startsWith('bk:'), 'stable derived id');

console.log('bulkLink: all cases pass');
