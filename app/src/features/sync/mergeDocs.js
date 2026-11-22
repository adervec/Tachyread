// The cloud copies of reading progress and the Trackyread library, merged record by record (house
// standard 30). Each merge is a JOIN: the same answer whichever device runs it, in whatever order,
// and merging a result again changes nothing. That is what lets every device keep its last merged copy,
// join this device's changes into it, and never push an older view over newer data.
//   newer updatedAt wins (a deletion is a record with deleted: true, so it beats an older copy);
//   counters and read masks only grow (max / bitwise OR); equal times are settled by content.
// Who wrote the copy and when (device, exportedAt, generatedAt) is left out: those differ on every
// device and would make two devices rewrite the file back and forth for ever.

export function stableJSON(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, k2) => { o[k2] = x[k2]; return o; }, {}) : x));
}
const tie = (x, y) => (stableJSON(x) >= stableJSON(y) ? x : y);
const num = (v) => (typeof v === 'number' ? v : Date.parse(v) || 0);
// the newer of two records by a time field; equal times by content
const newer = (x, y, f = 'updatedAt') => {
  if (x == null) return y ?? null;
  if (y == null) return x;
  const d = num(x[f]) - num(y[f]);
  return d > 0 ? x : d < 0 ? y : tie(x, y);
};
const maxStr = (x, y) => (!x ? y || '' : !y ? x : x >= y ? x : y);
const max = (x, y) => Math.max(Number(x) || 0, Number(y) || 0);

