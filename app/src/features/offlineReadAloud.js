// Offline read-aloud driver — same interface as createReadAloud (start/stop/resync/isActive) but
// backed by the audiobook store. It plays CHUNK by chunk (a natural narration unit — see
// audiobookChunks) and does NOT synthesize on the fly (Piper is heavy; that only happens when you
// deliberately pre-generate in the Audiobook Manager):
//   • if the chunk has a stored clip (a mic recording or a pre-generated Piper clip) → play it through
//     the app's gesture-unlocked <audio> element (real media → survives an Android screen lock);
//   • otherwise fall back to the light native Web Speech voice for that chunk (not lock-proof, but no
//     heavy on-device synthesis). The status/coverage nudges you to pre-generate for lock-screen play.
//   • …unless "fill gaps with Kokoro" is on (getLiveVoice → a kokoro: voice): then a chunk with no
//     clip is synthesized on the device as you reach it (the next one while this one plays) and SAVED
//     as a clip, so each chunk is generated once. A failed synthesis still falls back to native.
//   • a book synced to YOUR audiobook (Audio → Sync My Audiobook) plays those files instead: from the
//     time mapped to the reading position, with the position following the audio's word map.

import { getSpeechAudio } from './mediaSession.js';
import { getAudioClip, addAudioClip, getAudioSync, getSyncFile } from '../state/storage.js';
import { timeForWord, wordForTime } from './audioSync.js';
import { createLocalEngine, isKokoro, blobDurationMs } from './localTts.js';
import { audiobookChunks } from '../document/readerDocument.js';

// Stored-clip object URL for a chunk, or null if nothing is generated (we do NOT synthesize here).
async function storedUrl(doc, chunk) {
  const stored = await getAudioClip(doc.contentChecksum, chunk.startLine);
  return stored?.blob ? URL.createObjectURL(stored.blob) : null;
}

