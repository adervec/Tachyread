// ponytail: the non-QWERTY bypass must (a) normalize typographic look-alikes to keyboard chars,
// (b) flag purely-decorative tokens to skip, (c) keep real words (incl. accented), (d) mark exotic
// target chars as auto-accept. Run: node src/engine/typingText.test.mjs
import { normalizeTypography, prepToken, isExotic, toKeyboard, transformToken } from './typingText.js';
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

console.log('ok — transforms compose, accents transliterate, decorative tokens skipped, WYSIWYG');
