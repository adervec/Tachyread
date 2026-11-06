import assert from 'node:assert/strict';
import { findInText } from './fullTextSearch.js';

const t = 'Fear is the mind-killer.\nFear is the little-death. I will face my FEAR.';
const r = findInText(t, 'fear', { ctx: 8 });
assert.equal(r.count, 3, 'case-insensitive by default');
assert.equal(r.hits.length, 3);
assert.deepEqual(r.hits[0], { pos: 0, before: '', match: 'Fear', after: ' is the …' });
assert.equal(r.hits[1].before, '…killer. ', 'newline collapsed to a space, ellipsis when trimmed');
assert.equal(r.hits[2].match, 'FEAR', 'match keeps the original case');
assert.equal(findInText(t, 'fear', { caseSensitive: true }).count, 0);
assert.equal(findInText(t, 'Fear', { caseSensitive: true }).count, 2);
assert.equal(findInText(t, 'fear', { max: 1 }).hits.length, 1, 'hit cap; count still full');
assert.equal(findInText(t, 'f').count, 0, 'one letter is too short to search');
assert.equal(findInText('', 'fear').count, 0);
assert.equal(findInText('aaaa', 'aa').count, 2, 'non-overlapping');
console.log('fullTextSearch: all cases pass');
