// Self-check for bookGroups.js — run: node app/src/features/bookGroups.demo.mjs
import assert from 'node:assert';
import { makeGroup, masterOf, groupForChecksum, percentOf, matchRating, matchLabel, groupFiles } from './bookGroups.js';

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

// groupFiles: new group when none holds the files; joins (and unites) existing groups otherwise.
{
  const made = groupFiles([], ['x', 'y'], 'Dune', 'y', 1);
  assert.equal(made.made, true);
  assert.deepEqual([made.group.members, made.group.master, made.group.name], [['x', 'y'], 'y', 'Dune']);
  const g1 = { id: 'g1', name: 'Dune', members: ['x', 'z'], master: 'x' };
  const g2 = { id: 'g2', name: 'Dune 2', members: ['y', 'w'], master: 'y' };
  const joined = groupFiles([g1, g2, { id: 'g3', name: 'Other', members: ['p', 'q'] }], ['x', 'y'], 'Dune', 'y', 2);
  assert.equal(joined.made, false);
  assert.deepEqual(joined.groups.map((g) => g.id), ['g1', 'g3']);
  assert.deepEqual(joined.group.members, ['x', 'z', 'y', 'w']);
  assert.equal(joined.group.master, 'x', 'an existing group keeps its master');
  assert.equal(groupFiles([g1], ['x'], 'D').group, null, 'one file → nothing to group');
}
