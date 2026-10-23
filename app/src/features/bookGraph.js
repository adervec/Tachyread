// The library as a map and a graph — data for the Tech Tree tab's four views (Overview sunburst,
// Map, Neighbourhood, Tech tree). Pure; see bookGraph.test.mjs.
//
// Why not the old radial "constellation": genre picked the wedge and DIFFICULTY picked the radius,
// but most books have no difficulty, so every genre collapsed onto one arc of overlapping stars —
// unreadable at thousands of books. Here each genre wedge is sized by its book count, subgenres get
// sub-wedges, and books fill their sub-wedge on an even sunflower spiral, so nothing stacks.
import { readStatus } from './journeyLibrary.js';

export const MAP_R = 1000;            // world units: books sit within this radius
const R_IN = 140;                     // empty hub (cluster labels live on the rim)
const GOLDEN = 0.6180339887;

export function genreHue(g) {
  let h = 0; const s = String(g || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 62%)`;
}

// Typed links (AI knowledge-graph edges + the implicit series order). `dir: true` = A → B.
export const EDGE_KINDS = {
  influence: { color: '#c9a227', label: 'influence', dir: true },
  prereq: { color: '#3a86ff', label: 'prerequisite', dir: true },
  series: { color: '#06d6a0', label: 'series', dir: true },
  'same-author': { color: '#b5651d', label: 'same author' },
  theme: { color: '#7209b7', label: 'shared theme' },
  contrast: { color: '#ef476f', label: 'contrast / rebuttal' },
  responds: { color: '#2a9d8f', label: 'responds to', dir: true },
  similarity: { color: '#4cc9f0', label: 'similar work' },
  opposed: { color: '#d00000', label: 'opposed pair' },
  'same-universe': { color: '#ffb703', label: 'same universe' },
  link: { color: '#8d99ae', label: 'related' },
};
const TREE_KINDS = new Set(['prereq', 'influence', 'series', 'responds']); // the "read before" kinds

const gname = (b) => String(b.genre || '').trim() || 'Uncategorized';
const sname = (b) => String(b.subgenre || '').trim() || '—';
const live = (books) => (books || []).filter((b) => b && !b.deleted);

// Every link: the AI's treeMeta edges plus series order (consecutive seriesNum → 'series').
export function allEdges(books, treeMeta = null) {
  const ids = new Set(live(books).map((b) => b.id));
  const out = [];
  for (const e of treeMeta?.edges || []) {
    const [a, b, kind] = Array.isArray(e) ? e : [e.a, e.b, e.kind];
    if (ids.has(a) && ids.has(b) && a !== b) out.push({ a, b, kind: EDGE_KINDS[kind] ? kind : 'link' });
  }
  const bySeries = {};
  for (const b of live(books)) if (b.series && Number(b.seriesNum) > 0) (bySeries[String(b.series).trim()] ||= []).push(b);
  for (const list of Object.values(bySeries)) {
    list.sort((x, y) => Number(x.seriesNum) - Number(y.seriesNum));
    for (let i = 1; i < list.length; i++) out.push({ a: list[i - 1].id, b: list[i].id, kind: 'series', implicit: true });
  }
  return out;
}

// ── Map layout ───────────────────────────────────────────────────────────────────────────────────
// → { nodes: [{id,x,y,r,genre,subgenre,status,title,author,rec}], genres: [{name,count,read,a0,a1,x,y}],
//     subs: [{genre,name,count,x,y}] }. `maxGenres` biggest genres get their own wedge; the rest share
// "Other genres" (each book keeps its real genre for colour and filters).
export function mapLayout(books, { maxGenres = 24 } = {}) {
  const list = live(books);
  const counts = {};
  for (const b of list) counts[gname(b)] = (counts[gname(b)] || 0) + 1;
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const own = new Set(ranked.slice(0, maxGenres));
  const wedgeOf = (b) => (own.has(gname(b)) ? gname(b) : 'Other genres');
  const groups = {};
  for (const b of list) (groups[wedgeOf(b)] ||= []).push(b);
  const names = Object.keys(groups).sort((a, b) => (a === 'Other genres') - (b === 'Other genres') || groups[b].length - groups[a].length);
  const total = list.length || 1;
  const gap = names.length > 1 ? 0.012 : 0; // radians between wedges
  const usable = 2 * Math.PI - gap * names.length;
  const minW = Math.min(0.06, usable / Math.max(1, names.length)); // tiny genres still get a visible slice
  const extra = usable - minW * names.length;
  const nodes = [], genres = [], subs = [];
  let a = -Math.PI / 2;
  for (const name of names) {
    const gb = groups[name];
    const w = minW + extra * (gb.length / total);
    const a0 = a, a1 = a + w;
    // Subgenre sub-wedges, biggest first; books inside ordered by series, author, title.
    const bySub = {};
    for (const b of gb) (bySub[sname(b)] ||= []).push(b);
    const subNames = Object.keys(bySub).sort((x, y) => bySub[y].length - bySub[x].length || x.localeCompare(y));
    let sa = a0;
    let read = 0;
    for (const sn of subNames) {
      const sb = bySub[sn].sort((x, y) => String(x.series || '').localeCompare(String(y.series || '')) || (Number(x.seriesNum) || 0) - (Number(y.seriesNum) || 0)
        || String(x.author || '').localeCompare(String(y.author || '')) || String(x.title || '').localeCompare(String(y.title || '')));
      const sw = w * (sb.length / gb.length);
      // Sunflower fill of the annular sector: even area per book, so density never piles up.
      const n = sb.length;
      sb.forEach((b, i) => {
        const t = (i + 0.5) / n;
        const rad = Math.sqrt(R_IN * R_IN + t * (MAP_R * MAP_R - R_IN * R_IN));
        const frac = ((i * GOLDEN) % 1) * 0.9 + 0.05;
        const ang = sa + sw * frac;
        const st = readStatus(b);
        if (st === 'finished' || st === 'reading') read++;
        const rec = Number(b.recScore) || 0;
        nodes.push({ id: b.id, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, r: 3 + (rec / 10) * 4, genre: gname(b), wedge: name, subgenre: sn, status: st, title: b.title || '', author: b.author || '', rec });
      });
      const mid = sa + sw / 2, mr = (R_IN + MAP_R) * 0.62;
      if (sn !== '—' && n >= 3) subs.push({ genre: name, name: sn, count: n, x: Math.cos(mid) * mr, y: Math.sin(mid) * mr, a0: sa, a1: sa + sw });
      sa += sw;
    }
    const mid = (a0 + a1) / 2;
    genres.push({ name, count: gb.length, read, a0, a1, x: Math.cos(mid) * (MAP_R + 70), y: Math.sin(mid) * (MAP_R + 70), lx: Math.cos(mid) * (R_IN + 260), ly: Math.sin(mid) * (R_IN + 260) });
    a = a1 + gap;
  }
  return { nodes, genres, subs };
}

// ── Neighbourhood ────────────────────────────────────────────────────────────────────────────────
// The books around one book, strongest ties first: AI links, series neighbours, same author, then the
// best of the same subgenre (read/reading first, then rec score) to fill up to `max`.
// → [{ book, rel: 'link'|'series'|'author'|'subgenre', kind?, dir?: 'in'|'out' }]
export function neighbourhood(books, edges, id, { max = 36 } = {}) {
  const list = live(books);
  const byId = new Map(list.map((b) => [b.id, b]));
  const me = byId.get(id);
  if (!me) return [];
  const out = [], seen = new Set([id]);
  const add = (b, rel, extra = {}) => { if (b && !seen.has(b.id) && out.length < max) { seen.add(b.id); out.push({ book: b, rel, ...extra }); } };
  for (const e of edges) {
    if (e.a === id) add(byId.get(e.b), e.kind === 'series' ? 'series' : 'link', { kind: e.kind, dir: 'out' });
    else if (e.b === id) add(byId.get(e.a), e.kind === 'series' ? 'series' : 'link', { kind: e.kind, dir: 'in' });
  }
  if (me.series) for (const b of list) if (String(b.series || '').trim() === String(me.series).trim()) add(b, 'series', { kind: 'series' });
  const au = String(me.author || '').trim().toLowerCase();
  if (au) for (const b of list) if (String(b.author || '').trim().toLowerCase() === au) add(b, 'author');
  const rank = (b) => (['finished', 'reading'].includes(readStatus(b)) ? 100 : 0) + (Number(b.recScore) || 0);
  const same = list.filter((b) => gname(b) === gname(me) && sname(b) === sname(me) && !seen.has(b.id)).sort((x, y) => rank(y) - rank(x));
  for (const b of same) add(b, 'subgenre');
  if (out.length < max) for (const b of list.filter((x) => gname(x) === gname(me) && !seen.has(x.id)).sort((x, y) => rank(y) - rank(x))) add(b, 'subgenre');
  return out;
}

// ── Tech tree ────────────────────────────────────────────────────────────────────────────────────
// Directed "read before" links (prerequisite, influence, responds-to, series order) form chains and
// trees. components(): each connected group, biggest first. treeLayout(): one group in left-to-right
// layers (longest path; cycles broken), ordered to reduce crossings.
function directed(edges) { return edges.filter((e) => TREE_KINDS.has(e.kind)); }

export function treeComponents(books, edges) {
  const byId = new Map(live(books).map((b) => [b.id, b]));
  const adj = new Map();
  for (const e of directed(edges)) {
    if (!byId.has(e.a) || !byId.has(e.b)) continue;
    (adj.get(e.a) || adj.set(e.a, new Set()).get(e.a)).add(e.b);
    (adj.get(e.b) || adj.set(e.b, new Set()).get(e.b)).add(e.a);
  }
  const seen = new Set(), comps = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ids = [], stack = [start];
    seen.add(start);
    while (stack.length) { const x = stack.pop(); ids.push(x); for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
    const series = [...new Set(ids.map((x) => byId.get(x)?.series).filter(Boolean))];
    const label = series.length === 1 && ids.every((x) => byId.get(x)?.series === series[0]) ? `${series[0]} (series)` : byId.get(ids[0])?.title || ids[0];
    comps.push({ ids, size: ids.length, label });
  }
  return comps.sort((x, y) => y.size - x.size || x.label.localeCompare(y.label));
}

export function treeLayout(ids, edges) {
  const set = new Set(ids);
  const es = directed(edges).filter((e) => set.has(e.a) && set.has(e.b) && e.a !== e.b);
  const out = new Map(ids.map((x) => [x, []]));
  for (const e of es) out.get(e.a).push(e.b);
  // Drop back edges (cycles) with a DFS, then longest-path layering on the resulting DAG.
  const state = new Map(), keep = [];
  const visit = (x) => {
    state.set(x, 1);
    for (const y of out.get(x)) {
      if (state.get(y) === 1) continue; // back edge → ignored
      keep.push([x, y]);
      if (!state.get(y)) visit(y);
    }
    state.set(x, 2);
  };
  for (const x of ids) if (!state.get(x)) visit(x);
  const preds = new Map(ids.map((x) => [x, []]));
  for (const [x, y] of keep) preds.get(y).push(x);
  const layer = new Map();
  const depth = (x, guard = 0) => {
    if (layer.has(x)) return layer.get(x);
    if (guard > ids.length) return 0;
    const d = preds.get(x).length ? 1 + Math.max(...preds.get(x).map((p) => depth(p, guard + 1))) : 0;
    layer.set(x, d);
    return d;
  };
  ids.forEach((x) => depth(x));
  const layers = [];
  for (const x of ids) (layers[layer.get(x)] ||= []).push(x);
  // Two barycentre passes to untangle.
  const posOf = new Map();
  layers.forEach((l) => l.forEach((x, i) => posOf.set(x, i)));
  for (let pass = 0; pass < 2; pass++) {
    for (let li = 1; li < layers.length; li++) {
      const bc = (x) => { const ps = preds.get(x); return ps.length ? ps.reduce((a, p) => a + posOf.get(p), 0) / ps.length : posOf.get(x); };
      layers[li].sort((p, q) => bc(p) - bc(q));
      layers[li].forEach((x, i) => posOf.set(x, i));
    }
  }
  return { layers: layers.filter(Boolean), edges: keep.map(([a, b]) => ({ a, b, kind: es.find((e) => e.a === a && e.b === b)?.kind || 'link' })) };
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────
// Genre → subgenre counts by status for the sunburst. Small genres / subgenres fold into "Other".
export function libraryTree(books, { maxGenres = 24, maxSubs = 14 } = {}) {
  const g = {};
  for (const b of live(books)) {
    const gn = gname(b), sn = sname(b), st = readStatus(b);
    const G = (g[gn] ||= { name: gn, count: 0, read: 0, subs: {} });
    const S = (G.subs[sn] ||= { name: sn, count: 0, read: 0, statuses: {} });
    G.count++; S.count++;
    if (st === 'finished') { G.read++; S.read++; }
    S.statuses[st] = (S.statuses[st] || 0) + 1;
  }
  const fold = (arr, max, label) => {
    if (arr.length <= max) return arr;
    const keep = arr.slice(0, max - 1), rest = arr.slice(max - 1);
    return [...keep, { name: label, count: rest.reduce((a, x) => a + x.count, 0), read: rest.reduce((a, x) => a + x.read, 0), other: rest.map((x) => x.name) }];
  };
  const genres = fold(Object.values(g).sort((x, y) => y.count - x.count), maxGenres, 'Other genres')
    .map((G) => ({ ...G, subs: G.subs ? fold(Object.values(G.subs).sort((x, y) => y.count - x.count), maxSubs, 'Other') : [] }));
  return { total: live(books).length, read: genres.reduce((a, x) => a + x.read, 0), genres };
}
