// ponytail: the non-QWERTY bypass must (a) normalize typographic look-alikes to keyboard chars,
// (b) flag purely-decorative tokens to skip, (c) keep real words (incl. accented), (d) mark exotic
// target chars as auto-accept. Run: node src/engine/typingText.test.mjs
import { normalizeTypography, prepToken, isExotic, toKeyboard, transformToken, displayCells, ghostCharsAt } from './typingText.js';
import assert from 'node:assert';

// Typographic look-alikes → what the keyboard types.
assert.equal(normalizeTypography('“don’t—stop…”'), '"don\'t-stop..."', 'quotes/dash/ellipsis normalized');
assert.equal(normalizeTypography('a b'), 'a b', 'nbsp → space');
assert.equal(normalizeTypography('soft­hyphen'), 'softhyphen', 'soft hyphen dropped');

// Pure-decoration tokens are flagged to skip.
for (const t of ['•', '¶', '◇', '·', '· · ·', '—', '“”']) {
  assert.equal(prepToken(t).skip, true, `"${t}" should be skipped`);
}
// Real words (incl. accented and hyphenated) are kept and typeable.
for (const t of ['hello', 'don’t', 'well-made', 'café', '2082', '(a)']) {
  assert.equal(prepToken(t).skip, false, `"${t}" should be kept`);
}
// A word wrapped in decorative marks keeps the word, drops the marks.
assert.equal(prepToken('•First').text, 'First', 'leading bullet stripped');
assert.equal(prepToken('word¶').text, 'word', 'trailing pilcrow stripped');
assert.equal(prepToken('“quote”').text, '"quote"', 'curly quotes normalized, kept');

// Exotic (non-QWERTY) target chars are auto-accepted; plain ASCII isn't "exotic".
assert.equal(isExotic('é'), true, 'accent is exotic');
assert.equal(isExotic('•'), true, 'bullet is exotic');
assert.equal(isExotic('a'), false, 'ascii letter not exotic');
assert.equal(isExotic('-'), false, 'ascii hyphen not exotic');

// toKeyboard: accents transliterate to base ASCII (WYSIWYG); decorative/exotic chars drop.
assert.equal(toKeyboard('café'), 'cafe', 'accent → base letter');
assert.equal(toKeyboard('naïve résumé'), 'naive resume');
assert.equal(toKeyboard('“a—b…”'), '"a-b..."', 'look-alikes normalized');
assert.equal(toKeyboard('•★☃'), '', 'decorative / exotic symbols dropped');

// transformToken: bypass / noSpecial / lowercase, composable — the text shown IS the text to type.
assert.equal(transformToken('Café,', { bypassNonQwerty: true }).text, 'Cafe,', 'bypass strips the accent, keeps punctuation');
assert.equal(transformToken("Don't!", { noSpecial: true }).text, 'Dont', 'no-special drops punctuation');
assert.equal(transformToken('Hello, World!', { lowercase: true }).text, 'hello, world!', 'lowercase');
assert.equal(transformToken('Café,', { bypassNonQwerty: true, noSpecial: true, lowercase: true }).text, 'cafe', 'all three compose');
assert.equal(transformToken('42%', { noSpecial: true }).text, '42', 'symbols stripped, digits kept');
assert.equal(transformToken('•', { noSpecial: true }).skip, true, 'pure decoration still skipped');
assert.equal(prepToken('café').text, 'cafe', 'prepToken (bypass only) transliterates');

// displayCells: aligns the ORIGINAL glyphs with the typed target — capitals "as written" over a
// lowercased target, stripped specials as ghosts (t: null). The non-ghost cells must reproduce the
// transformed text exactly, for any option mix.
function targetOf(cells, text) { return cells.filter((c) => c.t != null).map((c) => text[c.t]).join(''); }
for (const [raw, opts] of [
  ["Don't!", { noSpecial: true }],
  ['Café,', { bypassNonQwerty: true, noSpecial: true }],
  ['“Quote”', { bypassNonQwerty: true }],
  ['well—made…', { bypassNonQwerty: true }],
  ['42%', { noSpecial: true }],
  ['Hello,', {}],
]) {
  const { text } = transformToken(raw, opts);
  const cells = displayCells(raw, opts);
  assert.equal(targetOf(cells, text), text, `cells reproduce the target for "${raw}"`);
  assert.equal(cells.filter((c) => c.t != null).length, text.length, `cell count matches target for "${raw}"`);
}
// Ghosts: the stripped apostrophe and bang show as ghost cells IN PLACE, with original glyphs.
const dc = displayCells("Don't!", { noSpecial: true });
assert.deepEqual(dc.map((c) => (c.t == null ? `[${c.ch}]` : c.ch)), ['D', 'o', 'n', "[']", 't', '[!]'], 'ghosts sit where the specials were');
// The original CAPITAL survives as the display glyph even though the target is lowercased.
const { text: lowText } = transformToken('Don’t', { bypassNonQwerty: true, lowercase: true });
assert.equal(lowText, "don't");
assert.equal(displayCells('Don’t', { bypassNonQwerty: true })[0].ch, 'D', 'display keeps the written capital');
// Expansions ('…' → '...') display the target form per char, indices stay aligned.
const exp = displayCells('a…b', { bypassNonQwerty: true });
assert.deepEqual(exp.map((c) => c.ch), ['a', '.', '.', '.', 'b']);
assert.deepEqual(exp.map((c) => c.t), [0, 1, 2, 3, 4]);
// A fully-decorative token is ALL ghosts under noSpecial (shown dim, typed never).
assert.ok(displayCells('•', { bypassNonQwerty: false, noSpecial: true }).every((c) => c.t == null));

// ghostCharsAt: the stripped punctuation adjacent to each typing position — typed ghosts are
// ACCEPTED, so the input path needs to know which chars are absorbable where.
// "don't" -> target "dont": the apostrophe sits before target index 3.
assert.ok(ghostCharsAt("don't", 3).has("'"), 'mid-word ghost at its boundary');
assert.equal(ghostCharsAt("don't", 1).size, 0, 'no ghost elsewhere');
// Trailing punctuation: "word," -> target "word": ghost waits at pos 4 (end of word).
assert.ok(ghostCharsAt('word,', 4).has(','), 'trailing ghost at word end');
assert.equal(ghostCharsAt('word,', 2).size, 0);
// Leading punctuation: '"word' -> ghost at pos 0.
assert.ok(ghostCharsAt('"word', 0).has('"'), 'leading ghost at position 0');
// Typographic ghosts accept BOTH the original glyph and its keyboard form.
const curly = ghostCharsAt('“word', 0); // curly opening quote
assert.ok(curly.has('"'), 'curly quote ghost accepts the straight keyboard form');
// Consecutive ghosts pool at one boundary ("end.)" -> both . and ) absorbable at pos 3).
const pool = ghostCharsAt('end.)', 3);
assert.ok(pool.has('.') && pool.has(')'), 'consecutive ghosts pool at the boundary');

console.log('ok — transforms compose, accents transliterate, decorative tokens skipped, WYSIWYG, ghosts absorbable');
