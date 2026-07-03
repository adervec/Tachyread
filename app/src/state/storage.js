// IndexedDB-backed persistence using `idb`. Mirrors the WPF settings.json/global.json files
// but keyed by content checksum so renamed/moved files keep their progress.

import { openDB } from 'idb';
import { defaultGlobalSettings, defaultFileSettings, tabDefaultsFrom, syncableGlobalSettings } from './settings.js';

const DB_NAME = 'Tachyread';
const DB_VERSION = 8;

let _dbPromise = null;

function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'checksum' });
      }
      if (!db.objectStoreNames.contains('global')) {
        db.createObjectStore('global');
      }
      if (!db.objectStoreNames.contains('audiobook')) {
        // key: `${checksum}/${lineIndex}` → { blob, durationMs, createdAt }
        db.createObjectStore('audiobook');
      }
      if (!db.objectStoreNames.contains('audiobookManifest')) {
        db.createObjectStore('audiobookManifest'); // key: checksum → { lines: {idx: {durationMs, createdAt}} }
      }
      if (!db.objectStoreNames.contains('readstate')) {
        // key: checksum → { maskB64, lifetimeActiveMs, daily:[{date,words,ms}] }
        db.createObjectStore('readstate');
      }
      if (!db.objectStoreNames.contains('grabbed')) {
        // key: checksum → { checksum, name, createdAt, segments:[{text,image,regions,ocr}], ocr }
        // Lets grabbed/OCR'd documents reopen without repeating the capture + OCR.
        db.createObjectStore('grabbed', { keyPath: 'checksum' });
      }
      if (!db.objectStoreNames.contains('docs')) {
        // key: checksum → { checksum, fileName, fullText, source, wordToSegment, segmentCount }
        // Rebuildable doc payload so the previous session's tabs can be reopened on reconnect.
        db.createObjectStore('docs', { keyPath: 'checksum' });
      }
      if (!db.objectStoreNames.contains('grabSessions')) {
        // In-progress (not-yet-opened) capture sessions, so an abandoned grab can be resumed
        // or explicitly discarded. key: id → { id, createdAt, updatedAt, step, voiceWord,
        // segments:[{text,image,layout,regions,ocrMode}], ocr, pageCount }
        db.createObjectStore('grabSessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('typingRuns')) {
        // Detailed typing-practice history (separate from reading): one record per completed run
        // { id, ts, netWpm, grossWpm, accuracy, chars, errors, words, durationMs, docName, errorKeys }
        db.createObjectStore('typingRuns', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('focusSessions')) {
        // Webcam look-away analytics: one record per reading session a camera guard was active.
        // { id, ts, watchedMs, awayMs, distractions, docName }
        db.createObjectStore('focusSessions', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('fsHandles')) {
        // File System Access handles (e.g. the chosen sync folder). Structured-cloneable but NOT
        // JSON, so this store is deliberately kept OUT of export/import. key string → handle.
        db.createObjectStore('fsHandles');
      }
    },
  });
  return _dbPromise;
}

// Per-document reading state: the bit-packed read mask + lifetime active ms + daily history.
// Kept out of the FileSettings record because the mask can be large; saved on a throttle.
export async function loadReadState(checksum) {
  if (!checksum) return null;
  const db = await getDB();
  return (await db.get('readstate', checksum)) || null;
}

export async function saveReadState(checksum, state) {
  if (!checksum) return;
  const db = await getDB();
  await db.put('readstate', state, checksum);
}

export async function loadGlobal() {
  const db = await getDB();
  const data = (await db.get('global', 'settings')) || defaultGlobalSettings();
  return { ...defaultGlobalSettings(), ...data };
}

export async function saveGlobal(g) {
  const db = await getDB();
  await db.put('global', g, 'settings');
}

export async function loadFile(checksum) {
  if (!checksum) return null;
  const db = await getDB();
  return (await db.get('files', checksum)) || null;
}

export async function saveFile(settings) {
  if (!settings.contentChecksum) return;
  const db = await getDB();
  // updatedAt is the per-file last-write-wins clock for the tab-settings half of cloud sync.
  await db.put('files', { ...settings, checksum: settings.contentChecksum, updatedAt: Date.now() });
}

export async function allFiles() {
  const db = await getDB();
  return await db.getAll('files');
}

export async function deleteFile(checksum) {
  const db = await getDB();
  await db.delete('files', checksum);
}

