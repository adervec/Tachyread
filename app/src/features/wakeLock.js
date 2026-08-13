// Keep the screen awake while the app is doing something you're not touching the screen for.
//
// A phone's lock timer only resets on INPUT. Read-aloud, RSVP playback and a narration recording
// all run for many minutes with no taps, so the phone locks — and locking suspends the native Web
// Speech engine outright, which is why read-aloud kept dying mid-sentence.
//
// The Screen Wake Lock API is the fix, with two behaviours that must be handled or it silently
// stops working: the OS releases the lock whenever the page is hidden (so it has to be re-acquired
// on the way back), and a request made WHILE hidden throws rather than queueing.

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

// Should we be holding the lock right now? Pure, so the policy is testable without a browser.
export function shouldKeepAwake({ enabled = true, playing = false, readAloud = false, recording = false } = {}) {
  if (!enabled) return false;
  return !!(playing || readAloud || recording);
}

// One lock for the whole app. Callers just declare what they want held; this reconciles.
let sentinel = null;
let want = false;
let listening = false;

async function acquire() {
  if (!want || sentinel || !wakeLockSupported()) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return; // would throw
  try {
    sentinel = await navigator.wakeLock.request('screen');
    // The OS drops it on hide/lock; clear our handle so the visibility hook can re-take it.
    sentinel.addEventListener?.('release', () => { sentinel = null; });
  } catch {
    sentinel = null; // permission/policy refusal — nothing to do but let the phone lock
  }
}

async function release() {
  const s = sentinel;
  sentinel = null;
  try { await s?.release?.(); } catch { /* already gone */ }
}

// The page coming back into view is the only chance to re-take a lock the OS took away.
function ensureVisibilityHook() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
}

// Declare the desired state; safe to call on every render.
export function setKeepAwake(on) {
  const next = !!on;
  if (next === want) { if (next) acquire(); return; } // re-try a lock the OS may have taken
  want = next;
  if (next) { ensureVisibilityHook(); acquire(); } else release();
}

export const keepAwakeHeld = () => !!sentinel;
