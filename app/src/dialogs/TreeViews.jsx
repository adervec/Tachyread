import { useEffect, useMemo, useRef, useState } from 'react';
import { mapLayout, allEdges, neighbourhood, treeComponents, treeLayout, libraryTree, genreHue, EDGE_KINDS, MAP_R } from '../features/bookGraph.js';
import { readStatus, STATUS_LABEL, recommender, pubYear } from '../features/journeyLibrary.js';

// The Tech Tree tab, rebuilt for big libraries (thousands of books). Four views over the same data:
//   Overview      — genre → subgenre sunburst: what the library is made of, and where you've read
//   Map           — every book, drawn on a <canvas> (one draw call, not thousands of DOM nodes);
//                   labels by zoom: genres → subgenres → titles placed without overlap
//   Neighbourhood — one book and the 20–40 books around it (links, series, author, subgenre)
//   Tech tree     — "read before" chains (prerequisite / influence / responds-to / series order)
// Layout/graph logic is pure (features/bookGraph.js). View state is remembered per device.
const KEY = 'tachyread-tree2';
const loadState = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const saveState = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full / blocked */ } };
const STATUS_ALPHA = { finished: 1, reading: 1, queue: 0.8, toread: 0.32, abandoned: 0.22 };
const REL = {
  link: { label: 'linked', color: '#c9a227' }, series: { label: 'series', color: '#06d6a0' },
  author: { label: 'same author', color: '#b5651d' }, subgenre: { label: 'same subgenre', color: '#6c7a96' },
};
const short = (s, n = 28) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));
const BOOK_LINKS = [['isbnUrl', 'Find'], ['goodreadsUrl', 'Goodreads'], ['wikipediaUrl', 'Wikipedia'], ['platformUrl', 'Read']];

