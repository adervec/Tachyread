// Offline read-aloud driver — same interface as createReadAloud (start/stop/resync/isActive) but
// backed by the audiobook store + Piper (neural WASM TTS). It plays CHUNK by chunk, where a chunk is
// a natural narration unit (a sentence / paragraph coalesced from the raw wrapped lines — see
// audiobookChunks). Synthesizing whole sentences instead of per-line fragments is what keeps the
// audio from sounding choppy on hard-wrapped documents.
//   • if the chunk's start line has a stored clip (a mic recording OR a pre-generated Piper clip) → play it;
//   • otherwise synthesize the chunk text with Piper on the fly AND cache it (keyed by the start line),
//     so the next play (and, crucially, locked-screen playback) is a pure file play with no synthesis.
// Everything plays through the app's gesture-unlocked <audio> element (real media → survives an
// Android screen lock and drives the lock-screen controls). The next chunk is prepared while the
// current one plays, so playback is near-gapless.

import { synthToBlob } from './piperTts.js';
import { getSpeechAudio } from './mediaSession.js';
import { getAudioClip, saveAudioClip } from '../state/storage.js';
import { audiobookChunks } from '../document/readerDocument.js';

// Rough clip length from a WAV blob (for the manifest display only; playback uses the real audio).
function estMs(blob) {
  return Math.max(200, Math.round(((blob.size - 44) / (22050 * 2)) * 1000));
}

// Resolve a playable object URL for a chunk: stored clip (keyed by start line) first, else synth +
// cache. Returns null for an empty chunk. Throws only on a hard synth failure.
async function chunkUrl(doc, chunk, voiceId) {
  const stored = await getAudioClip(doc.contentChecksum, chunk.startLine);
  if (stored?.blob) return URL.createObjectURL(stored.blob);
  const text = (chunk.text || '').trim();
  if (!text) return null;
  const blob = await synthToBlob(text, voiceId);
  saveAudioClip(doc.contentChecksum, chunk.startLine, blob, estMs(blob), { source: 'tts', voiceId, spanEndLine: chunk.endLine }).catch(() => {});
  return URL.createObjectURL(blob);
}

// getDoc() → the active doc ({words, lines, wordToLine, contentChecksum}).
export function createOfflineReadAloud({ getDoc, getIndex, setIndex, getVoiceId, getRate, onEnd, onStatus }) {
  let active = false;
  let gen = 0;
  let prefetch = null; // { ci, promise }
  let chunks = null;
  let chunksDoc = null;
  const urls = new Set();
  const revoke = (u) => { if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } urls.delete(u); } };

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
    const voiceId = getVoiceId();
    const myGen = gen;

    let url;
    try {
      if (prefetch && prefetch.ci === ci) { url = await prefetch.promise; }
      else { onStatus?.('synth'); url = await chunkUrl(doc, chunk, voiceId); }
    } catch {
      onStatus?.('error');
      if (myGen === gen && active) playChunk(ci + 1);
      return;
    }
    prefetch = null;
    if (myGen !== gen || !active) { revoke(url); return; }
    if (!url) { playChunk(ci + 1); return; } // empty chunk

    urls.add(url);
    const a = getSpeechAudio();
    if (!a) { onStatus?.('error'); return; }
    a.loop = false;
    a.src = url;
    a.playbackRate = getRate?.() || 1;
    setIndex(chunk.startWordIndex); // move the reading position to this chunk
    const advance = () => {
      if (myGen !== gen || !active) return;
      revoke(url);
      playChunk(ci + 1);
    };
    a.onended = advance;
    a.onerror = advance;
    onStatus?.('playing');
    try { await a.play(); } catch { /* element is gesture-unlocked; ignore transient */ }

    // Prepare the next chunk while this one plays.
    const ni = ci + 1;
    if (ni < chunks.length && myGen === gen && active) {
      const promise = chunkUrl(doc, chunks[ni], voiceId).then((u) => { if (u) urls.add(u); return u; }).catch(() => null);
      prefetch = { ci: ni, promise };
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
