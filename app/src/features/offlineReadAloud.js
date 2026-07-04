// Offline read-aloud driver — same interface as createReadAloud (start/stop/resync/isActive) but
// backed by the audiobook store. It plays CHUNK by chunk (a natural narration unit — see
// audiobookChunks) and does NOT synthesize on the fly (Piper is heavy; that only happens when you
// deliberately pre-generate in the Audiobook Manager):
//   • if the chunk has a stored clip (a mic recording or a pre-generated Piper clip) → play it through
//     the app's gesture-unlocked <audio> element (real media → survives an Android screen lock);
//   • otherwise fall back to the light native Web Speech voice for that chunk (not lock-proof, but no
//     heavy on-device synthesis). The status/coverage nudges you to pre-generate for lock-screen play.

import { getSpeechAudio } from './mediaSession.js';
import { getAudioClip } from '../state/storage.js';
import { audiobookChunks } from '../document/readerDocument.js';

// Stored-clip object URL for a chunk, or null if nothing is generated (we do NOT synthesize here).
async function storedUrl(doc, chunk) {
  const stored = await getAudioClip(doc.contentChecksum, chunk.startLine);
  return stored?.blob ? URL.createObjectURL(stored.blob) : null;
}

// getDoc() → the active doc ({words, lines, wordToLine, contentChecksum}).
export function createOfflineReadAloud({ getDoc, getIndex, setIndex, getVoiceName, getRate, onEnd, onStatus }) {
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
    else url = await storedUrl(doc, chunk).catch(() => null);
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
      // Prefetch the next STORED clip while this one plays (no synthesis).
      const ni = ci + 1;
      if (ni < chunks.length && myGen === gen && active) {
        const promise = storedUrl(doc, chunks[ni]).then((u) => { if (u) urls.add(u); return u; }).catch(() => null);
        prefetch = { ci: ni, promise };
      }
    } else if (text) {
      onStatus?.('native'); // no pre-generated clip → light native voice, no heavy Piper synth
      speakNative(text, advance);
    } else {
      playChunk(ci + 1); // empty chunk
    }
  }

  function start() {
    if (active) return;
    active = true;
    gen++;
    ensureChunks(getDoc());
    playChunk(chunkIndexForWord(getIndex()));
  }
  function stop() {
    active = false;
    gen++;
    const a = getSpeechAudio();
    if (a) { try { a.pause(); a.onended = null; a.onerror = null; } catch { /* ignore */ } }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    prefetch = null;
    for (const u of [...urls]) revoke(u);
  }
  function resync() {
    if (!active) return;
    gen++;
    const a = getSpeechAudio();
    if (a) { try { a.pause(); } catch { /* ignore */ } }
    prefetch = null;
    ensureChunks(getDoc());
    playChunk(chunkIndexForWord(getIndex()));
  }

  return { start, stop, resync, isActive: () => active };
}