export default function TreeViews({ books, ai, onOpenInLibrary }) {
  const saved = useMemo(() => loadState(), []);
  const [view, setView] = useState(saved.view || 'overview');
  const [status, setStatus] = useState(saved.status || 'all');
  const [genre, setGenre] = useState(saved.genre || 'all');
  const [subgenre, setSubgenre] = useState(saved.subgenre || '');
  const [focus, setFocus] = useState(saved.focus || null);
  const [history, setHistory] = useState([]);
  const [cards, setCards] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { saveState({ view, status, genre, subgenre, focus }); }, [view, status, genre, subgenre, focus]);

  const live = useMemo(() => books.filter((b) => !b.deleted), [books]);
  const byId = useMemo(() => new Map(live.map((b) => [b.id, b])), [live]);
  const edges = useMemo(() => allEdges(live, ai?.treeMeta), [live, ai]);
  const genres = useMemo(() => [...new Set(live.map((b) => String(b.genre || '').trim() || 'Uncategorized'))].sort((a, b) => a.localeCompare(b)), [live]);
  const passes = (b) => (status === 'all' || readStatus(b) === status)
    && (genre === 'all' || (String(b.genre || '').trim() || 'Uncategorized') === genre)
    && (!subgenre || (String(b.subgenre || '').trim() || '—') === subgenre);
  const filtered = status !== 'all' || genre !== 'all' || !!subgenre;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return live.filter((b) => `${b.title} ${b.author || ''}`.toLowerCase().includes(t)).slice(0, 8);
  }, [q, live]);

  const goFocus = (id, toView) => {
    if (!byId.has(id)) return;
    if (focus && focus !== id) setHistory((h) => [...h.slice(-19), focus]);
    setFocus(id);
    if (toView) setView(toView);
  };
  const openCard = (id) => setCards((cs) => (cs.includes(id) ? cs : [...cs.slice(-3), id]));

  return (
    <div className="tt">
      <div className="lj-toolbar tt-bar">
        <span className="tt-views" role="tablist" aria-label="Views">
          {[['overview', '☀️ Overview'], ['map', '🗺 Map'], ['hood', '🧭 Neighbourhood'], ['tree', '🌳 Tech tree']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'toggle-on' : ''} onClick={() => setView(k)}>{l}</button>
          ))}
        </span>
        <span className="tt-search">
          <input placeholder="Find a book…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a book"
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { goFocus(matches[0].id, view === 'overview' ? 'map' : null); openCard(matches[0].id); setQ(''); } }} />
          {matches.length > 0 && (
            <span className="tt-results">
              {matches.map((b) => <button key={b.id} onClick={() => { goFocus(b.id, view === 'overview' ? 'map' : null); openCard(b.id); setQ(''); }}><b>{short(b.title, 40)}</b> <em>{b.author}</em></button>)}
            </span>
          )}
        </span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option><option value="finished">Finished</option><option value="reading">Reading</option><option value="queue">On deck</option><option value="toread">To read</option><option value="abandoned">Abandoned</option>
        </select>
        <select value={genre} onChange={(e) => { setGenre(e.target.value); setSubgenre(''); }} aria-label="Genre">
          <option value="all">All genres</option>{genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {subgenre && <button className="toggle-on" onClick={() => setSubgenre('')} title="Clear the subgenre filter">{subgenre} ✕</button>}
        {filtered && <button onClick={() => { setStatus('all'); setGenre('all'); setSubgenre(''); }}>Clear filters</button>}
      </div>

      <div className="tt-body">
        <div className="tt-main">
          {view === 'overview' && <Overview books={live} onDrill={(g, s) => { setGenre(g); setSubgenre(s || ''); setView('map'); }} />}
          {view === 'map' && <MapCanvas books={live} edges={edges} passes={passes} filterKey={`${status}|${genre}|${subgenre}`} focus={focus}
            onPick={(id) => { goFocus(id); openCard(id); }} onOpen={(id) => goFocus(id, 'hood')} />}
          {view === 'hood' && <Hood books={live} byId={byId} edges={edges} focus={focus} canBack={history.length > 0}
            onBack={() => { const h = [...history]; const prev = h.pop(); setHistory(h); if (prev) setFocus(prev); }}
            onFocus={(id) => goFocus(id)} onCard={openCard} onTree={(id) => goFocus(id, 'tree')} />}
          {view === 'tree' && <TechTree books={live} byId={byId} edges={edges} focus={focus} onFocus={(id) => { goFocus(id); openCard(id); }} onHood={(id) => goFocus(id, 'hood')} />}
        </div>
        {cards.length > 0 && (
          <div className="tt-cards">
            {cards.map((id) => byId.get(id) && (
              <BookCard key={id} book={byId.get(id)} edges={edges} byId={byId} onClose={() => setCards((cs) => cs.filter((x) => x !== id))}
                onHood={() => goFocus(id, 'hood')} onTree={() => goFocus(id, 'tree')} onLibrary={() => onOpenInLibrary?.(id)} onCard={openCard} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Book card ────────────────────────────────────────────────────────────────────────────────────
function BookCard({ book: b, edges, byId, onClose, onHood, onTree, onLibrary, onCard }) {
  const st = readStatus(b);
  const links = edges.filter((e) => e.a === b.id || e.b === b.id).slice(0, 8);
  const facts = [b.pages ? `${b.pages} pp` : (b.words ? `${Math.round(b.words / 1000)}k words` : ''), pubYear(b) || '', b.finishTime ? `read ${String(b.finishTime).slice(0, 4)}` : '', recommender(b) !== 'Claude' ? `✦ ${recommender(b)}` : ''].filter(Boolean);
  return (
    <div className="lj-starcard tt-card">
      <button className="close-x" onClick={onClose} aria-label="Close">×</button>
      <b>{b.title}</b><br /><em>{b.author}</em>
      <div className="settings-note">{b.genre || 'Uncategorized'}{b.subgenre ? ` › ${b.subgenre}` : ''}{b.series ? ` · ${b.series}${b.seriesNum ? ` #${b.seriesNum}` : ''}` : ''} · {STATUS_LABEL[st]}{b.recScore ? ` · rec ${b.recScore}` : ''}{b.rating ? ` · ${'★'.repeat(b.rating)}` : ''}</div>
      {facts.length > 0 && <div className="settings-note">{facts.join(' · ')}</div>}
      {b.description && <div className="lj-starcard-desc">{b.description}</div>}
      <div className="tt-card-acts">
        <button onClick={onHood} title="Show the books around this one">🧭 Neighbourhood</button>
        <button onClick={onTree} title="Show its read-before chain">🌳 Tech tree</button>
        <button onClick={onLibrary} title="Open in the Library">↗ Library</button>
      </div>
      <div className="lj-starcard-links">{BOOK_LINKS.map(([k, l]) => (b[k] ? <a key={k} href={b[k]} target="_blank" rel="noreferrer">{l}</a> : null))}</div>
      {links.length > 0 && (
        <div className="lj-starcard-neighbors">
          {links.map((e, i) => { const other = byId.get(e.a === b.id ? e.b : e.a); return other && (
            <button key={i} className="lj-neighbor" onClick={() => onCard(other.id)}>
              <i style={{ background: (EDGE_KINDS[e.kind] || EDGE_KINDS.link).color }} /> <span>{short(other.title, 34)}</span> <em>{(EDGE_KINDS[e.kind] || EDGE_KINDS.link).label}{EDGE_KINDS[e.kind]?.dir ? (e.a === b.id ? ' →' : ' ←') : ''}</em>
            </button>
          ); })}
        </div>
      )}
    </div>
  );
}

// ── Overview: sunburst ───────────────────────────────────────────────────────────────────────────
const arc = (r0, r1, a0, a1) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
};
function Overview({ books, onDrill }) {
  const data = useMemo(() => libraryTree(books), [books]);
  const [zoom, setZoom] = useState(null); // a genre name, or null for the whole library
  const G = zoom ? data.genres.find((g) => g.name === zoom) : null;
  const ring1 = G ? [G] : data.genres;
  const total = G ? G.count : data.total;
  const segs = [];
  let a = -Math.PI / 2;
  for (const g of ring1) {
    const w = (g.count / Math.max(1, total)) * Math.PI * 2;
    segs.push({ g, a0: a, a1: a + w });
    a += w;
  }
  const pct = (x, n) => (n ? Math.round((x / n) * 100) : 0);
  return (
    <div className="tt-overview">
      <svg viewBox="-300 -300 600 600" className="tt-sun" role="img" aria-label="Library by genre and subgenre">
        {segs.map(({ g, a0, a1 }) => {
          let sa = a0;
          return (
            <g key={g.name}>
              <path d={arc(G ? 0 : 80, 170, a0, a1)} fill={genreHue(g.name)} opacity={0.35 + 0.65 * (g.read / Math.max(1, g.count))}
                className="tt-arc" onClick={() => (G ? setZoom(null) : setZoom(g.name))}>
                <title>{`${g.name}: ${g.count} books, ${g.read} finished (${pct(g.read, g.count)}%) — click to ${G ? 'zoom out' : 'zoom in'}`}</title>
              </path>
              {(g.subs || []).map((s) => {
                const w = (a1 - a0) * (s.count / Math.max(1, g.count));
                const p = <path key={s.name} d={arc(176, 280, sa, sa + w)} fill={genreHue(g.name)} opacity={0.25 + 0.75 * (s.read / Math.max(1, s.count))}
                  className="tt-arc" onClick={() => onDrill(g.name === 'Other genres' ? 'all' : g.name, s.name === 'Other' ? '' : s.name)}>
                  <title>{`${g.name} › ${s.name === '—' ? '(no subgenre)' : s.name}: ${s.count} books, ${s.read} finished — click to see them on the map`}</title>
                </path>;
                sa += w;
                return p;
              })}
              {(a1 - a0) > 0.3 && !G && (() => { const m = (a0 + a1) / 2; return <text x={Math.cos(m) * 125} y={Math.sin(m) * 125} className="tt-sun-label" textAnchor="middle" dominantBaseline="middle">{short(g.name, 14)}</text>; })()}
            </g>
          );
        })}
        {G && (() => {
          let sa = -Math.PI / 2;
          return (G.subs || []).map((s) => { const w = (Math.PI * 2) * (s.count / Math.max(1, G.count)); const m = sa + w / 2; sa += w; return w > 0.18 ? <text key={s.name} x={Math.cos(m) * 228} y={Math.sin(m) * 228} className="tt-sun-label" textAnchor="middle" dominantBaseline="middle">{short(s.name === '—' ? '(none)' : s.name, 14)}</text> : null; });
        })()}
        <circle r={G ? 0 : 76} className="tt-sun-hub" onClick={() => setZoom(null)} />
        {!G && <text className="tt-sun-center" textAnchor="middle" y="-6">{data.total.toLocaleString()}</text>}
        {!G && <text className="tt-sun-center-sub" textAnchor="middle" y="16">{pct(data.read, data.total)}% finished</text>}
      </svg>
      <div className="tt-genre-list">
        {G && <button onClick={() => setZoom(null)}>← All genres</button>}
        <table className="lj-cand">
          <thead><tr><th>{G ? 'Subgenre' : 'Genre'}</th><th>Books</th><th>Finished</th><th aria-label="Bar" /></tr></thead>
          <tbody>
            {(G ? G.subs : data.genres).map((x) => (
              <tr key={x.name} onClick={() => (G ? onDrill(G.name === 'Other genres' ? 'all' : G.name, x.name === 'Other' ? '' : x.name) : setZoom(x.name))} className="tt-row">
                <td><i className="tt-dot" style={{ background: genreHue(G ? G.name : x.name) }} /> {x.name === '—' ? '(no subgenre)' : x.name}</td>
                <td>{x.count.toLocaleString()}</td>
                <td>{pct(x.read, x.count)}%</td>
                <td><span className="lj-pbar"><i style={{ width: `${pct(x.read, x.count)}%` }} /></span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="settings-note">Brighter = more of it finished. Click a genre to zoom in; click a subgenre to see its books on the map.</p>
      </div>
    </div>
  );
}

// ── Map (canvas) ─────────────────────────────────────────────────────────────────────────────────
function MapCanvas({ books, edges, passes, filterKey, focus, onPick, onOpen }) {
  const layout = useMemo(() => mapLayout(books), [books]);
  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const visible = useMemo(() => new Set(layout.nodes.filter((n) => passes(bookById.get(n.id))).map((n) => n.id)), [layout, bookById, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = useRef(null), cv = useRef(null);
  const cam = useRef({ x: 0, y: 0, k: 0 }); // k = screen px per world unit (0 → fit on first draw)
  const raf = useRef(0);
  const drag = useRef(null);
  const [hint, setHint] = useState('');
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const fitTo = (nodes, pad = 80) => {
    const c = cv.current; if (!c || !nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const w = c.clientWidth, h = c.clientHeight;
    cam.current = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k: Math.min(6, Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2))) };
  };
  const fitAll = () => { const c = cv.current; if (!c) return; cam.current = { x: 0, y: 0, k: Math.min(c.clientWidth, c.clientHeight) / ((MAP_R + 190) * 2) }; };

  const draw = () => {
    raf.current = 0;
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    if (!cam.current.k) fitAll();
    const { x: cx, y: cy, k } = cam.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0e17'; ctx.fillRect(0, 0, W, H);
    const sx = (x) => (x - cx) * k + W / 2, sy = (y) => (y - cy) * k + H / 2;
    // wedge dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (const g of layout.genres) { ctx.beginPath(); ctx.moveTo(sx(Math.cos(g.a0) * 140), sy(Math.sin(g.a0) * 140)); ctx.lineTo(sx(Math.cos(g.a0) * MAP_R), sy(Math.sin(g.a0) * MAP_R)); ctx.stroke(); }
    // links (both ends visible) — only once zoomed in, except the focus book's, which always show
    const showLinks = k * MAP_R > 450;
    for (const e of edges) {
      const a = nodeById.get(e.a), b = nodeById.get(e.b);
      if (!a || !b || !visible.has(a.id) || !visible.has(b.id)) continue;
      const on = focus && (e.a === focus || e.b === focus);
      if (!on && !showLinks) continue;
      ctx.strokeStyle = (EDGE_KINDS[e.kind] || EDGE_KINDS.link).color;
      ctx.globalAlpha = on ? 0.9 : 0.25; ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // books
    const pr = Math.max(1.4, Math.min(9, 1.4 * k + 0.6));
    for (const n of layout.nodes) {
      if (!visible.has(n.id)) continue;
      const X = sx(n.x), Y = sy(n.y);
      if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue;
      const r = pr * (0.7 + n.r / 10);
      ctx.globalAlpha = STATUS_ALPHA[n.status] ?? 0.4;
      ctx.fillStyle = genreHue(n.genre);
      ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
      if (n.status === 'reading') { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // labels by zoom level, never overlapping (occupancy boxes)
    const boxes = [];
    const fits = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    const label = (text, X, Y, font, color, center = false) => {
      ctx.font = font; const w = ctx.measureText(text).width, h = Number(/(\d+)px/.exec(font)[1]) + 2;
      const x = center ? X - w / 2 : X, y = Y - h / 2;
      if (x > W || y > H || x + w < 0 || y + h < 0 || !fits(x - 2, y - 1, w + 4, h + 2)) return;
      ctx.fillStyle = 'rgba(11,14,23,0.7)'; ctx.fillRect(x - 2, y - 1, w + 4, h + 2);
      ctx.fillStyle = color; ctx.fillText(text, x, y + h - 4);
    };
    if (focus && nodeById.get(focus) && visible.has(focus)) {
      const n = nodeById.get(focus); const X = sx(n.x), Y = sy(n.y);
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, pr * 2.4, 0, Math.PI * 2); ctx.stroke();
      label(n.title, X + pr * 2.6, Y, 'bold 13px sans-serif', '#ffd166');
    }
    // titles of the books on screen, most important first — once zoomed in, or when a filter leaves
    // few enough to read
    const onScreen = layout.nodes.filter((n) => visible.has(n.id)).map((n) => ({ n, X: sx(n.x), Y: sy(n.y) }))
      .filter((o) => o.X > 0 && o.Y > 0 && o.X < W && o.Y < H);
    if (k * MAP_R > 900 || onScreen.length <= 400) {
      onScreen.sort((p, q) => (STATUS_ALPHA[q.n.status] - STATUS_ALPHA[p.n.status]) || q.n.rec - p.n.rec);
      for (const o of onScreen.slice(0, 350)) label(short(o.n.title, 34), o.X + pr + 3, o.Y, '11px sans-serif', 'rgba(230,236,245,0.9)');
    }
    // cluster labels only where something is visible
    const liveWedge = new Set(), liveSub = new Set();
    for (const n of layout.nodes) if (visible.has(n.id)) { liveWedge.add(n.wedge); liveSub.add(`${n.wedge}|${n.subgenre}`); }
    if (k * MAP_R > 450) for (const s of layout.subs) if (liveSub.has(`${s.genre}|${s.name}`)) label(`${s.name} · ${s.count}`, sx(s.x), sy(s.y), 'italic 11px sans-serif', 'rgba(200,210,230,0.75)', true);
    for (const g of layout.genres) if (liveWedge.has(g.name)) label(`${g.name} · ${g.count.toLocaleString()} (${g.read} read)`, sx(g.x), sy(g.y), 'bold 12px sans-serif', genreHue(g.name), true);
  };
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(draw); };

  useEffect(() => {
    const ro = new ResizeObserver(schedule);
    if (wrap.current) ro.observe(wrap.current);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Filters: fit to what's left (all → whole map).
  useEffect(() => {
    if (!cv.current) return;
    if (visible.size === layout.nodes.length) fitAll(); else fitTo(layout.nodes.filter((n) => visible.has(n.id)));
    schedule();
  }, [filterKey, layout]); // eslint-disable-line react-hooks/exhaustive-deps
  // Focus (search / neighbourhood): centre on it, zoomed in enough to read titles.
  useEffect(() => {
    const n = focus && nodeById.get(focus);
    if (n && visible.has(n.id) && cv.current) { cam.current = { x: n.x, y: n.y, k: Math.max(cam.current.k || 0, 2.2) }; }
    schedule();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { schedule(); }); // any re-render (edges/visibility) → redraw

  const toWorld = (e) => {
    const r = cv.current.getBoundingClientRect(); const { x, y, k } = cam.current;
    return { x: (e.clientX - r.left - r.width / 2) / k + x, y: (e.clientY - r.top - r.height / 2) / k + y };
  };
  const hit = (e) => {
    const p = toWorld(e), lim = 9 / cam.current.k;
    let best = null, bd = lim;
    for (const n of layout.nodes) { if (!visible.has(n.id)) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  return (
    <div className="tt-map-wrap" ref={wrap}>
      <canvas ref={cv} className="tt-map"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, cam: { ...cam.current }, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (drag.current) {
            const d = drag.current; const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            cam.current = { ...d.cam, x: d.cam.x - dx / d.cam.k, y: d.cam.y - dy / d.cam.k }; schedule();
          } else { const n = hit(e); setHint(n ? `${n.title}${n.author ? ` — ${n.author}` : ''} · ${n.genre}${n.subgenre !== '—' ? ` › ${n.subgenre}` : ''}` : ''); }
        }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) { const n = hit(e); if (n) onPick(n.id); } }}
        onDoubleClick={(e) => { const n = hit(e); if (n) onOpen(n.id); }}
        onWheel={(e) => {
          const before = toWorld(e); const f = e.deltaY > 0 ? 1 / 1.15 : 1.15;
          const k = Math.max(0.05, Math.min(30, cam.current.k * f));
          const r = cv.current.getBoundingClientRect();
          cam.current = { k, x: before.x - (e.clientX - r.left - r.width / 2) / k, y: before.y - (e.clientY - r.top - r.height / 2) / k };
          schedule();
        }}
      />
      <div className="tt-map-tools">
        <button onClick={() => { cam.current = { ...cam.current, k: cam.current.k * 1.4 }; schedule(); }} aria-label="Zoom in">＋</button>
        <button onClick={() => { cam.current = { ...cam.current, k: cam.current.k / 1.4 }; schedule(); }} aria-label="Zoom out">－</button>
        <button onClick={() => { fitAll(); schedule(); }} title="Whole library">⤢</button>
      </div>
      <div className="tt-map-hint">{hint || `${visible.size.toLocaleString()} books · drag to pan, scroll to zoom · click a book for its card, double-click for its neighbourhood · faint = not read yet, ringed = reading`}</div>
    </div>
  );
}

// ── Neighbourhood ────────────────────────────────────────────────────────────────────────────────
function Hood({ books, byId, edges, focus, canBack, onBack, onFocus, onCard, onTree }) {
  const me = focus && byId.get(focus);
  const around = useMemo(() => (me ? neighbourhood(books, edges, me.id, { max: 36 }) : []), [books, edges, me]);
  if (!me) return <p className="settings-note tt-empty">Pick a book to centre on — use “Find a book…” above, or click one on the map.</p>;
  const inner = around.slice(0, 14), outer = around.slice(14);
  const place = (list, r, off) => list.map((x, i) => ({ ...x, x: Math.cos(off + (i / list.length) * Math.PI * 2) * r, y: Math.sin(off + (i / list.length) * Math.PI * 2) * r }));
  const pts = [...place(inner, 230, -Math.PI / 2), ...place(outer, 390, -Math.PI / 2 + 0.15)];
  const color = (x) => (x.rel === 'link' ? (EDGE_KINDS[x.kind] || EDGE_KINDS.link).color : REL[x.rel].color);
  return (
    <div className="tt-hood">
      <div className="tt-hood-head">
        {canBack && <button onClick={onBack}>← Back</button>}
        <b>{me.title}</b><em>{me.author}</em>
        <span className="lj-spacer" />
        <button onClick={() => onCard(me.id)}>Card</button>
        <button onClick={() => onTree(me.id)}>🌳 Tech tree</button>
      </div>
      <svg viewBox="-520 -470 1040 940" className="tt-hood-svg" role="img" aria-label={`Books around ${me.title}`}>
        {pts.map((p) => <line key={`l-${p.book.id}`} x1="0" y1="0" x2={p.x} y2={p.y} stroke={color(p)} strokeOpacity={p.rel === 'subgenre' ? 0.25 : 0.7} strokeWidth={p.rel === 'subgenre' ? 1 : 2.5} />)}
        {pts.map((p) => {
          const st = readStatus(p.book);
          return (
            <g key={p.book.id} className="tt-hood-node" transform={`translate(${p.x} ${p.y})`} onClick={() => onFocus(p.book.id)}>
              <title>{`${p.book.title} — ${p.book.author || ''} · ${p.rel === 'link' ? (EDGE_KINDS[p.kind] || EDGE_KINDS.link).label + (p.dir === 'in' ? ' (leads here)' : ' (leads on)') : REL[p.rel].label} · ${STATUS_LABEL[st]} — click to centre on it`}</title>
              <circle r={p.rel === 'subgenre' ? 9 : 13} fill={genreHue(p.book.genre || 'Uncategorized')} opacity={STATUS_ALPHA[st] < 0.5 ? 0.55 : 1} stroke={st === 'reading' ? '#fff' : 'none'} strokeWidth="2" />
              <text y={p.rel === 'subgenre' ? 22 : 27} textAnchor="middle" className="tt-hood-label">{short(p.book.title, 24)}</text>
            </g>
          );
        })}
        <circle r="26" fill={genreHue(me.genre || 'Uncategorized')} stroke="#ffd166" strokeWidth="3" />
        <text y="46" textAnchor="middle" className="tt-hood-center">{short(me.title, 36)}</text>
      </svg>
      <div className="lj-edge-legend tt-hood-legend">
        {Object.entries(REL).map(([k, v]) => <span key={k} className="lj-legend-item"><i style={{ background: v.color }} />{v.label}{k === 'link' ? ' (AI link, coloured by kind)' : ''}</span>)}
        <span className="settings-note" style={{ margin: 0 }}>{around.length} books · click one to move there</span>
      </div>
    </div>
  );
}

// ── Tech tree ────────────────────────────────────────────────────────────────────────────────────
const NODE_W = 210, NODE_H = 44, COL = 270, ROW = 58, MAX_NODES = 220;
function TechTree({ books, byId, edges, focus, onFocus, onHood }) {
  const comps = useMemo(() => treeComponents(books, edges), [books, edges]);
  const mine = focus ? comps.find((c) => c.ids.includes(focus)) : null;
  const [pick, setPick] = useState(null);
  const comp = (pick && comps.find((c) => c.ids[0] === pick)) || mine || comps[0] || null;
  const ids = useMemo(() => {
    if (!comp) return [];
    if (comp.size <= MAX_NODES) return comp.ids;
    // Huge web: keep what's within a few steps of the focus book (or the first book).
    const start = comp.ids.includes(focus) ? focus : comp.ids[0];
    const adj = new Map();
    for (const e of edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
    const seen = new Set([start]); let frontier = [start];
    while (frontier.length && seen.size < MAX_NODES) { const next = []; for (const x of frontier) for (const y of adj.get(x) || []) if (!seen.has(y) && comp.ids.includes(y) && seen.size < MAX_NODES) { seen.add(y); next.push(y); } frontier = next; }
    return [...seen];
  }, [comp, focus, edges]);
  const L = useMemo(() => treeLayout(ids, edges), [ids, edges]);
  if (!comps.length) return <p className="settings-note tt-empty">No read-before links yet. Series with numbered volumes appear here automatically; for more, run <b>AI / Cowork → Rebuild knowledge graph</b> (prerequisite / influence / responds-to links).</p>;
  const tallest = Math.max(1, ...L.layers.map((l) => l.length));
  const pos = new Map();
  L.layers.forEach((l, li) => l.forEach((id, i) => pos.set(id, { x: li * COL, y: (i - (l.length - 1) / 2) * ROW + ((tallest - 1) / 2) * ROW })));
  const W = Math.max(1, L.layers.length) * COL, H = tallest * ROW;
  return (
    <div className="tt-tree">
      <div className="tt-tree-head">
        <select value={comp?.ids[0] || ''} onChange={(e) => setPick(e.target.value)} aria-label="Which tree">
          {comps.slice(0, 300).map((c) => <option key={c.ids[0]} value={c.ids[0]}>{short(c.label, 50)} · {c.size} books</option>)}
        </select>
        <span className="settings-note" style={{ margin: 0 }}>{comps.length} trees · read left → right{comp && comp.size > MAX_NODES ? ` · showing the ${MAX_NODES} books nearest your focus of ${comp.size}` : ''}</span>
      </div>
      <div className="tt-tree-scroll">
        <svg width={W + NODE_W} height={H + 20} className="tt-tree-svg">
          <g transform="translate(10 10)">
            {L.edges.map((e, i) => {
              const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) return null;
              const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2, mx = (x1 + x2) / 2;
              return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={(EDGE_KINDS[e.kind] || EDGE_KINDS.link).color} strokeWidth={focus && (e.a === focus || e.b === focus) ? 3 : 1.6} opacity="0.8"><title>{(EDGE_KINDS[e.kind] || EDGE_KINDS.link).label}</title></path>;
            })}
            {ids.map((id) => {
              const p = pos.get(id), b = byId.get(id); if (!p || !b) return null;
              const st = readStatus(b);
              return (
                <g key={id} transform={`translate(${p.x} ${p.y})`} className={`tt-tnode tt-${st}${focus === id ? ' on' : ''}`} onClick={() => onFocus(id)} onDoubleClick={() => onHood(id)}>
                  <title>{`${b.title} — ${b.author || ''} · ${STATUS_LABEL[st]} (click: card · double-click: neighbourhood)`}</title>
                  <rect width={NODE_W} height={NODE_H} rx="8" style={{ stroke: genreHue(b.genre || 'Uncategorized') }} />
                  <text x="10" y="18" className="tt-tnode-title">{short(b.title, 28)}</text>
                  <text x="10" y="34" className="tt-tnode-sub">{short(`${b.author || ''}${b.seriesNum ? ` · #${b.seriesNum}` : ''}`, 32)}</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="lj-edge-legend tt-hood-legend">{['prereq', 'influence', 'responds', 'series'].map((k) => <span key={k} className="lj-legend-item"><i style={{ background: EDGE_KINDS[k].color }} />{EDGE_KINDS[k].label}</span>)}</div>
    </div>
  );
}