// Lightweight {checksum, fileName} for every persisted doc payload — lets the reading history label
// books (even ones opened before names were stored in FileSettings) without holding every full text
// in memory at once (cursor walk, one record live at a time).
export async function allDocMeta() {
  const db = await getDB();
  const out = [];
  let cursor = await db.transaction('docs').store.openCursor();
  while (cursor) {
    out.push({ checksum: cursor.value.checksum, fileName: cursor.value.fileName });
    cursor = await cursor.continue();
  }
  return out;
}

// Grabbed/OCR'd documents (text + original images + OCR config) so they reopen without
// repeating the capture + recognition. Keyed by the doc's content checksum.
export async function saveGrabbed(record) {
  if (!record?.checksum) return;
  const db = await getDB();
  await db.put('grabbed', { ...record });
}

export async function loadGrabbed(checksum) {
  if (!checksum) return null;
  const db = await getDB();
  return (await db.get('grabbed', checksum)) || null;
}

export async function allGrabbed() {
  const db = await getDB();
  return await db.getAll('grabbed');
}

export async function deleteGrabbed(checksum) {
  const db = await getDB();
  await db.delete('grabbed', checksum);
}

// In-progress grab sessions (resumable / discardable). Keyed by a generated id.
export async function saveGrabSession(rec) {
  if (!rec?.id) return;
  const db = await getDB();
  try {
    await db.put('grabSessions', { ...rec });
  } catch {
    /* images may exceed quota — fail quietly rather than break the wizard */
  }
}

export async function allGrabSessions() {
  const db = await getDB();
  return await db.getAll('grabSessions');
}

export async function deleteGrabSession(id) {
  if (!id) return;
  const db = await getDB();
  await db.delete('grabSessions', id);
}

// Rebuildable doc payloads (text + source) keyed by checksum — used to restore session tabs.
export async function saveDocPayload(rec) {
  if (!rec?.checksum) return;
  const db = await getDB();
  try {
    await db.put('docs', { ...rec });
  } catch {
    // Source (e.g. a large PDF's bytes) may exceed quota or be non-cloneable — keep the text.
    try { await db.put('docs', { checksum: rec.checksum, fileName: rec.fileName, fullText: rec.fullText }); } catch { /* give up */ }
  }
}

export async function loadDocPayload(checksum) {
  if (!checksum) return null;
  const db = await getDB();
  return (await db.get('docs', checksum)) || null;
}

export async function deleteDocPayload(checksum) {
  const db = await getDB();
  await db.delete('docs', checksum);
}

// The set of open tabs (ordered) + active tab, so a fresh load can reconnect to the last session.
export async function loadSession() {
  const db = await getDB();
  return (await db.get('global', 'session')) || null;
}

export async function saveSession(session) {
  const db = await getDB();
  await db.put('global', session, 'session');
}

export async function clearSession() {
  const db = await getDB();
  await db.delete('global', 'session');
}

// Typing-practice history (separate from reading history).
export async function saveTypingRun(run) {
  const db = await getDB();
  await db.add('typingRuns', { ...run });
}

export async function allTypingRuns() {
  const db = await getDB();
  return await db.getAll('typingRuns');
}

export async function clearTypingRuns() {
  const db = await getDB();
  await db.clear('typingRuns');
}

// Webcam look-away analytics (one record per camera-on reading session).
export async function saveFocusSession(rec) {
  const db = await getDB();
  await db.add('focusSessions', { ...rec });
}
export async function allFocusSessions() {
  const db = await getDB();
  return db.getAll('focusSessions');
}
export async function clearFocusSessions() {
  const db = await getDB();
  await db.clear('focusSessions');
}

// Audiobook clips. `source` marks how the clip was made: 'mic' (recorded voice) or 'tts' (Piper);
// `voiceId` records which Piper voice, so a re-generate can tell whether a clip is up to date.
export async function saveAudioClip(checksum, lineIndex, blob, durationMs, meta = {}) {
  const db = await getDB();
  const key = `${checksum}/${String(lineIndex).padStart(5, '0')}`;
  await db.put('audiobook', { blob, durationMs, createdAt: Date.now() }, key);
  let manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  manifest.lines[lineIndex] = { durationMs, createdAt: Date.now(), source: meta.source || 'mic', voiceId: meta.voiceId || null };
  await db.put('audiobookManifest', manifest, checksum);
}

