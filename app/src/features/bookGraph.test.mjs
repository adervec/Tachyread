import assert from 'node:assert/strict';
import { mapLayout, allEdges, neighbourhood, treeComponents, treeLayout, libraryTree, MAP_R } from './bookGraph.js';

// A library where nobody set a difficulty (the old radial map put them all on one arc).
const books = [];
for (let i = 0; i < 2000; i++) books.push({ id: `b${i}`, title: `Book ${i}`, author: `A${i % 50}`, genre: ['SF', 'History', 'Poetry'][i % 3], subgenre: i % 3 === 0 ? ['Space opera', 'Cyberpunk'][i % 2] : '', recScore: i % 10, ...(i % 7 === 0 ? { completion: true } : {}) });
books.push({ id: 'gone', title: 'Gone', deleted: true });

const L = mapLayout(books);
assert.equal(L.nodes.length, 2000, 'deleted books left out');
assert.ok(L.nodes.every((n) => Math.hypot(n.x, n.y) <= MAP_R + 1));
// No stacking: the closest pair of books is still clearly apart.
const grid = new Map();
let minD = Infinity;
for (const n of L.nodes) {
  const k = `${Math.floor(n.x / 40)},${Math.floor(n.y / 40)}`;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const m of grid.get(`${Math.floor(n.x / 40) + dx},${Math.floor(n.y / 40) + dy}`) || []) minD = Math.min(minD, Math.hypot(n.x - m.x, n.y - m.y));
  }
  (grid.get(k) || grid.set(k, []).get(k)).push(n);
}
assert.ok(minD > 2, `books don't sit on top of each other (closest pair ${minD.toFixed(2)})`);
assert.deepEqual(L.genres.map((g) => g.name).sort(), ['History', 'Poetry', 'SF']);
assert.ok(L.subs.some((s) => s.name === 'Space opera'));
// Wedges are proportional-ish: everything adds up to the circle.
assert.ok(Math.abs(L.genres.reduce((a, g) => a + (g.a1 - g.a0), 0) - 2 * Math.PI) < 0.1);
// Many small genres fold into a shared wedge but keep their own genre name.
const many = Array.from({ length: 40 }, (_, i) => ({ id: `g${i}`, title: `T${i}`, genre: `G${i}` }));
const LM = mapLayout(many, { maxGenres: 10 });
assert.equal(LM.genres.length, 11);
assert.equal(LM.nodes.find((n) => n.id === 'g39').genre, 'G39');
assert.equal(LM.nodes.find((n) => n.id === 'g39').wedge, 'Other genres');

// Edges: AI links + series order.
const lib = [
  { id: 'd1', title: 'Dune', author: 'Herbert', series: 'Dune', seriesNum: 1, genre: 'SF', subgenre: 'Planetary', completion: true },
  { id: 'd2', title: 'Dune Messiah', author: 'Herbert', series: 'Dune', seriesNum: 2, genre: 'SF', subgenre: 'Planetary' },
  { id: 'd3', title: 'Children of Dune', author: 'Herbert', series: 'Dune', seriesNum: 3, genre: 'SF', subgenre: 'Planetary' },
  { id: 'f', title: 'Foundation', author: 'Asimov', genre: 'SF', subgenre: 'Planetary', recScore: 9 },
  { id: 'h', title: 'Hyperion', author: 'Simmons', genre: 'SF', subgenre: 'Space opera' },
  { id: 'x', title: 'Other', author: 'Herbert', genre: 'History' },
];
const E = allEdges(lib, { edges: [['f', 'd1', 'influence'], ['d1', 'nope', 'theme']] });
assert.deepEqual(E.map((e) => `${e.a}>${e.b}:${e.kind}`), ['f>d1:influence', 'd1>d2:series', 'd2>d3:series']);
const N = neighbourhood(lib, E, 'd1');
assert.deepEqual(N.map((n) => `${n.book.id}:${n.rel}`), ['f:link', 'd2:series', 'd3:series', 'x:author', 'h:subgenre']);
assert.equal(N[0].dir, 'in');

// Tech tree: one component (Foundation → Dune → Messiah → Children), laid out in 4 layers.
const C = treeComponents(lib, E);
assert.equal(C.length, 1);
assert.equal(C[0].size, 4);
const T = treeLayout(C[0].ids, E);
assert.deepEqual(T.layers, [['f'], ['d1'], ['d2'], ['d3']]);
// A cycle doesn't hang or lose books.
const cyc = treeLayout(['p', 'q', 'r'], [{ a: 'p', b: 'q', kind: 'prereq' }, { a: 'q', b: 'r', kind: 'prereq' }, { a: 'r', b: 'p', kind: 'prereq' }]);
assert.equal(cyc.layers.flat().length, 3);
// Series-only components are labelled by the series.
assert.equal(treeComponents(lib, allEdges(lib))[0].label, 'Dune (series)');

// Overview counts.
const O = libraryTree(lib);
assert.equal(O.total, 6);
assert.deepEqual(O.genres.map((g) => [g.name, g.count, g.read]), [['SF', 5, 1], ['History', 1, 0]]);
assert.equal(O.genres[0].subs[0].name, 'Planetary');
console.log('bookGraph: all cases pass');
