// Reader Archetypes — the reading analogue of GymTracker's fitness archetypes. A reader's taste is a
// vector over a handful of axes (tallied from their finished books); the archetype is the nearest of a
// fixed set of hand-authored reference vectors by cosine similarity. Everything here is PURE, so the
// Archetype view can reconstruct the trend backwards over any moving window by re-running readerProfile
// on each historical slice. See readerArchetype.demo.mjs.

import { finishMs, pubYear, readStatus } from './journeyLibrary.js';

export const AXES = ['fiction', 'nonfiction', 'literary', 'genreFiction', 'ideas', 'contemporary', 'challenge', 'volume', 'speculative', 'factual', 'poetic', 'series'];
export const MIN_BOOKS = 3; // below this we don't claim an archetype

// Human labels for the axes — used by the Archetype legend so the vectors read as English.
export const AXIS_LABELS = {
  fiction: 'Fiction', nonfiction: 'Non-fiction', literary: 'Literary', genreFiction: 'Genre fiction',
  ideas: 'Ideas & knowledge', contemporary: 'Contemporary', challenge: 'Challenging', volume: 'Long / tomes',
  speculative: 'Speculative (SFF)', factual: 'Factual (history/science)', poetic: 'Poetry & drama', series: 'Series',
};

const LITERARY_GENRES = /liter|classic|poet|drama|modernis/i;
const GENRE_FICTION = /sci-?fi|science fiction|fantasy|myster|thriller|romance|horror|crime|detective|adventure|western|dystop/i;
const IDEAS_GENRES = /philosoph|science|history|histor|econom|politic|psycholog|religion|essay|biograph|memoir|nature|math/i;
const SPECULATIVE = /sci-?fi|science fiction|fantasy|horror|dystop|speculative|weird|space opera/i;
const FACTUAL = /histor|science|biograph|memoir|nature|econom|geograph|technolog|politic|journalis/i;
const POETIC = /poet|verse|drama|\bplay\b|sonnet/i;

// One book → a 0/1 indicator per axis. Non-exclusive on purpose (a book can be several things).
export function bookVector(b) {
  const fic = b.fnf === 'F' ? 1 : 0;
  const nf = b.fnf === 'NF' ? 1 : 0;
  const g = String(b.genre || '') + ' ' + String(b.subgenre || '');
  const diff = Number(b.difficultyLevel) || 0;
  const yr = pubYear(b);
  const words = Number(b.words) || 0, pages = Number(b.pages) || 0;
  const inSeries = (b.series && String(b.series).trim()) || b.seriesNum ? 1 : 0;
  return [
    fic,
    nf,
    (LITERARY_GENRES.test(g) || (fic && diff >= 4)) ? 1 : 0,           // literary
    GENRE_FICTION.test(g) ? 1 : 0,                                     // genreFiction
    (nf && IDEAS_GENRES.test(g)) ? 1 : 0,                             // ideas / knowledge
    (yr != null && yr >= 1980) ? 1 : 0,                               // contemporary
    diff >= 4 ? 1 : 0,                                                // challenge
    (pages >= 500 || words >= 150000) ? 1 : 0,                        // volume / tome
    SPECULATIVE.test(g) ? 1 : 0,                                      // speculative (SFF)
    (nf && FACTUAL.test(g)) ? 1 : 0,                                 // factual (history/science)
    POETIC.test(g) ? 1 : 0,                                           // poetry & drama
    inSeries,                                                         // part of a series
  ];
}