export async function getAudioClip(checksum, lineIndex) {
  const db = await getDB();
  const key = `${checksum}/${String(lineIndex).padStart(5, '0')}`;
  return await db.get('audiobook', key);
}

export async function deleteAudioClip(checksum, lineIndex) {
  const db = await getDB();
  const key = `${checksum}/${String(lineIndex).padStart(5, '0')}`;
  await db.delete('audiobook', key);
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  delete manifest.lines[lineIndex];
  await db.put('audiobookManifest', manifest, checksum);
}

export async function getAudiobookManifest(checksum) {
  const db = await getDB();
  return (await db.get('audiobookManifest', checksum)) || { lines: {} };
}

// Record count per object store — for the data-suite overview (cheap; no data read).
export async function storeCounts() {
  const db = await getDB();
  const out = {};
  for (const name of db.objectStoreNames) {
    try { out[name] = await db.count(name); } catch { out[name] = 0; }
  }
  return out;
}

// Clear one object store (e.g. typing runs, focus sessions, the OCR/grab cache).
export async function clearStore(name) {
  const db = await getDB();
  if (db.objectStoreNames.contains(name)) await db.clear(name);
}

// Wipe every store + the tachyread-* localStorage keys (keeps the instance lock). Used by the
// data suite's "delete everything" — the caller reloads afterward.
export async function wipeAllData() {
  const db = await getDB();
  for (const name of db.objectStoreNames) { try { await db.clear(name); } catch { /* skip */ } }
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tachyread-') && k !== 'tachyread-instance-lock') keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}

export async function exportDatabase() {
  const db = await getDB();
  const out = { files: await db.getAll('files'), global: await db.get('global', 'settings') };
  return JSON.stringify(out, null, 2);
}

// ── Full data export / import (local backup, and the unit the sync layer pushes) ──────────────
// Every store, plus the tachyread-* localStorage keys (minus the volatile instance lock). Binary
// values (audiobook clips, doc sources) are base64-tagged so the whole thing is plain JSON.

// [storeName, inlineKey?] — inline stores carry their key in the record (keyPath); the rest are
// out-of-line and exported as {key,value} pairs.
const ALL_STORES = [
  ['files', true], ['global', false], ['audiobook', false], ['audiobookManifest', false],
  ['readstate', false], ['grabbed', true], ['docs', true], ['grabSessions', true], ['typingRuns', true],
  ['focusSessions', true],
];

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function packValue(v) {
  if (v == null) return v;
  if (v instanceof Blob) return { __bin: 'blob', mime: v.type, b64: bufToB64(await v.arrayBuffer()) };
  if (v instanceof ArrayBuffer) return { __bin: 'ab', b64: bufToB64(v) };
  if (ArrayBuffer.isView(v)) return { __bin: 'ta', ctor: v.constructor.name, b64: bufToB64(v.buffer) };
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await packValue(x)); return out; }
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await packValue(v[k]); return o; }
  return v;
}
function unpackValue(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v.__bin === 'blob') return new Blob([b64ToBuf(v.b64)], { type: v.mime || '' });
  if (v.__bin === 'ab') return b64ToBuf(v.b64);
  if (v.__bin === 'ta') { const C = globalThis[v.ctor] || Uint8Array; return new C(b64ToBuf(v.b64)); }
  if (Array.isArray(v)) return v.map(unpackValue);
  const o = {};
  for (const k of Object.keys(v)) o[k] = unpackValue(v[k]);
  return o;
}

export async function exportAllData() {
  const db = await getDB();
  const out = { app: 'tachyread', version: 1, dbVersion: DB_VERSION, exportedAt: Date.now(), db: {}, local: {} };
  for (const [store, inline] of ALL_STORES) {
    if (!db.objectStoreNames.contains(store)) continue;
    if (inline) {
      const rows = await db.getAll(store);
      const packed = [];
      for (const r of rows) packed.push(await packValue(r));
      out.db[store] = { inline: true, rows: packed };
    } else {
      const keys = await db.getAllKeys(store);
      const vals = await db.getAll(store);
      const entries = [];
      for (let i = 0; i < keys.length; i++) entries.push({ key: keys[i], value: await packValue(vals[i]) });
      out.db[store] = { inline: false, entries };
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tachyread-') && k !== 'tachyread-instance-lock') out.local[k] = localStorage.getItem(k);
    }
  } catch { /* storage unavailable */ }
  return out;
}

