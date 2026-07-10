// IndexedDB-backed persistence using `idb`. Mirrors the WPF settings.json/global.json files
// but keyed by content checksum so renamed/moved files keep their progress.

import { openDB } from 'idb';
import { defaultGlobalSettings, defaultFileSettings, tabDefaultsFrom, syncableGlobalSettings } from './settings.js';

const DB_NAME = 'Tachyread';
const DB_VERSION = 12;

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
      if (!db.objectStoreNames.contains('notes')) {
        // Per-document notes / annotations. key: checksum → { notes: [{ id, wordIndex, text,
        // color, createdAt, updatedAt, deleted }] }. Soft-deleted (tombstone) so deletes sync.
        db.createObjectStore('notes');
      }
      if (!db.objectStoreNames.contains('library')) {
        // The Literary Journey reading tracker (the user's own ~3.5k-book library, imported —
        // NOT bundled). Out-of-line string keys, one record each so cross-device merges are per
        // item: `book:<id>` → book + {updatedAt, deleted}; `refs:authors|genres|subgenres` and
        // `meta` → reference singletons; `binding` → {map:{checksum→bookId}}; `ai` → AI outputs +
        // the cowork instruction. Deliberately kept OUT of ALL_STORES (it syncs as its own Drive
        // file, like audiobook audio) so a 5 MB library never bloats the local backup.
        db.createObjectStore('library');
      }
      if (!db.objectStoreNames.contains('translations')) {
        // Translation cache for the translate obscure mode / parallel view: key
        // `provider:source:target:hash(text)` → translated string. Pure cache (regenerable,
        // costs API quota to rebuild) — excluded from backups on purpose.
        db.createObjectStore('translations');
      }
      if (!db.objectStoreNames.contains('apiUsage')) {
        // API spend log: one record per Anthropic/ElevenLabs call, for the spend dashboard.
        // { id, ts, provider, model, source, inTokens, outTokens, chars, costUsd }. Local-only
        // (out of ALL_STORES / backups) — it's diagnostic, like appLog.
        db.createObjectStore('apiUsage', { keyPath: 'id', autoIncrement: true });
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

// ── Diagnostic log — a small, capped, clearable local event log (errors + notable events), so
// "it failed for unclear reasons" has somewhere to look. Stored under the `global` store (no schema
// bump); writes are serialized through a chain so concurrent appends can't clobber each other.
let _logChain = Promise.resolve();
export function appendAppLog(tag, message) {
  _logChain = _logChain
    .then(async () => {
      const db = await getDB();
      const arr = (await db.get('global', 'appLog')) || [];
      arr.push({ ts: Date.now(), tag, message: String(message ?? '').slice(0, 600) });
      while (arr.length > 500) arr.shift();
      await db.put('global', arr, 'appLog');
    })
    .catch(() => { /* logging must never throw */ });
  return _logChain;
}
export async function getAppLog() {
  const db = await getDB();
  return (await db.get('global', 'appLog')) || [];
}
export async function clearAppLog() {
  const db = await getDB();
  await db.delete('global', 'appLog');
}

// ── API spend log — one record per Anthropic/ElevenLabs call, for the spend dashboard. Best-effort:
// recording must never break the API call itself. Capped so a heavy audiobook run can't grow it.
const API_USAGE_CAP = 5000;
export async function recordApiUsage(entry) {
  try {
    const db = await getDB();
    await db.add('apiUsage', { ts: Date.now(), ...entry });
    const keys = await db.getAllKeys('apiUsage');
    if (keys.length > API_USAGE_CAP) {
      const tx = db.transaction('apiUsage', 'readwrite');
      for (const k of keys.slice(0, keys.length - API_USAGE_CAP)) await tx.store.delete(k);
      await tx.done;
    }
  } catch { /* logging is best-effort */ }
}
export async function getApiUsage() {
  const db = await getDB();
  return (await db.getAll('apiUsage')).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}
export async function clearApiUsage() {
  const db = await getDB();
  await db.clear('apiUsage');
}

// ── Read-sections registry: a content fingerprint (see document/sectionHash) for every section a
// user has FINISHED, in any file. Lets a successive edition recognize chapters as already read even
// though the file checksum differs. Stored in the `global` store (map hash → { title, words, file,
// at }); capped. Local diagnostic-style data — kept out of ALL_STORES / backups.
const READ_SECTIONS_CAP = 8000;
export async function getReadSections() {
  const db = await getDB();
  return (await db.get('global', 'readSections')) || {};
}
// Writes are serialized through a chain: several sections often finish in the same poll cycle, and
// concurrent read-modify-write on the single map would otherwise clobber all but the last one.
let _readSecChain = Promise.resolve();
export function addReadSection(hash, meta = {}) {
  if (!hash) return _readSecChain;
  _readSecChain = _readSecChain
    .then(async () => {
      const db = await getDB();
      const map = (await db.get('global', 'readSections')) || {};
      if (!map[hash]) map[hash] = { title: meta.title || '', words: meta.words || 0, file: meta.file || '', at: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > READ_SECTIONS_CAP) {
        keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
        for (const k of keys.slice(0, keys.length - READ_SECTIONS_CAP)) delete map[k];
      }
      await db.put('global', map, 'readSections');
    })
    .catch(() => { /* best-effort */ });
  return _readSecChain;
}

// Translation cache (see the `translations` store note above).
export async function getCachedTranslation(key) {
  const db = await getDB();
  return (await db.get('translations', key)) ?? null;
}
export async function putCachedTranslation(key, text) {
  const db = await getDB();
  try { await db.put('translations', text, key); } catch { /* quota — cache only */ }
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
  // updatedAt / posUpdatedAt / posDevice arrive from the caller (AppContext persist loop), which
  // stamps them only when the reusable settings / position ACTUALLY change — stamping here on
  // every save would let a fresh open clobber another device's customizations in the cloud LWW.
  await db.put('files', { ...settings, checksum: settings.contentChecksum });
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

// Audiobook clips — MULTIPLE per chunk, ordered by priority so the reader plays the top one and you
// can keep alternates. `source`: 'mic' (recorded voice, always outranks TTS) or 'tts' (Piper, with a
// `voiceId`). Blobs live in the `audiobook` store keyed by `${checksum}/${line}/${clipId}`; per-clip
// metadata (source/voice/time/duration/size) lives in the manifest's ordered `clips` array so the
// manager can list clips without reading the audio. Legacy single-clip books (blob at the un-suffixed
// key, scalar meta on the manifest entry) are read transparently as a one-element list.
const padLine = (n) => String(n).padStart(5, '0');
const legacyBlobKey = (cs, line) => `${cs}/${padLine(line)}`;
const clipBlobKey = (cs, line, id) => (id === 'legacy' ? legacyBlobKey(cs, line) : `${cs}/${padLine(line)}/${id}`);
// Section-boundary extras (intro/outro music, a spoken section title) live under a distinct key
// namespace so they never collide with a chunk's clips. Keyed by the section's first-chunk line.
const SEC_ROLES = ['intro', 'title', 'outro'];
const secBlobKey = (cs, firstLine, role, id) => `${cs}/S${padLine(firstLine)}/${role}/${id}`;
// Manifest line entry → ordered clip-metadata list (mic clips forced ahead of TTS, else insertion order).
export function entryClips(entry) {
  if (!entry) return [];
  let clips;
  if (Array.isArray(entry.clips)) clips = entry.clips;
  else if (entry.durationMs != null || entry.source || entry.voiceId) {
    clips = [{ id: 'legacy', source: entry.source || 'tts', voiceId: entry.voiceId || null, createdAt: entry.createdAt || 0, durationMs: entry.durationMs || 0, sizeBytes: entry.sizeBytes || 0 }];
  } else clips = [];
  return clips
    .map((c, i) => [c, i])
    .sort((a, b) => (a[0].source === 'mic' ? 0 : 1) - (b[0].source === 'mic' ? 0 : 1) || a[1] - b[1])
    .map((x) => x[0]);
}

// Add a clip for a chunk (does NOT replace existing ones). Returns the new clip id.
export async function addAudioClip(checksum, line, blob, meta = {}) {
  const db = await getDB();
  const source = meta.source || 'tts';
  const id = `${source}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  await db.put('audiobook', { blob, durationMs: meta.durationMs || 0, createdAt: now, source, voiceId: meta.voiceId || null, sizeBytes: blob.size }, clipBlobKey(checksum, line, id));
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  const entry = manifest.lines[line] || {};
  const clips = entryClips(entry);
  clips.unshift({ id, source, voiceId: meta.voiceId || null, createdAt: now, durationMs: meta.durationMs || 0, sizeBytes: blob.size });
  entry.clips = entryClips({ clips });
  entry.spanEndLine = meta.spanEndLine != null ? meta.spanEndLine : (entry.spanEndLine != null ? entry.spanEndLine : line);
  // shed any legacy scalar meta now that we track a clips[] array
  delete entry.durationMs; delete entry.source; delete entry.voiceId; delete entry.createdAt;
  manifest.lines[line] = entry;
  await db.put('audiobookManifest', manifest, checksum);
  return id;
}

// Back-compat shim (old callers pass durationMs positionally). Adds a clip.
export async function saveAudioClip(checksum, line, blob, durationMs, meta = {}) {
  return addAudioClip(checksum, line, blob, { ...meta, durationMs });
}

// The active (highest-priority) clip blob for a chunk — what the reader plays.
export async function getAudioClip(checksum, line) {
  const db = await getDB();
  const manifest = await db.get('audiobookManifest', checksum);
  const clips = entryClips(manifest?.lines?.[line]);
  if (!clips.length) return await db.get('audiobook', legacyBlobKey(checksum, line));
  return await db.get('audiobook', clipBlobKey(checksum, line, clips[0].id));
}

export async function getAudioClipById(checksum, line, id) {
  const db = await getDB();
  return await db.get('audiobook', clipBlobKey(checksum, line, id));
}

// Delete one clip. Removes the chunk from the manifest if it was the last.
export async function deleteAudioClipById(checksum, line, id) {
  const db = await getDB();
  await db.delete('audiobook', clipBlobKey(checksum, line, id));
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  const entry = manifest.lines[line];
  if (!entry) return;
  const clips = entryClips(entry).filter((c) => c.id !== id);
  if (clips.length) manifest.lines[line] = { ...entry, clips, durationMs: undefined, source: undefined, voiceId: undefined, createdAt: undefined };
  else delete manifest.lines[line];
  await db.put('audiobookManifest', manifest, checksum);
}

// Delete every clip for a chunk.
export async function deleteAudioChunk(checksum, line) {
  const db = await getDB();
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  for (const c of entryClips(manifest.lines[line])) await db.delete('audiobook', clipBlobKey(checksum, line, c.id));
  delete manifest.lines[line];
  await db.put('audiobookManifest', manifest, checksum);
}

// Set the priority order of a chunk's clips (mic clips stay ahead of TTS regardless).
export async function reorderAudioClips(checksum, line, orderedIds) {
  const db = await getDB();
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  const entry = manifest.lines[line];
  if (!entry) return;
  const byId = new Map(entryClips(entry).map((c) => [c.id, c]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  manifest.lines[line] = { ...entry, clips: entryClips({ clips: ordered }) };
  await db.put('audiobookManifest', manifest, checksum);
}

export async function getAudiobookManifest(checksum) {
  const db = await getDB();
  return (await db.get('audiobookManifest', checksum)) || { lines: {} };
}

// Total bytes of a book's audio clips (for the manager's storage readout).
export async function audiobookSize(checksum) {
  const manifest = await getAudiobookManifest(checksum);
  let bytes = 0, clips = 0;
  for (const line of Object.keys(manifest.lines)) {
    for (const c of entryClips(manifest.lines[line])) { bytes += c.sizeBytes || 0; clips++; }
  }
  for (const fl of Object.keys(manifest.sections || {})) {
    for (const role of SEC_ROLES) { const c = manifest.sections[fl][role]; if (c) { bytes += c.sizeBytes || 0; clips++; } }
  }
  return { bytes, clips, chunks: Object.keys(manifest.lines).length };
}

// ── Section-boundary extras: one clip per (section, role). role ∈ intro|title|outro. Music (intro/
// outro) is imported audio; the title is a spoken section title (TTS or recorded). One clip per slot
// (setting replaces the old one) — no priority list, unlike chunk clips. `firstLine` = the section's
// first-chunk start line (its stable identity for a given document).
export async function setSectionExtra(checksum, firstLine, role, blob, meta = {}) {
  if (!SEC_ROLES.includes(role)) throw new Error(`bad section role: ${role}`);
  const db = await getDB();
  const id = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  if (!manifest.sections) manifest.sections = {};
  const entry = manifest.sections[firstLine] || {};
  if (entry[role]?.id) { try { await db.delete('audiobook', secBlobKey(checksum, firstLine, role, entry[role].id)); } catch { /* */ } }
  await db.put('audiobook', { blob, durationMs: meta.durationMs || 0, createdAt: now, source: meta.source || 'music', voiceId: meta.voiceId || null, sizeBytes: blob.size }, secBlobKey(checksum, firstLine, role, id));
  entry[role] = { id, source: meta.source || 'music', voiceId: meta.voiceId || null, createdAt: now, durationMs: meta.durationMs || 0, sizeBytes: blob.size };
  if (role === 'title' && meta.titleText != null) entry.titleText = meta.titleText;
  manifest.sections[firstLine] = entry;
  await db.put('audiobookManifest', manifest, checksum);
  return id;
}

export async function deleteSectionExtra(checksum, firstLine, role) {
  const db = await getDB();
  const manifest = await db.get('audiobookManifest', checksum);
  const entry = manifest?.sections?.[firstLine];
  if (!entry?.[role]) return;
  try { await db.delete('audiobook', secBlobKey(checksum, firstLine, role, entry[role].id)); } catch { /* */ }
  delete entry[role];
  if (!SEC_ROLES.some((r) => entry[r])) delete manifest.sections[firstLine];
  await db.put('audiobookManifest', manifest, checksum);
}

export async function getSectionExtraBlob(checksum, firstLine, role, id) {
  const db = await getDB();
  const rec = await db.get('audiobook', secBlobKey(checksum, firstLine, role, id));
  return rec?.blob || null;
}

// ── Notes / annotations ─────────────────────────────────────────────────────────────────────
// Per-document, keyed by content checksum so the same book shares notes across devices. Each note is
// optionally anchored to a wordIndex (null = a general note on the whole document). Deletes are
// tombstones ({ deleted: true }) so they propagate through the union / last-write-wins cloud merge.
export async function getNotes(checksum, includeDeleted = false) {
  if (!checksum) return [];
  const db = await getDB();
  const rec = (await db.get('notes', checksum)) || { notes: [] };
  const list = rec.notes || [];
  return includeDeleted ? list : list.filter((n) => !n.deleted);
}

export async function saveNote(checksum, note) {
  if (!checksum) return null;
  const db = await getDB();
  const rec = (await db.get('notes', checksum)) || { notes: [] };
  const now = Date.now();
  const id = note.id || `n_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const idx = rec.notes.findIndex((n) => n.id === id);
  const merged = {
    id, wordIndex: note.wordIndex ?? null, text: note.text || '', color: note.color || null,
    createdAt: idx >= 0 ? rec.notes[idx].createdAt : now, updatedAt: now, deleted: !!note.deleted,
  };
  if (idx >= 0) rec.notes[idx] = merged; else rec.notes.push(merged);
  await db.put('notes', rec, checksum);
  return merged;
}

export async function deleteNote(checksum, id) {
  const db = await getDB();
  const rec = (await db.get('notes', checksum)) || { notes: [] };
  const i = rec.notes.findIndex((n) => n.id === id);
  if (i >= 0) { rec.notes[i] = { ...rec.notes[i], deleted: true, updatedAt: Date.now() }; await db.put('notes', rec, checksum); }
}

// ── Literary Journey library (the reading tracker) ───────────────────────────────────────────────
// One record per key in the `library` store. Books are keyed `book:<id>` with a soft-delete tombstone
// so removals propagate through the same union / last-write-wins merge the cloud file uses. Reference
// data (authors/genres/subgenres/meta) are LWW singletons; `binding` links app documents (by content
// checksum) to tracker book ids; `ai` holds AI-generated recs/analysis/tree + the cowork instruction.
async function libraryCursor(fn) {
  const db = await getDB();
  let cursor = await db.transaction('library').store.openCursor();
  while (cursor) { fn(cursor.key, cursor.value); cursor = await cursor.continue(); }
}

export async function getLibraryBooks(includeDeleted = false) {
  const out = [];
  await libraryCursor((key, val) => {
    if (typeof key === 'string' && key.startsWith('book:') && (includeDeleted || !val.deleted)) out.push(val);
  });
  return out;
}

export async function saveLibraryBook(book) {
  if (!book?.id) return null;
  const db = await getDB();
  const rec = { ...book, updatedAt: Date.now(), deleted: !!book.deleted };
  try { await db.put('library', rec, `book:${book.id}`); } catch { /* quota — skip */ }
  return rec;
}

export async function deleteLibraryBook(id) {
  const db = await getDB();
  const rec = await db.get('library', `book:${id}`);
  if (rec) await db.put('library', { ...rec, deleted: true, updatedAt: Date.now() }, `book:${id}`);
}

export async function getLibraryRef(kind) {
  const db = await getDB();
  return (await db.get('library', `refs:${kind}`))?.data || null;
}
export async function saveLibraryRef(kind, data) {
  const db = await getDB();
  await db.put('library', { data, updatedAt: Date.now() }, `refs:${kind}`);
}

export async function getBinding() {
  const db = await getDB();
  return (await db.get('library', 'binding'))?.map || {};
}
export async function setBinding(checksum, bookId) {
  if (!checksum) return;
  const db = await getDB();
  const rec = (await db.get('library', 'binding')) || { map: {} };
  if (bookId) rec.map[checksum] = bookId; else delete rec.map[checksum];
  rec.updatedAt = Date.now();
  await db.put('library', rec, 'binding');
  try { window.dispatchEvent(new Event('tachyread-bindings-changed')); } catch { /* non-DOM */ }
  return rec.map;
}

export async function getJourneyAi() {
  const db = await getDB();
  return (await db.get('library', 'ai')) || null;
}
export async function saveJourneyAi(ai) {
  const db = await getDB();
  await db.put('library', { ...ai, updatedAt: Date.now() }, 'ai');
}

// Rough on-disk footprint + live book count for the storage-details readout (cheap cursor walk).
export async function librarySize() {
  let bytes = 0, books = 0;
  await libraryCursor((key, val) => {
    bytes += (typeof key === 'string' ? key.length : 0);
    try { bytes += JSON.stringify(val).length; } catch { /* skip */ }
    if (typeof key === 'string' && key.startsWith('book:') && !val.deleted) books++;
  });
  return { books, bytes };
}

export async function clearLibrary() {
  const db = await getDB();
  await db.clear('library');
}

// A versioned bundle of the whole tracker. Defaults (full: tombstones + refs + ai + binding) feed the
// cloud Drive file; a filtered user export passes its own `books` and can drop deleted/ai/binding.
export async function exportLibraryData(opts = {}) {
  const { includeDeleted = true, includeAi = true, includeBinding = true, books = null } = opts;
  const db = await getDB();
  let bookList = books;
  if (!bookList) {
    bookList = [];
    await libraryCursor((key, val) => {
      if (typeof key === 'string' && key.startsWith('book:') && (includeDeleted || !val.deleted)) bookList.push(val);
    });
  }
  return {
    protocol: 'tachyread-journey', protocolVersion: 1, kind: 'library', generatedAt: Date.now(),
    meta: (await db.get('library', 'meta'))?.data || null,
    books: bookList,
    authors: (await db.get('library', 'refs:authors'))?.data || null,
    genres: (await db.get('library', 'refs:genres'))?.data || null,
    subgenres: (await db.get('library', 'refs:subgenres'))?.data || null,
    goals: (await db.get('library', 'refs:goals'))?.data || null,
    ai: includeAi ? (await db.get('library', 'ai')) || null : null,
    binding: includeBinding ? (await db.get('library', 'binding'))?.map || null : null,
  };
}

// Merge a tracker bundle (from a file or the Drive sync) into the store. Books union by id + LWW by
// updatedAt (tombstones win a delete); refs/meta/ai LWW; binding unions. The dialog normalizes a raw
// library.json into this envelope shape first (deriveId), so here we only require a books[] with ids.
export async function importLibraryData(bundle, opts = {}) {
  const { mode = 'merge' } = opts;
  if (!bundle || !Array.isArray(bundle.books)) throw new Error('Not a Tachyread library file.');
  const db = await getDB();
  const tx = db.transaction('library', 'readwrite');
  const store = tx.store;
  if (mode === 'replace') {
    let cur = await store.openCursor();
    while (cur) {
      if (typeof cur.key === 'string' && (cur.key.startsWith('book:') || cur.key.startsWith('refs:') || cur.key === 'meta')) await cur.delete();
      cur = await cur.continue();
    }
  }
  let added = 0, merged = 0;
  for (const b of bundle.books) {
    if (!b?.id) continue;
    const key = `book:${b.id}`;
    const existing = await store.get(key);
    const incoming = { ...b, updatedAt: b.updatedAt || Date.now(), deleted: !!b.deleted };
    if (!existing) { await store.put(incoming, key); added++; }
    else if ((incoming.updatedAt || 0) >= (existing.updatedAt || 0)) { await store.put(incoming, key); merged++; }
  }
  const stamp = bundle.generatedAt || Date.now();
  for (const [k, val] of [['meta', bundle.meta], ['refs:authors', bundle.authors], ['refs:genres', bundle.genres], ['refs:subgenres', bundle.subgenres], ['refs:goals', bundle.goals]]) {
    if (val == null) continue;
    const existing = await store.get(k);
    if (!existing || stamp >= (existing.updatedAt || 0)) await store.put({ data: val, updatedAt: stamp }, k);
  }
  if (bundle.ai) {
    const existing = await store.get('ai');
    if (!existing || (bundle.ai.updatedAt || 0) >= (existing.updatedAt || 0)) await store.put(bundle.ai, 'ai');
  }
  if (bundle.binding) {
    const existing = (await store.get('binding')) || { map: {} };
    await store.put({ map: { ...existing.map, ...bundle.binding }, updatedAt: Date.now() }, 'binding');
  }
  await tx.done;
  try { window.dispatchEvent(new Event('tachyread-bindings-changed')); } catch { /* non-DOM */ }
  return { added, merged, total: bundle.books.length };
}

// Wipe every clip + the manifest for one book (the manager's confirmation-guarded "delete all audio").
export async function clearAudiobook(checksum) {
  const db = await getDB();
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  for (const line of Object.keys(manifest.lines)) {
    for (const c of entryClips(manifest.lines[line])) await db.delete('audiobook', clipBlobKey(checksum, Number(line), c.id));
    await db.delete('audiobook', legacyBlobKey(checksum, Number(line))); // any stray legacy blob
  }
  for (const fl of Object.keys(manifest.sections || {})) {
    for (const role of SEC_ROLES) { const c = manifest.sections[fl][role]; if (c?.id) await db.delete('audiobook', secBlobKey(checksum, Number(fl), role, c.id)); }
  }
  await db.delete('audiobookManifest', checksum);
}

// ── Audiobook transfer (one book's clips → a file → another device) ────────────────────────────
// Deliberately separate from the cloud progress-sync (which stays progress-only): audiobook audio is
// large binary, so it moves as an explicit file the user carries between devices. Clips are keyed by
// the book's content checksum, so the same book (same text) lines them up automatically on import.
// "Full or partial" falls out for free — it exports whatever clips exist (a half-generated book too).

export async function exportAudiobook(checksum, fileName = '') {
  if (!checksum) throw new Error('No book selected.');
  const db = await getDB();
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  const clips = [];
  for (const li of Object.keys(manifest.lines)) {
    const line = Number(li);
    for (const meta of entryClips(manifest.lines[li])) {
      const rec = await db.get('audiobook', clipBlobKey(checksum, line, meta.id));
      if (rec?.blob) clips.push({ li: line, id: meta.id, source: meta.source, voiceId: meta.voiceId, createdAt: meta.createdAt, durationMs: meta.durationMs, sizeBytes: meta.sizeBytes, blob: await packValue(rec.blob) });
    }
  }
  const sectionClips = [];
  for (const fl of Object.keys(manifest.sections || {})) {
    const firstLine = Number(fl);
    for (const role of SEC_ROLES) {
      const meta = manifest.sections[fl][role];
      if (!meta) continue;
      const rec = await db.get('audiobook', secBlobKey(checksum, firstLine, role, meta.id));
      if (rec?.blob) sectionClips.push({ fl: firstLine, role, id: meta.id, source: meta.source, voiceId: meta.voiceId, createdAt: meta.createdAt, durationMs: meta.durationMs, sizeBytes: meta.sizeBytes, titleText: manifest.sections[fl].titleText || null, blob: await packValue(rec.blob) });
    }
  }
  return { app: 'tachyread-audiobook', version: 3, checksum, fileName, exportedAt: Date.now(), manifest, clips, sectionClips };
}

// Merge an audiobook bundle into this device's store. Keyed by the bundle's own checksum (so it lands
// on the matching book whether or not it's the one currently open). Won't clobber a local mic
// recording. Returns { imported, skipped, checksum }.
export async function importAudiobook(bundle) {
  if (!bundle || bundle.app !== 'tachyread-audiobook' || !bundle.checksum) throw new Error('Not a Tachyread audiobook file.');
  const db = await getDB();
  const { checksum } = bundle;
  const manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  let imported = 0, skipped = 0;
  for (const c of bundle.clips || []) {
    const line = c.li;
    const entry = manifest.lines[line] || {};
    const existing = entryClips(entry);
    const id = c.id || `tts_import_${Math.random().toString(36).slice(2, 9)}`;
    if (existing.some((e) => e.id === id)) { skipped++; continue; } // already have this exact clip
    const now = c.createdAt || Date.now();
    await db.put('audiobook', { blob: unpackValue(c.blob), durationMs: c.durationMs || 0, createdAt: now, source: c.source || 'tts', voiceId: c.voiceId || null, sizeBytes: c.sizeBytes || 0 }, clipBlobKey(checksum, line, id));
    entry.clips = entryClips({ clips: [...existing, { id, source: c.source || 'tts', voiceId: c.voiceId || null, createdAt: now, durationMs: c.durationMs || 0, sizeBytes: c.sizeBytes || 0 }] });
    entry.spanEndLine = entry.spanEndLine != null ? entry.spanEndLine : line;
    delete entry.durationMs; delete entry.source; delete entry.voiceId; delete entry.createdAt;
    manifest.lines[line] = entry;
    imported++;
  }
  for (const c of bundle.sectionClips || []) {
    if (!SEC_ROLES.includes(c.role)) continue;
    if (!manifest.sections) manifest.sections = {};
    const entry = manifest.sections[c.fl] || {};
    if (entry[c.role]?.id === c.id) { skipped++; continue; }
    const now = c.createdAt || Date.now();
    await db.put('audiobook', { blob: unpackValue(c.blob), durationMs: c.durationMs || 0, createdAt: now, source: c.source || 'music', voiceId: c.voiceId || null, sizeBytes: c.sizeBytes || 0 }, secBlobKey(checksum, c.fl, c.role, c.id));
    entry[c.role] = { id: c.id, source: c.source || 'music', voiceId: c.voiceId || null, createdAt: now, durationMs: c.durationMs || 0, sizeBytes: c.sizeBytes || 0 };
    if (c.role === 'title' && c.titleText) entry.titleText = c.titleText;
    manifest.sections[c.fl] = entry;
    imported++;
  }
  await db.put('audiobookManifest', manifest, checksum);
  return { imported, skipped, checksum };
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
  ['focusSessions', true], ['notes', false],
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
  'posUpdatedAt', 'posDevice', // when + where the reading position last moved (newest-wins merge)
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
    device: g.deviceName || '', readstate: {}, files: {}, grabMarkers: {}, audiobookMarkers: {}, notes: {}, bookGroups: g.bookGroups || [],
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
  // Notes / annotations — the whole list (tombstones included) so deletes sync too.
  const noteKeys = await db.getAllKeys('notes');
  const noteVals = await db.getAll('notes');
  for (let i = 0; i < noteKeys.length; i++) {
    const list = noteVals[i]?.notes || [];
    if (list.length) out.notes[noteKeys[i]] = list;
  }
  for (const f of await db.getAll('files')) {
    if (!f?.checksum) continue;
    const rec = { name: f.fileName || nameByChecksum.get(f.checksum) || '' };
    for (const k of PROGRESS_FILE_FIELDS) if (f[k] !== undefined) rec[k] = f[k];
    out.files[f.checksum] = rec;
    // Reusable per-file appearance/behaviour settings (no progress, no identity), LWW by updatedAt.
    out.fileSettings[f.checksum] = { ...tabDefaultsFrom(f), updatedAt: f.updatedAt || 0 };
  }
  for (const gr of await db.getAll('grabbed')) {
    if (!gr?.checksum) continue;
    out.grabMarkers[gr.checksum] = { name: gr.name || 'Grab', createdAt: gr.createdAt || 0, pageCount: gr.segments?.length || 0, device: g.deviceName || '' };
  }
  // Audiobook markers: a lightweight note that this device has generated/recorded narration for a
  // book (how many chunks, mic vs Piper, when) — NOT the audio itself (that moves as an explicit
  // file). Lets another device see "an audiobook exists over there" and prompt to import it.
  const abKeys = await db.getAllKeys('audiobookManifest');
  const abVals = await db.getAll('audiobookManifest');
  for (let i = 0; i < abKeys.length; i++) {
    const lines = abVals[i]?.lines || {};
    const chunkKeys = Object.keys(lines);
    if (!chunkKeys.length) continue;
    let mic = 0, tts = 0, updatedAt = 0;
    // Count by each chunk's ACTIVE (top-priority) clip so the remote comparison stays chunk-based.
    for (const k of chunkKeys) { const top = entryClips(lines[k])[0]; if (!top) continue; if (top.source === 'mic') mic++; else tts++; updatedAt = Math.max(updatedAt, top.createdAt || 0); }
    out.audiobookMarkers[abKeys[i]] = { chunks: chunkKeys.length, mic, tts, updatedAt, device: g.deviceName || '', name: nameByChecksum.get(abKeys[i]) || '' };
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
  // Notes / annotations — union by note id, last-write-wins by updatedAt (a tombstone wins if newer).
  for (const [checksum, incList] of Object.entries(bundle.notes || {})) {
    const tx = db.transaction('notes', 'readwrite');
    const cur = (await tx.store.get(checksum))?.notes || [];
    const byId = new Map(cur.map((n) => [n.id, n]));
    for (const n of incList || []) {
      const prev = byId.get(n.id);
      if (!prev || (n.updatedAt || 0) >= (prev.updatedAt || 0)) byId.set(n.id, n);
    }
    await tx.store.put({ notes: [...byId.values()] }, checksum);
    await tx.done;
    merged++;
  }
  // File progress (resume cursor + persistent counters). The POSITION merges newest-stamp-wins (a
  // rewind or re-read on the most recently used device must win — furthest-wins lost those); when
  // neither side carries a stamp (legacy records) the old furthest-wins stands. A significant
  // disagreement where the NEWER position is BEHIND the older one is genuinely ambiguous (deliberate
  // rewind vs. missed progress?) — the newest is applied so sync never stalls, and the conflict is
  // surfaced (returned + a window event) for the UI to offer a one-click override.
  const conflicts = [];
  for (const [checksum, inc] of Object.entries(bundle.files || {})) {
    const tx = db.transaction('files', 'readwrite');
    const cur = (await tx.store.get(checksum)) || { ...defaultFileSettings() };
    cur.contentChecksum = checksum; cur.checksum = checksum;
    const curPos = cur.wordIndex || 0, incPos = inc.wordIndex || 0;
    const curT = cur.posUpdatedAt || 0, incT = inc.posUpdatedAt || 0;
    const curDev = cur.posDevice || 'this device'; // capture BEFORE the merge overwrites it
    const total = cur.totalWords || inc.totalWords || 0;
    const significant = Math.abs(curPos - incPos) > Math.max(200, total * 0.02);
    if (!curT && !incT) {
      cur.wordIndex = Math.max(curPos, incPos); // legacy: no stamps on either side
    } else if (incT > curT) {
      cur.wordIndex = incPos; cur.posUpdatedAt = incT; cur.posDevice = inc.posDevice || bundle.device || '';
      if (significant && curT && incPos < curPos) {
        conflicts.push({ checksum, name: inc.name || cur.fileName || '', total,
          applied: { pos: incPos, at: incT, device: inc.posDevice || bundle.device || '' },
          other: { pos: curPos, at: curT, device: curDev } });
      }
    } else {
      // local is newest (or tie) — keep it, but flag when the remote was significantly FURTHER.
      if (significant && incT && curPos < incPos) {
        conflicts.push({ checksum, name: inc.name || cur.fileName || '', total,
          applied: { pos: curPos, at: curT, device: curDev },
          other: { pos: incPos, at: incT, device: inc.posDevice || bundle.device || '' } });
      }
    }
    if (!cur.fileName && inc.name) cur.fileName = inc.name; // names travel with progress
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
  // Remote audiobook markers: track, per book, the most-complete narration that exists on ANY other
  // device (so the Audiobook Manager can prompt an import when it's more than we have locally). We
  // compare to the local clip count at display time, so a book we've fully generated here shows no
  // prompt even though our own marker synced out.
  const remoteAb = new Map((g.remoteAudiobooks || []).map((r) => [r.checksum, r]));
  for (const [checksum, inc] of Object.entries(bundle.audiobookMarkers || {})) {
    const prev = remoteAb.get(checksum);
    if (!prev || (inc.chunks || 0) >= (prev.chunks || 0)) {
      remoteAb.set(checksum, { checksum, chunks: inc.chunks || 0, mic: inc.mic || 0, tts: inc.tts || 0, updatedAt: inc.updatedAt || 0, device: inc.device || bundle.device || '', name: inc.name || prev?.name || '', seenAt: Date.now() });
    }
  }
  g.remoteAudiobooks = [...remoteAb.values()];
  g.bookGroups = mergeBookGroups(g.bookGroups, bundle.bookGroups);
  await db.put('global', g, 'settings');
  // Surface position conflicts wherever the sync was triggered from (App listens and shows a
  // deconflict prompt); also PERSISTED because the manual "Restore from sync" path reloads the
  // page right after import — App re-raises any pending ones on boot.
  if (conflicts.length) {
    try { await db.put('global', conflicts, 'syncConflicts'); } catch { /* best-effort */ }
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('tachyread-sync-conflicts', { detail: conflicts })); } catch { /* non-DOM */ }
    }
  }
  return { merged, conflicts };
}

export async function getPendingSyncConflicts() {
  const db = await getDB();
  return (await db.get('global', 'syncConflicts')) || [];
}
export async function clearPendingSyncConflicts() {
  const db = await getDB();
  await db.delete('global', 'syncConflicts');
}

// Resolve a sync position conflict: set the position with a FRESH stamp so the choice wins the next
// merge on every device. Returns the updated record.
export async function applySyncedPosition(checksum, wordIndex, device = '') {
  const db = await getDB();
  const rec = (await db.get('files', checksum)) || { ...defaultFileSettings(), checksum, contentChecksum: checksum };
  rec.wordIndex = wordIndex;
  rec.posUpdatedAt = Date.now();
  rec.posDevice = device;
  await db.put('files', rec);
  return rec;
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
