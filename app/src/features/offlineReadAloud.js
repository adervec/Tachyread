// Offline read-aloud driver: same interface as createReadAloud (start/stop/resync/isActive) but
// backed by Piper (neural WASM TTS) instead of the native Web Speech engine. Each sentence-sized
// chunk is synthesized to a real WAV and played through the app's gesture-unlocked <audio> element
// — which keeps playing with the screen locked and drives the lock-screen media controls, unlike
// native speechSynthesis (which Android suspends on lock). The next chunk is synthesized while the
// current one plays, so playback is near-gapless after the first.

import { synthToUrl } from './piperTts.js';
import { getSpeechAudio } from './mediaSession.js';

const MAX_CHUNK_WORDS = 40;
function chunkEnd(words, start) {
  const limit = Math.min(words.length, start + MAX_CHUNK_WORDS);
  for (let i = start; i < limit; i++) {
    const last = words[i][words[i].length - 1];
    if (last === '.' || last === '!' || last === '?') return i + 1;
  }
  return limit;
}
function textFor(words, start, end) {
  let t = '';
  for (let i = start; i < end; i++) t += words[i] + (i < end - 1 ? ' ' : '');
  return t;
}

// getVoiceId() → Piper voice id; onStatus('synth'|'playing'|'error'|'idle') for a UI indicator.
export function createOfflineReadAloud({ getWords, getIndex, setIndex, getVoiceId, getRate, onEnd, onStatus }) {
  let active = false;
  let gen = 0;
  let prefetch = null; // { start, promise } for the next chunk
  const urls = new Set();

  function revoke(u) { if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } urls.delete(u); } }

  async function playChunk(start) {
    if (!active) return;
    const words = getWords();
    if (!words.length || start >= words.length - 1) { onStatus?.('idle'); stop(); onEnd?.(); return; }
    const end = chunkEnd(words, start);
    const voiceId = getVoiceId();
    const myGen = gen;

    let url;
    try {
      if (prefetch && prefetch.start === start) { url = await prefetch.promise; }
      else { onStatus?.('synth'); url = await synthToUrl(textFor(words, start, end), voiceId); urls.add(url); }
    } catch {
      onStatus?.('error');
      if (myGen === gen && active) { const n = Math.min(words.length - 1, end); setIndex(n); playChunk(n); }
      return;
    }
    prefetch = null;
    if (myGen !== gen || !active) { revoke(url); return; }

    const a = getSpeechAudio();
    if (!a) { onStatus?.('error'); return; }
    a.loop = false;
    a.src = url;
    a.playbackRate = getRate?.() || 1;
    setIndex(start); // move the reading position to this chunk's first word when it begins
    a.onended = () => {
      if (myGen !== gen || !active) return;
      revoke(url);
      const n = Math.min(words.length - 1, end);
      setIndex(n);
      playChunk(n);
    };
    a.onerror = () => {
      if (myGen !== gen || !active) return;
      revoke(url);
      const n = Math.min(words.length - 1, end);
      setIndex(n);
      playChunk(n);
    };
    onStatus?.('playing');
    try { await a.play(); } catch { /* element is gesture-unlocked; ignore transient */ }

    // Prefetch the following chunk while this one plays.
    if (end < words.length - 1 && myGen === gen && active) {
      const ns = end;
      const promise = synthToUrl(textFor(words, ns, chunkEnd(words, ns)), voiceId).then((u) => { urls.add(u); return u; }).catch(() => null);
      prefetch = { start: ns, promise };
    }
  }

  function start() {
    if (active) return;
    active = true;
    gen++;
    playChunk(getIndex());
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
    playChunk(getIndex());
  }

  return { start, stop, resync, isActive: () => active };
}