// getDoc() → the active doc ({words, lines, wordToLine, contentChecksum}).
export function createOfflineReadAloud({ getDoc, getIndex, setIndex, getVoiceName, getRate, onEnd, onStatus, getLiveVoice }) {
  let engine = null; // Kokoro, created on first gap-fill and kept for the driver's life (model stays loaded)
  // A chunk's audio: its stored clip, else (gap-fill on) a fresh Kokoro synthesis saved as its clip.
  async function chunkUrl(doc, chunk) {
    const u = await storedUrl(doc, chunk).catch(() => null);
    const voice = getLiveVoice?.();
    if (u || !isKokoro(voice) || !(chunk.text || '').trim()) return u;
    try {
      const blob = await (engine ||= createLocalEngine()).synth(chunk.text.trim(), voice);
      await addAudioClip(doc.contentChecksum, chunk.startLine, blob, { source: 'tts', voiceId: voice, durationMs: await blobDurationMs(blob), spanEndLine: chunk.endLine });
      return URL.createObjectURL(blob);
    } catch { return null; }
  }
  let active = false;
  let gen = 0;
  let prefetch = null; // { ci, promise }
  let chunks = null;
  let chunksDoc = null;
  const urls = new Set();
  const revoke = (u) => { if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } urls.delete(u); } };

  // Speak a chunk with the browser's native voice (light) when it has no pre-generated clip.
  function speakNative(text, onDone) {
    const synth = typeof window !== 'undefined' && window.speechSynthesis;
    if (!synth) { onDone(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.max(0.5, Math.min(2, getRate?.() || 1));
    const name = getVoiceName?.();
    if (name) { const v = synth.getVoices().find((x) => x.name === name); if (v) u.voice = v; }
    u.onend = onDone; u.onerror = onDone;
    try { synth.cancel(); synth.speak(u); } catch { onDone(); }
  }

  function ensureChunks(doc) {
    if (doc !== chunksDoc) { chunks = doc ? audiobookChunks(doc) : []; chunksDoc = doc; }
    return chunks;
  }
  // First chunk at or after a word index (chunks are ordered by word position).
  function chunkIndexForWord(wi) {
    if (!chunks || !chunks.length) return 0;
    for (let i = 0; i < chunks.length; i++) if (wi <= chunks[i].endWordIndex) return i;
    return chunks.length - 1;
  }

  async function playChunk(ci) {
    if (!active) return;
    const doc = getDoc();
    ensureChunks(doc);
    if (!chunks.length || ci >= chunks.length) { onStatus?.('idle'); stop(); onEnd?.(); return; }
    const chunk = chunks[ci];
    const myGen = gen;
    setIndex(chunk.startWordIndex); // move the reading position to this chunk

    let url;
    if (prefetch && prefetch.ci === ci) url = await prefetch.promise;
    else {
      if (isKokoro(getLiveVoice?.())) onStatus?.('synth');
      url = await chunkUrl(doc, chunk);
    }
    prefetch = null;
    if (myGen !== gen || !active) { revoke(url); return; }

    const advance = () => { if (myGen !== gen || !active) return; revoke(url); playChunk(ci + 1); };
    const text = (chunk.text || '').trim();

    if (url) {
      urls.add(url);
      const a = getSpeechAudio();
      if (!a) { onStatus?.('error'); return; }
      a.loop = false;
      a.src = url;
      a.playbackRate = getRate?.() || 1;
      a.onended = advance;
      a.onerror = advance;
      onStatus?.('playing');
      try { await a.play(); } catch { /* element is gesture-unlocked; ignore transient */ }
      prefetchNext(doc, ci, myGen);
    } else if (text) {
      onStatus?.('native'); // no pre-generated clip → light native voice, no heavy Piper synth
      speakNative(text, advance);
      prefetchNext(doc, ci, myGen);
    } else {
      playChunk(ci + 1); // empty chunk
    }
  }

  // Get the next chunk's audio ready while this one plays (a stored clip, or a Kokoro gap-fill).
  function prefetchNext(doc, ci, myGen) {
    const ni = ci + 1;
    if (ni >= chunks.length || myGen !== gen || !active) return;
    const promise = chunkUrl(doc, chunks[ni]).then((u) => { if (u) urls.add(u); return u; }).catch(() => null);
    prefetch = { ci: ni, promise };
  }

  // ── synced audiobook mode ──
  let sync = null, syncDoc = null, syncFile = -1, syncUrl = null;
  async function loadSync(doc) {
    if (doc !== syncDoc) { syncDoc = doc; sync = await getAudioSync(doc?.contentChecksum).catch(() => null); }
    return sync?.anchors?.length ? sync : null;
  }
  async function playSynced(s, fileIndex, ms) {
    const myGen = gen;
    const a = getSpeechAudio();
    if (!a) { onStatus?.('error'); return; }
    if (fileIndex !== syncFile || !syncUrl) {
      const blob = await getSyncFile(getDoc().contentChecksum, fileIndex);
      if (myGen !== gen || !active) return;
      if (!blob) { onStatus?.('error'); return; }
      revoke(syncUrl); syncUrl = URL.createObjectURL(blob); urls.add(syncUrl); syncFile = fileIndex;
      a.src = syncUrl;
      await new Promise((r) => { a.onloadedmetadata = r; a.onerror = r; });
      if (myGen !== gen || !active) return;
    }
    a.loop = false;
    a.playbackRate = getRate?.() || 1;
    a.currentTime = Math.max(0, ms / 1000);
    a.ontimeupdate = () => {
      if (myGen !== gen || !active) return;
      const wi = wordForTime(s.anchors, fileIndex, a.currentTime * 1000);
      if (wi != null && wi > getIndex()) setIndex(wi);
    };
    a.onended = () => {
      if (myGen !== gen || !active) return;
      if (fileIndex + 1 < s.files.length) playSynced(s, fileIndex + 1, 0);
      else { onStatus?.('idle'); stop(); onEnd?.(); }
    };
    onStatus?.('playing');
    try { await a.play(); } catch { /* gesture-unlocked element; ignore transient */ }
  }
  async function begin() {
    const doc = getDoc();
    const s = await loadSync(doc);
    if (!active) return;
    if (s) { const t = timeForWord(s.anchors, getIndex()); playSynced(s, t.file, t.ms); return; }
    ensureChunks(doc);
    playChunk(chunkIndexForWord(getIndex()));
  }

  function start() {
    if (active) return;
    active = true;
    gen++;
    begin();
  }
  function stop() {
    active = false;
    gen++;
    const a = getSpeechAudio();
    if (a) { try { a.pause(); a.onended = null; a.onerror = null; a.ontimeupdate = null; } catch { /* ignore */ } }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    prefetch = null;
    for (const u of [...urls]) revoke(u);
    syncUrl = null; syncFile = -1;
  }
  function resync() {
    if (!active) return;
    gen++;
    const a = getSpeechAudio();
    if (a) { try { a.pause(); } catch { /* ignore */ } }
    prefetch = null;
    begin(); // synced audio seeks to the new position; generated clips restart at its chunk
  }

  return { start, stop, resync, isActive: () => active };
}
