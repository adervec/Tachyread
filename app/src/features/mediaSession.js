// Lock-screen media controls + background keep-alive for read-aloud (TTS).
//
// Two problems on mobile: (1) a backgrounded/locked tab is throttled and the Web Speech engine
// stops, and (2) there's no way to control playback without unlocking. Both are addressed by
// holding a real audio session: a looping <audio> element carrying an inaudible low tone (NOT pure
// silence — that gets released as "silence" and lets the page suspend on lock) keeps the OS
// treating the page as active media, and the Media Session API wires the lock-screen transport
// controls + notification metadata to the reader.
//
// Platform reality: on Android Chrome this keeps speechSynthesis running with the screen off. iOS
// Safari suspends Web Speech on a full lock regardless of any web technique — there the lock-screen
// controls still work, but for guaranteed locked playback the pre-recorded Audiobook is the path.

// Looping keep-alive WAV. NOT pure silence: a truly-silent (all-zero) track gets classified as
// silence and the browser releases audio focus, so the page (and speechSynthesis) suspends the
// instant the screen locks. A very low-amplitude sub-bass tone (~45 Hz, ~-42 dBFS) is genuinely
// non-silent — it holds audio focus — yet is inaudible on phone speakers/earbuds (which roll off
// hard below ~150 Hz), and during read-aloud the speech masks it anyway.
function keepAliveWavUri(seconds = 3, sampleRate = 8000, freq = 45, amp = 0.008) {
  const n = Math.floor(seconds * sampleRate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  const peak = Math.round(amp * 32767);
  for (let i = 0; i < n; i++) {
    // whole number of cycles across the buffer so the loop point is seamless (no click)
    const s = Math.round(peak * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    v.setInt16(44 + i * 2, s, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let audio = null;
let unlocked = false;
let keepPlaying = false;
let toneActive = false; // is the inaudible keep-alive tone the current session (native TTS mode)?

function ensureAudio() {
  if (audio || typeof Audio === 'undefined') return audio;
  audio = new Audio(keepAliveWavUri());
  audio.loop = true;
  audio.volume = 1;
  audio.setAttribute('aria-hidden', 'true');
  return audio;
}

// Re-assert the keep-alive while read-aloud is playing (e.g. from the lock/visibility handler):
// some browsers pause the element as the screen turns off — kick it back so the session holds.
export function nudgeMediaKeepAlive() {
  if (toneActive && audio && audio.paused) { try { audio.play().catch(() => {}); } catch { /* ignore */ } }
}

// The gesture-UNLOCKED <audio> element. Offline (Piper) read-aloud plays its synthesized speech
// through this same element — since it was already unlocked on the first tap, playback works
// without a fresh user gesture (the synth delay would otherwise let the activation expire), and a
// real audio element playing real speech is exactly what survives an Android screen lock.
export function getSpeechAudio() {
  return ensureAudio();
}

// Arm the background keep-alive: prime the silent audio element on the first user gesture so its
// later play() calls (which happen inside a React effect, NOT directly in a gesture) are allowed
// by the autoplay policy. MUST be called eagerly (app mount) — if we wait until read-aloud starts,
// the priming play() runs after the tap's gesture has ended and is rejected, so the keep-alive
// never holds the page alive when the screen locks. Idempotent.
export function armMediaKeepAlive() {
  const a = ensureAudio();
  if (!a || unlocked) return;
  const unlock = () => {
    a.play().then(() => { unlocked = true; if (!keepPlaying) a.pause(); }).catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchend', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchend', unlock, { once: true });
}

export function mediaSessionSupported() {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

function setMeta({ title, artist, album }) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: title || 'Reading', artist: artist || '', album: album || 'Tachyread' });
  } catch { /* some engines reject certain fields */ }
}

// handlers: { onPlay, onPause, onNext, onPrev, onSeekForward, onSeekBackward }
// keepAlive: play the inaudible tone to hold the session. Skip it for offline (Piper) mode — there
// the real synthesized speech plays through the same element and IS the session.
export function startMediaSession(meta, handlers = {}, { keepAlive = true } = {}) {
  const a = ensureAudio();
  keepPlaying = true;
  toneActive = keepAlive;
  if (a && keepAlive) {
    try {
      a.loop = true;
      a.currentTime = 0;
      const p = a.play();
      // If the element isn't unlocked yet (read-aloud started before any gesture registered),
      // retry once on the next gesture so the keep-alive still comes up.
      if (p && p.catch) p.catch(() => { armMediaKeepAlive(); });
    } catch { /* ignore */ }
  }
  if (!('mediaSession' in navigator)) return;
  setMeta(meta);
  navigator.mediaSession.playbackState = 'playing';
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn || null); } catch { /* unsupported action */ } };
  set('play', handlers.onPlay);
  set('pause', handlers.onPause);
  set('stop', handlers.onPause);
  set('nexttrack', handlers.onNext);
  set('previoustrack', handlers.onPrev);
  set('seekforward', handlers.onSeekForward);
  set('seekbackward', handlers.onSeekBackward);
}

export function updateMediaSession(meta) {
  if (keepPlaying) setMeta(meta);
}

export function stopMediaSession() {
  keepPlaying = false;
  if (audio && toneActive) { try { audio.pause(); } catch { /* ignore */ } }
  toneActive = false;
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = 'none';
  for (const action of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward']) {
    try { navigator.mediaSession.setActionHandler(action, null); } catch { /* ignore */ }
  }
}
