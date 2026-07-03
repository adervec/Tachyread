// Offline read-aloud driver — same interface as createReadAloud (start/stop/resync/isActive) but
// backed by the audiobook store + Piper (neural WASM TTS). It plays LINE by line:
//   • if the line has a stored clip (a mic recording OR a pre-generated Piper clip) → play it;
//   • otherwise synthesize it with Piper on the fly AND cache it into the store, so the next play
//     (and, crucially, locked-screen playback) is a pure file play with no synthesis to stall.
// Everything plays through the app's gesture-unlocked <audio> element (real media → survives an
// Android screen lock and drives the lock-screen controls). The next line is prepared while the
// current one plays, so playback is near-gapless.

import { synthToBlob } from './piperTts.js';
import { getSpeechAudio } from './mediaSession.js';
import { getAudioClip, saveAudioClip } from '../state/storage.js';

// Rough clip length from a WAV blob (for the manifest display only; playback uses the real audio).
function estMs(blob) {
  return Math.max(200, Math.round(((blob.size - 44) / (22050 * 2)) * 1000));
}

function nextNonEmptyLine(lines, from) {
  for (let i = from; i < lines.length; i++) if (lines[i] && !lines[i].isEmpty && (lines[i].text || '').trim()) return i;
  return lines.length;
}

// Resolve a playable object URL for a line: stored clip first, else synth + cache. Returns null for
// an empty/blank line. Throws only on a hard synth failure.
async function clipUrl(doc, li, voiceId) {
  const stored = await getAudioClip(doc.contentChecksum, li);
  if (stored?.blob) return URL.createObjectURL(stored.blob);
  const text = (doc.lines[li]?.text || '').trim();
  if (!text) return null;
  const blob = await synthToBlob(text, voiceId);
  saveAudioClip(doc.contentChecksum, li, blob, estMs(blob), { source: 'tts', voiceId }).catch(() => {});
  return URL.createObjectURL(blob);
}

// getDoc() → the active doc ({words, lines, wordToLine, contentChecksum}).
export function createOfflineReadAloud({ getDoc, getIndex, setIndex, getVoiceId, getRate, onEnd, onStatus }) {
  let active = false;
  let gen = 0;
  let prefetch = null; // { li, promise }
  const urls = new Set();
  const revoke = (u) => { if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } urls.delete(u); } };

  async function playLine(li) {
    if (!active) return;
    const doc = getDoc();
    const lines = doc?.lines || [];
    li = nextNonEmptyLine(lines, li);
    if (li >= lines.length) { onStatus?.('idle'); stop(); onEnd?.(); return; }
    const voiceId = getVoiceId();
    const myGen = gen;

    let url;
    try {
      if (prefetch && prefetch.li === li) { url = await prefetch.promise; }
      else { onStatus?.('synth'); url = await clipUrl(doc, li, voiceId); }
    } catch {
      onStatus?.('error');
      if (myGen === gen && active) playLine(li + 1);
      return;
    }
    prefetch = null;
    if (myGen !== gen || !active) { revoke(url); return; }
    if (!url) { playLine(li + 1); return; } // blank line

    urls.add(url);
    const a = getSpeechAudio();
    if (!a) { onStatus?.('error'); return; }
    a.loop = false;
    a.src = url;
    a.playbackRate = getRate?.() || 1;
    setIndex(lines[li].startWordIndex); // move the reading position to this line
    const advance = () => {
      if (myGen !== gen || !active) return;
      revoke(url);
      playLine(li + 1);
    };
    a.onended = advance;
    a.onerror = advance;
    onStatus?.('playing');
    try { await a.play(); } catch { /* element is gesture-unlocked; ignore transient */ }

    // Prepare the next line while this one plays.
    const ni = nextNonEmptyLine(lines, li + 1);
    if (ni < lines.length && myGen === gen && active) {
      const promise = clipUrl(doc, ni, voiceId).then((u) => { if (u) urls.add(u); return u; }).catch(() => null);
      prefetch = { li: ni, promise };
    }
  }

  function start() {
    if (active) return;
    active = true;
    gen++;
    const doc = getDoc();
    const li = doc?.wordToLine?.[getIndex()] ?? 0;
    playLine(li);
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
    const doc = getDoc();
    playLine(doc?.wordToLine?.[getIndex()] ?? 0);
  }

  return { start, stop, resync, isActive: () => active };
}
