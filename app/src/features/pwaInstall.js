// PWA install plumbing. Chrome fires `beforeinstallprompt` exactly once per page load and only
// while the app is installable — miss it and the prompt is gone, so it's captured at module load
// (before React mounts) and held for whenever the user asks. Subscribers re-render off the state.
//
// State: 'ready' (we hold a prompt — installable right now) | 'installed' (running standalone or
// just installed) | 'unavailable' (browser never offered one: already installed in another window,
// an unsupported browser like Firefox/Safari desktop, or criteria not met).

let deferred = null;
let state = 'unavailable';
const subs = new Set();

const emit = () => { for (const fn of subs) { try { fn(state); } catch { /* subscriber's problem */ } } };

export function installState() { return state; }
export function subscribeInstall(fn) { subs.add(fn); return () => subs.delete(fn); }

// Already running as an installed app? Then there's nothing to offer.
export function runningStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.matchMedia?.('(display-mode: minimal-ui)')?.matches
    || window.navigator?.standalone === true;
}

export function initPwaInstall() {
  if (typeof window === 'undefined') return;
  if (runningStandalone()) { state = 'installed'; emit(); }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();       // keep Chrome's mini-infobar out of the way…
    deferred = e;             // …and hold the prompt for the menu item
    state = 'ready';
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; state = 'installed'; emit(); });
}

// Show the browser's install dialog. Returns 'accepted' | 'dismissed' | 'unavailable'.
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null; // a prompt can only be used once
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== 'accepted') { state = 'unavailable'; emit(); } // Chrome re-fires it on a later load
    return outcome;
  } catch {
    state = 'unavailable';
    emit();
    return 'dismissed';
  }
}

// What to tell the user when no prompt is available — the browser decides installability, so this
// explains the likely reason rather than pretending the app is broken.
export function installHelp() {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent || '';
  if (/Firefox/.test(ua)) return 'Firefox has no install prompt — use a Chromium browser (Chrome, Edge, Brave) to install Tachyread as an app.';
  if (/^((?!chrome|android).)*safari/i.test(ua)) return 'In Safari, use Share → Add to Dock (macOS) or Add to Home Screen (iOS).';
  return 'Your browser has not offered an install prompt yet. If Tachyread is already installed, open it from your apps — otherwise reload the page and try again (Chrome re-offers it on a later visit).';
}
