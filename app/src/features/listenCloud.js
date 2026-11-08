// Pocket listening — the I/O: gather the listen queue's books (text from the saved copy, position,
// stored clips), render the window's missing chunks with Kokoro, mirror the window to the sync target
// (Drive's private app folder, or the Tachyread folder's sync/listen/) with a manifest, and on the
// listening device pull it in. Clips made or pulled here carry tag 'listen', so pruning what has
// been heard never touches a hand-recorded or deliberately generated clip.
// ponytail: positions come from the synced file records, so a chunk counts as heard once the
// reading position (from any device) is past it — no separate "listened" bookkeeping.
import {
  getLibraryRef, getLibraryBooks, getBinding, loadDocPayload, loadFile, getAudiobookManifest, allAudiobookManifests,
  entryClips, addAudioClip, getAudioClipById, deleteAudioClipById,
} from '../state/storage.js';
import { readerDocFromText, audiobookChunks } from '../document/readerDocument.js';
import { queueBooks } from './readingQueues.js';
import { readStatus } from './journeyLibrary.js';
import { createLocalEngine, isKokoro, blobDurationMs } from './localTts.js';
import { getSyncProvider } from './sync/syncProviders.js';
import { planWindow, cloudDiff, behind } from './listenWindow.js';

export const LISTEN_MANIFEST = 'tachyread-listen.json';
export const LISTEN_TAG = 'listen';
const clipName = (cs, line) => `listen-${cs}-${String(line).padStart(5, '0')}.opus`;

// The queue's unfinished books, in order, that this device has the text of — with chunks, position
// and the active clip per chunk ({ ms, bytes, id, tag }).
export async function listenBooks(qid) {
  const [queues, books, map] = await Promise.all([getLibraryRef('queues'), getLibraryBooks(), getBinding()]);
  const q = (queues || []).find((x) => x.id === qid && !x.deleted);
  if (!q) return [];
  const csOf = {};
  for (const [cs, id] of Object.entries(map || {})) if (!csOf[id]) csOf[id] = cs;
  const out = [];
  for (const b of queueBooks(q, books)) {
    const cs = csOf[b.id];
    if (!cs || ['finished', 'abandoned'].includes(readStatus(b))) continue;
    const rec = await loadDocPayload(cs).catch(() => null);
    if (!rec?.fullText) continue;
    const doc = readerDocFromText(rec.fullText, rec.fileName || b.title);
    const manifest = await getAudiobookManifest(cs);
    const clips = {};
    for (const [line, entry] of Object.entries(manifest.lines || {})) {
      const c = entryClips(entry)[0];
      if (c) clips[line] = { ms: c.durationMs || 0, bytes: c.sizeBytes || 0, id: c.id, tag: c.tag || null };
    }
    out.push({ cs, fileName: rec.fileName || b.title, title: b.title, wordIndex: (await loadFile(cs).catch(() => null))?.wordIndex || 0, chunks: audiobookChunks(doc), clips });
  }
  return out;
}

// Render the window's chunks that have no clip yet, in listening order, one at a time.
export async function renderWindow(books, { voice, hours, capBytes, onProgress, shouldStop } = {}) {
  if (!isKokoro(voice)) return 0;
  const todo = planWindow(books, { hours, capBytes }).filter((e) => !e.hasClip);
  if (!todo.length) return 0;
  const engine = createLocalEngine();
  let made = 0;
  try {
    for (const e of todo) {
      if (shouldStop?.()) break;
      const b = books.find((x) => x.cs === e.cs);
      const text = (b.chunks.find((c) => c.startLine === e.startLine)?.text || '').trim();
      if (!text) continue;
      const blob = await engine.synth(text, voice);
      const ms = await blobDurationMs(blob);
      const id = await addAudioClip(e.cs, e.startLine, blob, { source: 'tts', voiceId: voice, durationMs: ms, spanEndLine: e.endLine, tag: LISTEN_TAG });
      b.clips[e.startLine] = { ms, bytes: blob.size, id, tag: LISTEN_TAG };
      onProgress?.({ made: ++made, todo: todo.length, title: b.title });
    }
  } finally { engine.dispose(); }
  return made;
}

async function readManifest(p, conn) {
  const blob = await p.download(conn, LISTEN_MANIFEST);
  if (!blob) return { v: 1, books: {} };
  try { const m = JSON.parse(await blob.text()); return { ...m, books: m.books || {} }; } catch { return { v: 1, books: {} }; }
}
function providerFor(cfg) {
  const p = getSyncProvider(cfg?.provider);
  if (!p?.putFile || !p.supported()) throw new Error('No sync target for listening audio — set one up under Data → Cloud sync.');
  return p;
}

