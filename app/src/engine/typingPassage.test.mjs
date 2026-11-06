// A run ends when its passage runs out, so the passage must outlast the run limit. A fixed 600-word
// lookahead used to end a "1000 words" run at ~500 once punctuation-only tokens were filtered out.
import assert from 'node:assert/strict';
import { buildPassage, passageWordsFor, ngramDrill } from './typingModes.js';

// The whole point: asking for N words must pull ahead more than N, with room for dropped tokens.
for (const limit of [10, 60, 100, 500, 1000, 5000, 9999]) {
  const n = passageWordsFor('words', limit);
  assert.ok(n > limit * 1.5, `words/${limit}: pulled ${n}, too tight against the transform filter`);
}

// Timed runs: enough words that even 300 WPM can't outrun the text, never fewer than the old 600.
assert.ok(passageWordsFor('seconds', 60) >= 600);
assert.ok(passageWordsFor('seconds', 300) >= (300 / 60) * 300, '5 min at 300 WPM must not run dry');
assert.ok(passageWordsFor('seconds', 600) > passageWordsFor('seconds', 300), 'longer run, longer passage');

// Endless has no limit to scale off; it just gets a big buffer.
assert.ok(passageWordsFor('endless', 60) >= 5000);

// Garbage in doesn't produce a zero-length passage.
for (const bad of [0, -5, null, undefined, NaN, 'abc']) assert.ok(passageWordsFor('words', bad) > 0, `limit=${bad}`);

// buildPassage honours the size it is handed, in doc mode and in generated drills.
const doc = Array.from({ length: 4000 }, (_, i) => `w${i}`);
assert.equal(buildPassage('passage', { docWords: doc, startIndex: 0, max: passageWordsFor('words', 1000) }).length,
  passageWordsFor('words', 1000));
assert.equal(buildPassage('commonWords', { max: 1860 }).length, 1860);
// A short document still ends where the document ends — that's a real end, not a truncation bug.
assert.equal(buildPassage('passage', { docWords: doc.slice(0, 40), startIndex: 0, max: 1860 }).length, 40);
assert.equal(buildPassage('passage', { docWords: doc, startIndex: 3990, max: 1860 }).length, 10);

// Regression guard: the old constant is no longer the ceiling for a long run.
assert.ok(buildPassage('passage', { docWords: doc, startIndex: 0, max: passageWordsFor('words', 1000) }).length > 600);

console.log('typingPassage: all cases pass');

// Gibberish + numbers drills: every token keeps a letter/digit (symbol-only tokens get dropped by
// the run's transform), and gibberish really mixes case, digits and symbols.
{
  const g = buildPassage('gibberish', { max: 400, seed: 3 });
  assert.equal(g.length, 400);
  assert.ok(g.every((w) => /[\p{L}\p{N}]/u.test(w)), 'gibberish token without anything typeable');
  const all = g.join('');
  assert.ok(/[a-z]/.test(all) && /[A-Z]/.test(all) && /\d/.test(all) && /[^\w]/.test(all), 'gibberish should mix case, digits and symbols');
  const n = buildPassage('numbers', { max: 200, seed: 1 });
  assert.ok(n.every((w) => /\d/.test(w)), 'numbers token without a digit');
  assert.ok(/[!@#$%^&*()]/.test(n.join('')), 'numbers drill should include shifted symbols');
}

// n-gram drills: each pattern three times in a row, every pattern before any repeats, seed varies order
{
  const d = ngramDrill(['th', 'he', 'in'], 9, 0);
  assert.equal(d.length, 9);
  for (let i = 0; i < 9; i += 3) assert.ok(d[i] === d[i + 1] && d[i] === d[i + 2], 'triplets');
  assert.deepEqual([...new Set(d)].sort(), ['he', 'in', 'th']);
  assert.equal(ngramDrill(['ab'], 4, 0).join(' '), 'ab ab ab ab', 'wraps into another round');
  const tri = buildPassage('trigrams', { max: 30, seed: 2 });
  assert.equal(tri.length, 30);
  assert.ok(tri.every((t) => t.length === 3));
  assert.ok(buildPassage('bigrams', { max: 12 }).every((t) => t.length === 2));
}

// weak-spot passage
{
  const { weakspotPassage } = await import('./typingModes.js');
  const p = weakspotPassage({ keys: ['q'], words: ['rhythm'] }, 40, 1);
  assert.equal(p.length, 40);
  assert.ok(p.includes('rhythm'));
  assert.ok(p.filter((w) => w !== 'rhythm').every((w) => w.includes('q')), 'everything else drills the weak key');
  assert.equal(weakspotPassage(null, 20).length, 20, 'no history → common words');
  const fromBook = weakspotPassage({ keys: ['q'], words: [] }, 30, 0, ['The', 'Queen’s', 'quiet', 'garden.', 'quiet']);
  assert.ok(fromBook.includes('quiet') && fromBook.every((w) => w.includes('q')), 'book words on the weak key, cleaned + deduped');
  assert.equal(buildPassage('weakspot', { max: 10, weak: { keys: [], words: ['abc'] } }).filter((w) => w === 'abc').length > 0, true);
}
