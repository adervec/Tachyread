// Book constellation / tech-tree layout. Deterministic radial map (like GymTracker's constellation):
// genre picks the wedge (angle), difficulty picks the radius (easy=inner, hard=outer), rec-score picks
// the star size, read-status picks the brightness. Computed live so manually-added books appear at
// once. An AI/cowork pass can override any book's position (treeMeta.pos) and add lineage edges
// (treeMeta.edges) — when absent, the heuristic stands alone. Pure; see bookConstellation.demo.mjs.

import { readStatus } from './journeyLibrary.js';

export const CONSTELLATION_R = 500; // viewBox is roughly -R..R on both axes

export function constellationLayout(books, treeMeta = null) {
  const genres = [...new Set(books.map((b) => b.genre || 'Uncategorized'))].sort((a, b) => a.localeCompare(b));
  const gIndex = Object.fromEntries(genres.map((g, i) => [g, i]));
  const byGenre = {};
  for (const b of books) (byGenre[b.genre || 'Uncategorized'] ||= []).push(b);
  const pos = treeMeta?.pos || {};
  const wedge = (2 * Math.PI) / Math.max(1, genres.length);
  const nodes = [];
  for (const g of genres) {
    // brightest (highest rec) first, so the strongest books sit toward the top of each wedge
    const list = byGenre[g].slice().sort((a, b) => (Number(b.recScore) || 0) - (Number(a.recScore) || 0));
    const base = gIndex[g] * wedge;
    list.forEach((b, i) => {
      const diff = Number(b.difficultyLevel) || 3;
      const rad = 120 + ((diff - 1) / 4) * 340; // 120 (easy) .. 460 (formidable)
      const frac = list.length > 1 ? i / (list.length - 1) : 0.5;
      const ang = base + wedge * (0.15 + 0.7 * frac);
      let x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      if (pos[b.id]) { x = pos[b.id].x; y = pos[b.id].y; }
      const rec = Number(b.recScore) || 0;
      nodes.push({ id: b.id, x, y, r: 2.5 + (rec / 10) * 5.5, genre: g, status: readStatus(b), title: b.title, author: b.author, recScore: rec, difficulty: diff });
    });
  }
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const e of treeMeta?.edges || []) {
    const [a, b, kind] = Array.isArray(e) ? e : [e.a, e.b, e.kind];
    const na = nodeById[a], nb = nodeById[b];
    if (na && nb) edges.push({ a, b, kind: kind || 'link', ax: na.x, ay: na.y, bx: nb.x, by: nb.y });
  }
  return { nodes, edges, genres };
}
