// node src/features/listenPlayer.test.mjs — the listen-only player's playlist.
import assert from 'node:assert/strict';
import { playlist, bookShare } from './listenPlayer.js';

const m = { books: {
  b: { title: 'Second', order: 1, totalWords: 300, lastLine: 20, chunks: { 20: { startWordIndex: 200, endWordIndex: 299, id: 'x3', text: 'end' }, 10: { startWordIndex: 100, endWordIndex: 199, id: 'x2', text: 'mid' } } },
  a: { title: 'First', order: 0, totalWords: 200, lastLine: 9, chunks: { 0: { startWordIndex: 0, endWordIndex: 99, id: 'a1' }, 9: { startWordIndex: 100, endWordIndex: 199, id: 'a2' } } },
} };
const p = playlist(m, { a: 120, b: 0 });
assert.deepEqual(p.map((e) => `${e.cs}${e.line}`), ['a9', 'b10', 'b20'], 'queue order, heard chunks skipped, lines in numeric order');
assert.deepEqual(p.map((e) => e.last), [true, false, true], 'each book’s last chunk is marked');
assert.equal(p[1].text, 'mid');
assert.deepEqual(playlist(m, { a: 999, b: 999 }), [], 'all heard: nothing left');
assert.deepEqual(playlist(null), []);
assert.equal(bookShare(m.books.a, 100), 0.5);
assert.equal(bookShare({}, 5), 0);
console.log('listenPlayer: all cases pass');