// Mirror the window to the sync target: upload clips the cloud lacks, remove cloud clips that fell
// out of the window (heard, or past the cap), then write the manifest.
export async function pushWindow(books, cfg, { hours, capBytes, voice, device, onProgress } = {}) {
  const p = providerFor(cfg);
  const conn = await p.connect(cfg, { silent: true });
  const cloud = await readManifest(p, conn);
  const { upload, remove } = cloudDiff(planWindow(books, { hours, capBytes }), cloud.books);
  let n = 0;
  for (const e of upload) {
    const b = books.find((x) => x.cs === e.cs);
    const rec = await getAudioClipById(e.cs, e.startLine, b.clips[e.startLine].id);
    if (!rec?.blob) continue;
    const id = await p.putFile(conn, clipName(e.cs, e.startLine), rec.blob);
    (cloud.books[e.cs] ||= { fileName: e.fileName, chunks: {} }).chunks[e.startLine] = { endLine: e.endLine, startWordIndex: e.startWordIndex, endWordIndex: e.endWordIndex, durationMs: e.ms, bytes: rec.blob.size, id };
    onProgress?.({ uploaded: ++n, total: upload.length });
  }
  for (const r of remove) {
    await p.removeFile(conn, r.id);
    delete cloud.books[r.cs].chunks[r.startLine];
    if (!Object.keys(cloud.books[r.cs].chunks).length) delete cloud.books[r.cs];
  }
  Object.assign(cloud, { v: 1, at: Date.now(), voice: voice || cloud.voice || '', device: device || '' });
  await p.upload(conn, LISTEN_MANIFEST, new Blob([JSON.stringify(cloud)], { type: 'application/json' }));
  const chunks = Object.values(cloud.books).reduce((a, b) => a + Object.keys(b.chunks).length, 0);
  const bytes = Object.values(cloud.books).reduce((a, b) => a + Object.values(b.chunks).reduce((x, c) => x + (c.bytes || 0), 0), 0);
  return { uploaded: n, removed: remove.length, chunks, bytes };
}

// On the listening device: fetch the cloud window's clips this device lacks (and hasn't heard).
export async function pullWindow(cfg, { wifiOnly = true, onProgress } = {}) {
  const net = typeof navigator !== 'undefined' ? navigator.connection?.type : undefined;
  if (wifiOnly && net && !['wifi', 'ethernet', 'unknown'].includes(net)) return { got: 0, skipped: `not on Wi-Fi (${net})` };
  const p = providerFor(cfg);
  const conn = await p.connect(cfg, { silent: true });
  const cloud = await readManifest(p, conn);
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  let got = 0, total = 0;
  for (const [cs, b] of Object.entries(cloud.books)) {
    const manifest = await getAudiobookManifest(cs);
    const wordIndex = (await loadFile(cs).catch(() => null))?.wordIndex || 0;
    for (const [line, c] of Object.entries(b.chunks)) {
      if (c.endWordIndex < wordIndex || entryClips(manifest.lines[line]).length) continue; // heard, or have one
      total++;
      const blob = await p.getFile(conn, c.id);
      if (!blob) continue;
      await addAudioClip(cs, +line, blob, { source: 'tts', voiceId: cloud.voice || 'kokoro', durationMs: c.durationMs, spanEndLine: c.endLine, tag: LISTEN_TAG });
      onProgress?.({ got: ++got, total });
    }
  }
  return { got, total, at: cloud.at || 0 };
}

// Drop stored listen clips the reader is past (the text is needed to know each chunk's word range).
export async function pruneHeard() {
  let n = 0;
  for (const m of await allAudiobookManifests()) {
    const listenLines = Object.entries(m.lines || {}).filter(([, e]) => entryClips(e).some((c) => c.tag === LISTEN_TAG));
    if (!listenLines.length) continue;
    const wordIndex = (await loadFile(m.checksum).catch(() => null))?.wordIndex || 0;
    const rec = await loadDocPayload(m.checksum).catch(() => null);
    if (!wordIndex || !rec?.fullText) continue;
    const gone = new Set(behind(audiobookChunks(readerDocFromText(rec.fullText, rec.fileName || '')), wordIndex));
    for (const [line, e] of listenLines) {
      if (!gone.has(+line)) continue;
      for (const c of entryClips(e)) if (c.tag === LISTEN_TAG) { await deleteAudioClipById(m.checksum, +line, c.id); n++; }
    }
  }
  return n;
}
