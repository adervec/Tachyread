// Lock-screen media controls + background keep-alive for read-aloud (TTS).
//
// Two problems on mobile: (1) a backgrounded/locked tab is throttled and the Web Speech engine
// stops, and (2) there's no way to control playback without unlocking. Both are solved by holding
// a real audio session: a looping (silent) <audio> element keeps the page "playing media" so the
// OS keeps it alive and surfaces lock-screen transport controls, and the Media Session API wires
// those controls (and the notification metadata) to the reader. speechSynthesis itself is still
// browser-dependent when fully locked, but the silent-audio session is what keeps it running in
// practice and is the only route to lock-screen buttons on the web.

// A truly-silent looping WAV (all-zero samples). volume stays 1 so browsers don't treat it as a
// muted element and drop audio focus.
function silentWavUri(seconds = 1, sampleRate = 8000) {
  const n = Math.floor(seconds * sampleRate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  // sample bytes are already zero
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let audio = null;
let unlocked = false;
let keepPlaying = false;

function ensureAudio() {
  if (audio || typeof Audio === 'undefined') return audio;
  audio = new Audio(silentWavUri());
  audio.loop = true;
  audio.setAttribute('aria-hidden', 'true');
  return audio;
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
export function startMediaSession(meta, handlers = {}) {
  const a = ensureAudio();
  keepPlaying = true;
  if (a) {
    try {
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
  if (audio) { try { audio.pause(); } catch { /* ignore */ } }
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = 'none';
  for (const action of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward']) {
    try { navigator.mediaSession.setActionHandler(action, null); } catch { /* ignore */ }
  }
}