// Per-store record counts for the UI / confirmation, without touching the DB.
export function exportSummary(bundle) {
  const counts = {};
  let total = 0;
  for (const [store] of ALL_STORES) {
    const s = bundle?.db?.[store];
    const n = !s ? 0 : s.inline ? (s.rows?.length || 0) : (s.entries?.length || 0);
    counts[store] = n;
    total += n;
  }
  counts.localStorage = Object.keys(bundle?.local || {}).length;
  return { counts, total };
}

export async function importAllData(bundle, { replace = true } = {}) {
  if (!bundle || bundle.app !== 'tachyread' || !bundle.db) throw new Error('Not a Tachyread backup file.');
  const db = await getDB();
  let written = 0;
  for (const [store, inline] of ALL_STORES) {
    const s = bundle.db[store];
    if (!s || !db.objectStoreNames.contains(store)) continue;
    const tx = db.transaction(store, 'readwrite');
    if (replace) await tx.store.clear();
    if (inline) {
      for (const row of (s.rows || [])) { await tx.store.put(unpackValue(row)); written++; }
    } else {
      for (const e of (s.entries || [])) { await tx.store.put(unpackValue(e.value), e.key); written++; }
    }
    await tx.done;
  }
  try {
    for (const [k, v] of Object.entries(bundle.local || {})) {
      if (k !== 'tachyread-instance-lock') localStorage.setItem(k, v);
    }
  } catch { /* storage unavailable */ }
  return { written };
}

// ── Progress-only sync bundle ─────────────────────────────────────────────────────────────────
// What the CLOUD sync layer pushes — deliberately NOT a full backup. It carries only reading
// HISTORY/PROGRESS, keyed by each processed file's content checksum, so the same file opened on two
// devices shares progress. It never carries file bodies, document text, or grab images: a grab made
// on another device travels only as a lightweight marker (checksum + name + when), so other devices
// can SEE that a grab exists elsewhere without receiving its contents. Book groups (Feature 4) ride
// along so the same "these editions are one book" grouping applies everywhere.
//
// Merge is union/max — commutative and monotonic, so bidirectional sync needs no clocks and never
// double-counts: read masks OR together, counters/positions take the max, daily history merges per
// date by max. Progress only moves forward.

// Reading-progress fields lifted out of a FileSettings record (cosmetic per-file prefs stay local).
const PROGRESS_FILE_FIELDS = [
  'wordIndex', 'totalWords', 'persistentWordsRead', 'persistentActiveTimeSecs',
  'persistentTotalTimeSecs', 'dailyHistory', 'completions', 'rating', 'tocReadStats',
];

// Bitwise-OR two bit-packed read masks (base64) — a word read on EITHER device stays read.
function orMaskB64(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  const ba = new Uint8Array(b64ToBuf(a));
  const bb = new Uint8Array(b64ToBuf(b));
  const n = Math.max(ba.length, bb.length);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (ba[i] || 0) | (bb[i] || 0);
  return bufToB64(out.buffer);
}
// Merge tracker daily arrays ({date,words,ms}) by date, taking the max of each (no double-count).
function mergeDaily(a = [], b = []) {
  const m = new Map();
  for (const d of a || []) if (d?.date) m.set(d.date, { date: d.date, words: d.words || 0, ms: d.ms || 0 });
  for (const d of b || []) {
    if (!d?.date) continue;
    const cur = m.get(d.date);
    if (!cur) m.set(d.date, { date: d.date, words: d.words || 0, ms: d.ms || 0 });
    else { cur.words = Math.max(cur.words, d.words || 0); cur.ms = Math.max(cur.ms, d.ms || 0); }
  }
  return [...m.values()];
}
// Merge FileSettings dailyHistory ({date,wordsRead,activeTimeSecs}) by date, by max.
function mergeDailyHistory(a = [], b = []) {
  const m = new Map();
  for (const d of a || []) if (d?.date) m.set(d.date, { date: d.date, wordsRead: d.wordsRead || 0, activeTimeSecs: d.activeTimeSecs || 0 });
  for (const d of b || []) {
    if (!d?.date) continue;
    const cur = m.get(d.date);
    if (!cur) m.set(d.date, { date: d.date, wordsRead: d.wordsRead || 0, activeTimeSecs: d.activeTimeSecs || 0 });
    else { cur.wordsRead = Math.max(cur.wordsRead, d.wordsRead || 0); cur.activeTimeSecs = Math.max(cur.activeTimeSecs, d.activeTimeSecs || 0); }
  }
  return [...m.values()];
}
function unionCompletions(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const c of [...(a || []), ...(b || [])]) { const k = JSON.stringify(c); if (!seen.has(k)) { seen.add(k); out.push(c); } }
  return out;
}
// Merge book groups by id: members union (grouping is additive across devices), name = most recent.
export function mergeBookGroups(a = [], b = []) {
  const m = new Map();
  for (const g of a || []) if (g?.id) m.set(g.id, { ...g, members: [...new Set(g.members || [])] });
  for (const g of b || []) {
    if (!g?.id) continue;
    const cur = m.get(g.id);
    if (!cur) { m.set(g.id, { ...g, members: [...new Set(g.members || [])] }); continue; }
    cur.members = [...new Set([...(cur.members || []), ...(g.members || [])])];
    if (g.name && (g.createdAt || 0) >= (cur.createdAt || 0)) cur.name = g.name;
    if (g.master && (g.createdAt || 0) >= (cur.createdAt || 0)) cur.master = g.master;
    if (!cur.master) cur.master = (cur.members || [])[0];
  }
  return [...m.values()];
}

