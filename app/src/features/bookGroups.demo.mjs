// Self-check for bookGroups.js — run: node app/src/features/bookGroups.demo.mjs
import assert from 'node:assert';
import { makeGroup, masterOf, groupForChecksum, percentOf, matchRating, matchLabel } from './bookGroups.js';

const g = makeGroup('Dune', ['a', 'b', 'a'], 1, 'b');
assert.equal(g.members.length, 2);          // dedup
assert.equal(g.master, 'b');
assert.equal(masterOf(g), 'b');
assert.equal(makeGroup('x', ['a'], 1), null); // needs 2+
assert.equal(groupForChecksum([g], 'a').name, 'Dune');
assert.equal(percentOf({ totalWords: 200, wordIndex: 50 }), 0.25);

// match rating: identical word counts + same name → high; very different → low
const same = matchRating({ totalWords: 100000 }, { totalWords: 100000 }, 'Dune.epub', 'Dune.pdf');
assert.ok(same >= 80, `same-book should be strong, got ${same}`);
assert.equal(matchLabel(same), 'strong');
const diff = matchRating({ totalWords: 100000 }, { totalWords: 20000 }, 'Dune.epub', 'War and Peace.pdf');
assert.ok(diff < same, 'different books rate lower');
assert.ok(matchRating({ totalWords: 0 }, { totalWords: 0 }) >= 0); // no crash on missing counts

console.log('bookGroups.demo: all assertions passed ✅');
