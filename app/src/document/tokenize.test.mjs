// ponytail: the display/segment tokenizers MUST agree with the reader model's word count, or the
// current-word highlight + source-page map drift (bug: `\s`/`\S+` split ideographic/em spaces the
// reader keeps in-word). Run: node src/document/tokenize.test.mjs
import assert from 'node:assert';
import { readerDocFromText, countWords, WS_RE, WS_SPLIT, isWsRun } from './readerDocument.js';

// countWords must equal the model's actual word count for the same text — including CJK/exotic spaces.
const cases = [
  'a b c',
  'a b　c',       // ideographic space (U+3000) — reader keeps "b　c" as ONE word
  'x y',         // em space — one word
  ' leading nbsp',
  'tabs\tand   spaces',
  '文章 テスト　データ',
  '   ',              // all whitespace
  '',
  'single',
];
for (const t of cases) {
  const doc = readerDocFromText(t, 't');
  assert.equal(countWords(t), doc.words.length, `countWords must match the model for ${JSON.stringify(t)} (got ${countWords(t)} vs ${doc.words.length})`);
}
// the smoking gun: `\S+`/`\s` would count 3 here; the reader (and countWords) count 2.
assert.equal(countWords('a b　c'), 2, 'ideographic space stays in-word → 2 words, not 3');
assert.equal('a b　c'.split(/\s+/).length, 3, '(the OLD \\s split gave 3 — the drift)');

// WS_SPLIT (used by renderWords) tokenizes identically: dropping the captured separators leaves
// exactly the model's words, in order.
for (const t of cases) {
  const doc = readerDocFromText(t, 't');
  const rendered = t.split(WS_SPLIT).filter((tok) => tok !== '' && !isWsRun(tok));
  assert.equal(rendered.length, doc.words.length, `renderWords tokenization matches for ${JSON.stringify(t)}`);
}
assert.ok(WS_RE.test('a b') && WS_RE.test('a b') && !WS_RE.test('a　b'), 'WS_RE is space/tab/NBSP only, not ideographic space');

console.log('tokenize: all cases pass');