export async function exportProgressData() {
  const db = await getDB();
  const g = (await db.get('global', 'settings')) || {};
  const nameByChecksum = new Map((g.recentFiles || []).map((r) => [r.checksum, r.name]));
  const out = {
    app: 'tachyread-progress', version: 2, exportedAt: Date.now(),
    device: g.deviceName || '', readstate: {}, files: {}, grabMarkers: {}, bookGroups: g.bookGroups || [],
    // Settings half of the sync (added in v2): the syncable application settings (prefs + Default Tab
    // Settings) and per-file tab settings, each with a last-write-wins timestamp.
    global: { settings: syncableGlobalSettings(g), updatedAt: g.settingsUpdatedAt || 0 },
    fileSettings: {},
  };
  const rsKeys = await db.getAllKeys('readstate');
  const rsVals = await db.getAll('readstate');
  for (let i = 0; i < rsKeys.length; i++) {
    const v = rsVals[i] || {};
    out.readstate[rsKeys[i]] = { maskB64: v.maskB64 || '', wpmB64: v.wpmB64 || '', lifetimeActiveMs: v.lifetimeActiveMs || 0, daily: v.daily || [], paraTsB64: v.paraTsB64 || '' };
  }
  for (const f of await db.getAll('files')) {
    if (!f?.checksum) continue;
    const rec = { name: nameByChecksum.get(f.checksum) || '' };
    for (const k of PROGRESS_FILE_FIELDS) if (f[k] !== undefined) rec[k] = f[k];
    out.files[f.checksum] = rec;
    // Reusable per-file appearance/behaviour settings (no progress, no identity), LWW by updatedAt.
    out.fileSettings[f.checksum] = { ...tabDefaultsFrom(f), updatedAt: f.updatedAt || 0 };
  }
  for (const gr of await db.getAll('grabbed')) {
    if (!gr?.checksum) continue;
    out.grabMarkers[gr.checksum] = { name: gr.name || 'Grab', createdAt: gr.createdAt || 0, pageCount: gr.segments?.length || 0, device: g.deviceName || '' };
  }
  return out;
}

