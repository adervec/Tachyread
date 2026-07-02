// ponytail: sanity-check the language table — unique codes, well-formed BCP-47 and tesseract
// ids, English first (the fallback), Croatian present. Run: node src/state/languages.test.mjs
import { LANGUAGES, getLanguage } from './languages.js';
import assert from 'node:assert';

assert(LANGUAGES[0].code === 'en', 'English first — getLanguage falls back to LANGUAGES[0]');
assert(LANGUAGES.some((l) => l.code === 'hr'), 'Croatian present');
const codes = new Set(LANGUAGES.map((l) => l.code));
assert(codes.size === LANGUAGES.length, 'no duplicate codes');
for (const l of LANGUAGES) {
  assert(/^[a-z]{2}$/.test(l.code), `${l.code}: two-letter code`);
  assert(/^[a-z]{2}-[A-Z]{2}$/.test(l.bcp), `${l.code}: BCP-47 like xx-XX`);
  assert(/^[a-z_]{3,8}$/.test(l.tess), `${l.code}: tesseract id`);
  assert(l.label && l.label.length > 1, `${l.code}: has a label`);
}
assert(getLanguage('hr').tess === 'hrv', 'lookup works');
assert(getLanguage('nope').code === 'en', 'unknown code falls back to English');
console.log('ok');
