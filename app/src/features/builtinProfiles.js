// Built-in settings profiles optimized per device class (desktop / phone / tablet), offered on
// every settings page's Profiles bar. Each profile's data is a PARTIAL patch of that page's
// settings — loading one changes only the keys it names, leaving the rest of your setup alone.
// Built-ins are read-only: they can be loaded (and saved-as into a named copy) but never updated,
// renamed or deleted.
import { deepEqual } from './deepEqual.js';

export const BUILTIN_DEVICES = [
  ['desktop', '🖥 Desktop (built-in)'],
  ['phone', '📱 Phone (built-in)'],
  ['tablet', '📲 Tablet (built-in)'],
];

// kind → device → partial settings patch. Kinds mirror the ProfilesBar `kind` on each page:
// tab (Tab / Default Tab Settings), app (Application), bio (Biometric Controls),
// audio (Audio Settings, global keys), comfort (Comfort & Breaks), typing (Typing Settings).
const DATA = {
  tab: {
    // Desktop: the factory look — small font, both panes, split available if wanted.
    desktop: { rightPaneFontSize: 12, lineSpacing: 1.5, hideRsvpPane: false, centerOnCurrent: true, linePaneSplit: false, currentLineFontSizeBoost: 0 },
    // Phone: bigger type + looser leading for a small high-DPI screen, Lines-only reading (the
    // Fast Reader pane is cramped on a phone), a slightly boosted current line to anchor the eye.
    phone: { rightPaneFontSize: 17, lineSpacing: 1.7, hideRsvpPane: true, centerOnCurrent: true, linePaneSplit: false, currentLineFontSizeBoost: 1, showPercentSeparators: true },
    // Tablet: between the two — readable arm's-length type, both panes kept.
    tablet: { rightPaneFontSize: 15, lineSpacing: 1.6, hideRsvpPane: false, centerOnCurrent: true, linePaneSplit: false, currentLineFontSizeBoost: 0 },
  },
  app: {
    desktop: { chipMode: false, autoMinimizeControls: false, gestureControls: false, shakeFullscreen: false, showPerfMeter: false, lazyTabsMobile: false, lockPortrait: false },
    // Phone: float the face/stats as chips, shrink the dock while playing, swipe navigation,
    // lazy tabs (memory), portrait lock, and the perf meter (throttling shows up on phones).
    phone: { chipMode: true, autoMinimizeControls: true, gestureControls: true, shakeFullscreen: false, showPerfMeter: true, lazyTabsMobile: true, lockPortrait: true },
    tablet: { chipMode: true, autoMinimizeControls: true, gestureControls: true, shakeFullscreen: false, showPerfMeter: false, lazyTabsMobile: true, lockPortrait: false },
  },
  bio: {
    // Camera guards stay opt-in everywhere; these presets set the device-appropriate envelope.
    desktop: { mobileCamera: false, webcamPreview: true },
    // Phone: hand-held cameras rarely face you squarely and the features are battery-heavy —
    // keep every camera feature off; voice/clap commands still work.
    phone: { mobileCamera: false, handGestures: false, webcamAttention: false, webcamDoze: false, webcamAwayAlarm: false, webcamDistanceNudge: false, webcamFocusStats: false },
    // Tablet: usually propped up facing you — allow the camera features to run if turned on.
    tablet: { mobileCamera: true, webcamPreview: true },
  },
  audio: {
    desktop: { offlineVoice: false, ttsSpeed: 1, ttsAutoStopMin: 0 },
    // Phone/tablet: the offline neural voice keeps read-aloud playing with the screen locked
    // (native TTS is suspended on lock).
    phone: { offlineVoice: true, ttsSpeed: 1, ttsAutoStopMin: 0 },
    tablet: { offlineVoice: true, ttsSpeed: 1, ttsAutoStopMin: 0 },
  },
  comfort: {
    desktop: { comfort: { enabled: true, breakIntervalMin: 20, microbreakSec: 20, autoBackoff: true } },
    // Small screens strain faster — break a little sooner.
    phone: { comfort: { enabled: true, breakIntervalMin: 15, microbreakSec: 20, autoBackoff: true } },
    tablet: { comfort: { enabled: true, breakIntervalMin: 20, microbreakSec: 20, autoBackoff: true } },
  },
  typing: {
    desktop: { typing: { caseSensitive: false, lowercase: false, noSpecial: false, bypassNonQwerty: true } },
    // On-screen keyboards make case/symbols slow — drill plain lowercase words on a phone.
    phone: { typing: { caseSensitive: false, lowercase: true, noSpecial: true, bypassNonQwerty: true } },
    tablet: { typing: { caseSensitive: false, lowercase: false, noSpecial: true, bypassNonQwerty: true } },
  },
};

export function builtinProfiles(kind) {
  const byDev = DATA[kind];
  if (!byDev) return [];
  return BUILTIN_DEVICES.filter(([id]) => byDev[id]).map(([id, name]) => ({ name, device: id, data: byDev[id], builtin: true }));
}

// True when loading `data` (a partial, possibly nested patch) onto `current` would change nothing —
// used to disable a built-in's Load button once it's already in effect. Plain sub-objects compare
// key-by-key so a partial nested patch (e.g. { typing: { lowercase: true } }) matches a fuller
// current object.
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function appliesCleanly(data, current) {
  if (!isObj(data)) return deepEqual(data, current);
  return Object.keys(data).every((k) => (isObj(data[k]) && isObj(current?.[k])
    ? appliesCleanly(data[k], current[k])
    : deepEqual(data[k], current?.[k])));
}
