// IndexedDB-backed persistence using `idb`. Mirrors the WPF settings.json/global.json files
// but keyed by content checksum so renamed/moved files keep their progress.

import { openDB } from 'idb';
import { defaultGlobalSettings } from './settings.js';

const DB_NAME = 'SPRITZReader';
const DB_VERSION = 4;

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

// Audiobook clips
export async function saveAudioClip(checksum, lineIndex, blob, durationMs) {
  const db = await getDB();
  const key = `${checksum}/${String(lineIndex).padStart(5, '0')}`;
  await db.put('audiobook', { blob, durationMs, createdAt: Date.now() }, key);
  // Update manifest
  let manifest = (await db.get('audiobookManifest', checksum)) || { lines: {} };
  manifest.lines[lineIndex] = { durationMs, createdAt: Date.now() };
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

export async function exportDatabase() {
  const db = await getDB();
  const out = { files: await db.getAll('files'), global: await db.get('global', 'settings') };
  return JSON.stringify(out, null, 2);
}