// axis order: [fiction, nonfiction, literary, genreFiction, ideas, contemporary, challenge, volume,
//              speculative, factual, poetic, series]
export const READER_ARCHETYPES = [
  { id: 'classicist', name: 'The Classicist', blurb: 'Old, difficult, literary fiction — the canon.', vector: [0.9, 0.1, 1.0, 0.1, 0.1, 0.05, 0.8, 0.7, 0.1, 0.1, 0.5, 0.1] },
  { id: 'aesthete', name: 'The Literary Aesthete', blurb: 'Literary fiction for the prose, any era.', vector: [0.9, 0.1, 1.0, 0.05, 0.2, 0.4, 0.7, 0.5, 0.1, 0.1, 0.6, 0.1] },
  { id: 'poet', name: 'The Poet', blurb: 'Poetry, verse and drama above all.', vector: [0.7, 0.3, 0.9, 0.1, 0.3, 0.4, 0.6, 0.2, 0.1, 0.1, 1.0, 0.1] },
  { id: 'genre-devotee', name: 'The Genre Devotee', blurb: 'SFF, mystery, thriller — story-first fiction.', vector: [1.0, 0.0, 0.1, 1.0, 0.0, 0.7, 0.2, 0.4, 0.8, 0.0, 0.0, 0.5] },
  { id: 'worldbuilder', name: 'The Worldbuilder', blurb: 'Epic speculative fiction — big SFF worlds and series.', vector: [1.0, 0.0, 0.4, 1.0, 0.0, 0.7, 0.5, 0.9, 1.0, 0.0, 0.1, 0.9] },
  { id: 'series-binger', name: 'The Series Binger', blurb: 'Long genre series, read run by run.', vector: [0.9, 0.1, 0.2, 0.9, 0.1, 0.7, 0.2, 0.7, 0.7, 0.0, 0.0, 1.0] },
  { id: 'storyteller', name: 'The Storyteller', blurb: 'Broadly-read fiction across genres.', vector: [1.0, 0.05, 0.5, 0.5, 0.1, 0.5, 0.4, 0.5, 0.4, 0.1, 0.2, 0.4] },
  { id: 'autodidact', name: 'The Autodidact', blurb: 'Non-fiction to learn — ideas and knowledge.', vector: [0.1, 1.0, 0.2, 0.0, 1.0, 0.5, 0.6, 0.5, 0.0, 0.8, 0.05, 0.1] },
  { id: 'historian', name: 'The Historian', blurb: 'History, biography and the factual record.', vector: [0.1, 1.0, 0.3, 0.0, 1.0, 0.3, 0.6, 0.7, 0.0, 1.0, 0.05, 0.2] },
  { id: 'scholar', name: 'The Scholar', blurb: 'Dense, weighty non-fiction and ideas.', vector: [0.05, 1.0, 0.3, 0.0, 1.0, 0.3, 0.9, 0.8, 0.0, 0.7, 0.1, 0.2] },
  { id: 'deep-diver', name: 'The Deep Diver', blurb: 'The hardest, longest books, fiction or not.', vector: [0.5, 0.5, 0.8, 0.1, 0.6, 0.2, 1.0, 1.0, 0.3, 0.5, 0.3, 0.3] },
  { id: 'contemporary', name: 'The Contemporary', blurb: 'What’s recent and talked-about, mixed.', vector: [0.6, 0.4, 0.3, 0.5, 0.3, 1.0, 0.3, 0.4, 0.4, 0.3, 0.1, 0.3] },
  { id: 'voracious', name: 'The Voracious', blurb: 'High volume, broad, keeps turning pages.', vector: [0.6, 0.4, 0.4, 0.5, 0.4, 0.6, 0.4, 0.9, 0.4, 0.4, 0.1, 0.6] },
  { id: 'completionist', name: 'The Completionist', blurb: 'Series and long genre runs, start to finish.', vector: [0.8, 0.2, 0.2, 0.8, 0.1, 0.6, 0.3, 0.8, 0.6, 0.1, 0.0, 1.0] },
  { id: 'eclectic', name: 'The Eclectic', blurb: 'Balanced across every kind of book.', vector: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] },
  { id: 'explorer', name: 'The Casual Explorer', blurb: 'Lighter, recent, wide-ranging reads.', vector: [0.6, 0.4, 0.1, 0.5, 0.2, 0.8, 0.05, 0.1, 0.4, 0.3, 0.1, 0.2] },
];

// The defining axes of an archetype (highest-weighted) — powers the legend. Pure.
export function archetypeAxes(archetype, n = 3, floor = 0.5) {
  return AXES.map((ax, i) => ({ ax, label: AXIS_LABELS[ax], weight: archetype.vector[i] }))
    .filter((x) => x.weight >= floor)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Normalized taste vector from a set of books (fraction of books hitting each axis).
export function readerProfile(books) {
  const axes = AXES.map(() => 0);
  let n = 0;
  for (const b of books) { const v = bookVector(b); for (let i = 0; i < axes.length; i++) axes[i] += v[i]; n++; }
  return { vector: n ? axes.map((x) => x / n) : axes, count: n };
}

export function matchArchetype(profile) {
  if (!profile || profile.count < MIN_BOOKS) return { archetype: null, count: profile?.count || 0, vector: profile?.vector || AXES.map(() => 0) };
  const scored = READER_ARCHETYPES.map((a) => ({ a, sim: cosine(profile.vector, a.vector) })).sort((x, y) => y.sim - x.sim);
  const secondary = scored[1] && scored[1].sim > 0.55 ? scored[1] : null;
  return { archetype: scored[0].a, sim: scored[0].sim, secondary: secondary?.a || null, secondarySim: secondary?.sim || 0, count: profile.count, vector: profile.vector };
}

// Convenience: the archetype from a book list (finished ones only).
export function currentArchetype(books) {
  return matchArchetype(readerProfile(books.filter((b) => readStatus(b) === 'finished')));
}

// Backward reconstruction: step ~monthly from the first finish to now; at each point the archetype is
// computed from the finished books inside a trailing `windowDays` window. Pure, so the UI recomputes
// the whole series instantly when the window slider moves. `now` is injectable for deterministic tests.
export function archetypeTrend(books, windowDays = 365, now = Date.now()) {
  const finished = books.map((b) => ({ b, t: finishMs(b) })).filter((x) => x.t != null).sort((a, b) => a.t - b.t);
  if (!finished.length) return [];
  const stepMs = 30 * 864e5, winMs = windowDays * 864e5, start = finished[0].t;
  const out = [];
  for (let t = start; ; t += stepMs) {
    const tt = Math.min(t, now);
    const win = finished.filter((x) => x.t <= tt && x.t > tt - winMs).map((x) => x.b);
    const m = matchArchetype(readerProfile(win));
    out.push({ t: tt, date: new Date(tt).toISOString().slice(0, 10), archetypeId: m.archetype?.id || null, archetypeName: m.archetype?.name || null, sim: m.sim || 0, count: m.count });
    if (tt >= now) break;
  }
  return out;
}