// Two objects keyed by id: keys from both, f(a, b) where both have one (f(x, x) where one does). Keys sorted, so the result
// reads the same on every device.
function byKey(a, b, f) {
  const out = {};
  for (const k of [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort()) {
    const x = a?.[k], y = b?.[k];
    out[k] = f(x === undefined ? y : x, y === undefined ? x : y); // one side alone: f(x, x), the same shape as a merge
  }
  return out;
}
// Two lists of records: one per id (pick(a, b) where both have it), sorted by id.
function byId(a, b, pick = newer, id = 'id') {
  const m = new Map();
  for (const r of [...(a || []), ...(b || [])]) {
    if (!r || r[id] == null) continue;
    const k = String(r[id]);
    m.set(k, pick(m.has(k) ? m.get(k) : r, r));
  }
  return [...m.keys()].sort().map((k) => m.get(k));
}
// Days ({ date, …numbers }): one per date, each number the larger (each device's day is a lower bound).
function days(a, b) {
  return byId(a, b, (x, y) => joinNumbers(x, y), 'date');
}
function joinNumbers(x, y) {
  return byKey(x, y, (p, q) => (typeof p === 'number' && typeof q === 'number' ? Math.max(p, q)
    : p && q && typeof p === 'object' && typeof q === 'object' && !Array.isArray(p) && !Array.isArray(q) ? joinNumbers(p, q) : tie(p, q)));
}

// Bitwise OR of two base64 bit masks: a word read on either device stays read.
function orMask(a, b) {
  if (!a || !b) return a || b || '';
  const x = atob(a), y = atob(b);
  let s = '';
  for (let i = 0; i < Math.max(x.length, y.length); i++) s += String.fromCharCode((x.charCodeAt(i) || 0) | (y.charCodeAt(i) || 0));
  return btoa(s);
}

function readstate(x, y) {
  return {
    maskB64: orMask(x.maskB64, y.maskB64),
    // ponytail: one device's per-word speeds / first-read sources win whole (the larger string, so every
    // device picks the same); a per-word merge would need the masks' layouts, add it if it ever matters
    wpmB64: maxStr(x.wpmB64, y.wpmB64), srcB64: maxStr(x.srcB64, y.srcB64), paraTsB64: maxStr(x.paraTsB64, y.paraTsB64),
    lifetimeActiveMs: max(x.lifetimeActiveMs, y.lifetimeActiveMs),
    daily: days(x.daily, y.daily),
  };
}

function fileProgress(x, y) {
  const out = { ...tie(x, y) };
  // the reading position: the most recent move wins (a deliberate rewind must win); unstamped: the furthest
  const tx = num(x.posUpdatedAt), ty = num(y.posUpdatedAt);
  const pos = tx !== ty ? (tx > ty ? x : y) : ((x.wordIndex || 0) >= (y.wordIndex || 0) ? x : y);
  out.wordIndex = pos.wordIndex || 0;
  if (pos.posUpdatedAt !== undefined) out.posUpdatedAt = pos.posUpdatedAt; else delete out.posUpdatedAt;
  if (pos.posDevice !== undefined) out.posDevice = pos.posDevice; else delete out.posDevice;
  out.name = maxStr(x.name, y.name);
  for (const k of ['totalWords', 'persistentWordsRead', 'persistentActiveTimeSecs', 'persistentTotalTimeSecs', 'rating']) out[k] = max(x[k], y[k]);
  if (x.persistentPacedWords != null || y.persistentPacedWords != null) out.persistentPacedWords = max(x.persistentPacedWords, y.persistentPacedWords);
  out.dailyHistory = days(x.dailyHistory, y.dailyHistory);
  if (x.sessionLog || y.sessionLog) out.sessionLog = byId(x.sessionLog, y.sessionLog, tie, 'start').sort((p, q) => p.start - q.start).slice(-200);
  if (x.completions || y.completions) out.completions = [...new Set([...(x.completions || []), ...(y.completions || [])].map(stableJSON))].sort().map((s) => JSON.parse(s));
  if (x.tocReadStats || y.tocReadStats) out.tocReadStats = joinNumbers(x.tocReadStats, y.tocReadStats);
  return out;
}

// ponytail: groups have no deletion record, so a group removed on one device comes back from another
// (as before this merge); add tombstones to book groups if that bites
function bookGroup(x, y) {
  const lead = num(x.createdAt) !== num(y.createdAt) ? (num(x.createdAt) > num(y.createdAt) ? x : y) : tie(x, y);
  const members = [...new Set([...(x.members || []), ...(y.members || [])])].sort();
  return { ...lead, members }; // a missing master is filled on import (storage.mergeBookGroups)
}

export function mergeProgressDocs(a, b) {
  if (!a || !b) return clean(a || b, 'progress');
  return {
    app: 'tachyread-progress', version: Math.max(a.version || 2, b.version || 2),
    readstate: byKey(a.readstate, b.readstate, readstate),
    files: byKey(a.files, b.files, fileProgress),
    notes: byKey(a.notes, b.notes, (x, y) => byId(x, y)),
    grabMarkers: byKey(a.grabMarkers, b.grabMarkers, (x, y) => newer(x, y, 'createdAt')),
    audiobookMarkers: byKey(a.audiobookMarkers, b.audiobookMarkers, (x, y) => ((x.chunks || 0) !== (y.chunks || 0) ? ((x.chunks || 0) > (y.chunks || 0) ? x : y) : newer(x, y))),
    bookGroups: byId(a.bookGroups, b.bookGroups, bookGroup),
    global: newer(a.global, b.global) || undefined,
    presence: byId(a.presence, b.presence, (x, y) => newer(x, y, 'at'), 'deviceId'),
  };
}

const REFS = ['meta', 'authors', 'genres', 'subgenres', 'goals', 'queues'];
export function mergeLibraryDocs(a, b) {
  if (!a || !b) return clean(a || b, 'library');
  const out = { protocol: 'tachyread-journey', protocolVersion: 1, kind: 'library', stamps: {} };
  out.books = byId(a.books, b.books);
  for (const k of REFS) {
    // each list is one record, stamped when it last changed (older files: the file's own time)
    // (a missing list never beats a real one: a device that never had it says nothing about it)
    const x = { v: a[k] ?? null, t: a.stamps?.[k] ?? a.generatedAt ?? 0 }, y = { v: b[k] ?? null, t: b.stamps?.[k] ?? b.generatedAt ?? 0 };
    const pick = x.v == null && y.v == null ? { v: null, t: 0 } : x.v == null ? y : y.v == null ? x : newer(x, y, 't');
    out[k] = pick.v; out.stamps[k] = pick.t;
  }
  out.crossNotes = a.crossNotes || b.crossNotes ? byId(a.crossNotes, b.crossNotes) : null;
  out.ai = newer(a.ai, b.ai);
  // ponytail: a book's file binding carries no time, so two devices that bound the same file differently
  // settle on one of the two (the same one everywhere); stamp bindings if rebinding across devices matters
  out.binding = a.binding || b.binding ? byKey(a.binding, b.binding, tie) : null;
  out.bindingSections = a.bindingSections || b.bindingSections ? byKey(a.bindingSections, b.bindingSections, (x, y) => byKey(x, y, tie)) : null;
  return out;
}

// One copy alone, in the same shape a merge returns (so a first sync and a later one agree).
function clean(doc, kind) {
  if (!doc) return null;
  const empty = kind === 'progress' ? { app: 'tachyread-progress', version: doc.version || 2 } : { protocol: 'tachyread-journey', protocolVersion: 1, kind: 'library', books: [] };
  return kind === 'progress' ? mergeProgressDocs(doc, empty) : mergeLibraryDocs(doc, empty);
}
