// Self-check for bookConstellation.js — run: node app/src/features/bookConstellation.demo.mjs
import assert from 'node:assert';
import { constellationLayout } from './bookConstellation.js';

const books = [
  { id: 'a', title: 'A', genre: 'SciFi', difficultyLevel: 1, recScore: 10, completion: true },
  { id: 'b', title: 'B', genre: 'SciFi', difficultyLevel: 5, recScore: 5, inProgress: true },
  { id: 'c', title: 'C', genre: 'History', difficultyLevel: 3, recScore: 8, completion: false },
];

const { nodes, edges, genres } = constellationLayout(books);
assert.equal(nodes.length, 3, 'one node per book');
assert.deepEqual(genres, ['History', 'SciFi']);

const rad = (n) => Math.hypot(n.x, n.y);
const a = nodes.find((n) => n.id === 'a'), b = nodes.find((n) => n.id === 'b');
assert.ok(rad(a) < rad(b), 'harder book sits farther out'); // diff 1 < diff 5
assert.ok(a.r > b.r, 'higher rec = bigger star');           // rec 10 > rec 5
assert.equal(nodes.find((n) => n.id === 'a').status, 'finished');
assert.equal(nodes.find((n) => n.id === 'b').status, 'reading');
assert.ok(nodes.every((n) => Math.abs(n.x) <= 500 && Math.abs(n.y) <= 500), 'within viewBox');

// AI refinement: position override + an edge
const withMeta = constellationLayout(books, { pos: { a: { x: 10, y: 20 } }, edges: [['a', 'c', 'influence']] });
const an = withMeta.nodes.find((n) => n.id === 'a');
assert.equal(an.x, 10); assert.equal(an.y, 20);
assert.equal(withMeta.edges.length, 1);
assert.equal(withMeta.edges[0].kind, 'influence');
assert.equal(withMeta.edges[0].ax, 10);

console.log('bookConstellation.demo: all assertions passed ✅');
