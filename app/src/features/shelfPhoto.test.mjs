import assert from 'node:assert/strict';
import { parseShelfReply, shelfBooks } from './shelfPhoto.js';

assert.deepEqual(parseShelfReply('Here you go:\n[{"title":"Dune","author":"Frank Herbert"},{"title":"  Emma ","author":""},{"title":"dune","author":"frank herbert"},{"title":""}]\nHope that helps'),
  [{ title: 'Dune', author: 'Frank Herbert' }, { title: 'Emma', author: '' }], 'array pulled out of prose, trimmed, de-duplicated, blanks dropped');
assert.deepEqual(parseShelfReply('I cannot read any spines.'), []);
assert.deepEqual(parseShelfReply('[not json'), []);
assert.deepEqual(parseShelfReply('{"title":"x"}'), [], 'an object is not a list');
const b = shelfBooks([{ title: 'Dune', author: 'Frank Herbert' }]);
assert.equal(b[0].source, 'shelf-photo');
assert.ok(b[0].id.startsWith('bk:'), 'id derived like any other book');
console.log('shelfPhoto: all cases pass');