export async function importProgressData(bundle) {
  if (!bundle || bundle.app !== 'tachyread-progress') throw new Error('Not a Tachyread progress-sync file.');
  const db = await getDB();
  let merged = 0;
  // Reading state (mask/time/daily) — union/max merge.
  for (const [checksum, inc] of Object.entries(bundle.readstate || {})) {
    const tx = db.transaction('readstate', 'readwrite');
    const cur = (await tx.store.get(checksum)) || {};
    await tx.store.put({
      maskB64: orMaskB64(cur.maskB64, inc.maskB64),
      wpmB64: cur.wpmB64 || inc.wpmB64 || '',
      lifetimeActiveMs: Math.max(cur.lifetimeActiveMs || 0, inc.lifetimeActiveMs || 0),
      daily: mergeDaily(cur.daily, inc.daily),
      paraTsB64: cur.paraTsB64 || inc.paraTsB64 || '',
    }, checksum);
    await tx.done;
    merged++;
  }
  // File progress (resume cursor + persistent counters) — max merge; create a partial record if the
  // file has never been opened here, so progress is waiting when its local copy is first opened.
  for (const [checksum, inc] of Object.entries(bundle.files || {})) {
    const tx = db.transaction('files', 'readwrite');
    const cur = (await tx.store.get(checksum)) || { ...defaultFileSettings() };
    cur.contentChecksum = checksum; cur.checksum = checksum;
    cur.wordIndex = Math.max(cur.wordIndex || 0, inc.wordIndex || 0);
    if (!cur.totalWords) cur.totalWords = inc.totalWords || 0;
    cur.persistentWordsRead = Math.max(cur.persistentWordsRead || 0, inc.persistentWordsRead || 0);
    cur.persistentActiveTimeSecs = Math.max(cur.persistentActiveTimeSecs || 0, inc.persistentActiveTimeSecs || 0);
    cur.persistentTotalTimeSecs = Math.max(cur.persistentTotalTimeSecs || 0, inc.persistentTotalTimeSecs || 0);
    cur.dailyHistory = mergeDailyHistory(cur.dailyHistory, inc.dailyHistory);
    cur.completions = unionCompletions(cur.completions, inc.completions);
    cur.rating = Math.max(cur.rating || 0, inc.rating || 0);
    cur.tocReadStats = { ...(inc.tocReadStats || {}), ...(cur.tocReadStats || {}) };
    await tx.store.put(cur);
    await tx.done;
    merged++;
  }
  // Per-file tab settings (appearance/behaviour) — last-write-wins by updatedAt. The progress fields
  // merged above are left untouched; only the reusable settings are overlaid.
  for (const [checksum, inc] of Object.entries(bundle.fileSettings || {})) {
    const tx = db.transaction('files', 'readwrite');
    const cur = (await tx.store.get(checksum)) || { ...defaultFileSettings(), contentChecksum: checksum, checksum };
    if ((inc.updatedAt || 0) > (cur.updatedAt || 0)) {
      const { updatedAt, ...fields } = inc;
      Object.assign(cur, tabDefaultsFrom(fields)); // only reusable keys (never progress/identity)
      cur.updatedAt = inc.updatedAt || 0;
      cur.contentChecksum = checksum; cur.checksum = checksum;
      await tx.store.put(cur);
    }
    await tx.done;
  }
  // Global: remote-grab markers (only for grabs we DON'T already have locally) + book groups.
  const g = (await db.get('global', 'settings')) || defaultGlobalSettings();
  // Application settings (prefs + Default Tab Settings) — last-write-wins by the settings clock.
  if (bundle.global && bundle.global.settings && (bundle.global.updatedAt || 0) > (g.settingsUpdatedAt || 0)) {
    Object.assign(g, syncableGlobalSettings(bundle.global.settings));
    g.settingsUpdatedAt = bundle.global.updatedAt || 0;
  }
  const localGrabKeys = new Set(await db.getAllKeys('grabbed'));
  const remoteMap = new Map((g.remoteGrabs || []).map((r) => [r.checksum, r]));
  for (const [checksum, inc] of Object.entries(bundle.grabMarkers || {})) {
    if (localGrabKeys.has(checksum)) { remoteMap.delete(checksum); continue; } // it's local here — not "elsewhere"
    const prev = remoteMap.get(checksum);
    if (!prev || (inc.createdAt || 0) >= (prev.createdAt || 0)) remoteMap.set(checksum, { checksum, name: inc.name, createdAt: inc.createdAt || 0, pageCount: inc.pageCount || 0, device: inc.device || bundle.device || '', seenAt: Date.now() });
  }
  g.remoteGrabs = [...remoteMap.values()];
  g.bookGroups = mergeBookGroups(g.bookGroups, bundle.bookGroups);
  await db.put('global', g, 'settings');
  return { merged };
}

// File System Access handles (sync folder, etc.). Kept out of export (not JSON-serializable).
export async function getFsHandle(key) {
  const db = await getDB();
  return (await db.get('fsHandles', key)) || null;
}
export async function setFsHandle(key, handle) {
  const db = await getDB();
  if (handle == null) await db.delete('fsHandles', key);
  else await db.put('fsHandles', handle, key);
}
