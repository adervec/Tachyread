// Built-in settings profiles, offered on every settings page's Profiles bar. Each profile's data is
// a PARTIAL patch of that page's settings — loading one changes only the keys it names, leaving the
// rest of your setup alone. Built-ins are read-only: loadable (and save-as-able into a named copy)
// but never updated, renamed or deleted.
//
// The numbers below are chosen from reading research rather than taste, and each is annotated with
// the reason so a future edit knows what it's overriding:
//
//   • Line length — 45–75 characters per line is the long-standing typographic optimum (Bringhurst
//     names 66 as ideal for a single column); Dyson & Haselgrove (2001) measured best comprehension
//     at speed around 55 CPL. Narrow screens can't hold that, and very short measures cost more in
//     return sweeps than they save, so a phone lands near 40 rather than chasing 66.
//   • Line spacing — WCAG 1.4.12 (Text Spacing) requires content to survive a line height of 1.5×;
//     that is the floor here, not the ceiling. Extra leading helps most on small screens, where a
//     return sweep has less horizontal distance to disambiguate the next line.
//   • Type size vs distance — legibility follows ANGULAR size, so the same comfort needs a bigger
//     glyph the further away the screen sits. Typical viewing distances: phone ~30–35 cm, tablet
//     ~40–45 cm, desktop ~55–65 cm. Sizes below track that ratio rather than being picked per taste.
//   • Breaks — the 20-20-20 convention (every 20 minutes, 20 seconds looking ~20 ft away) is the
//     standard optometric guidance for screen work; small screens are held closer and demand more
//     accommodation, so the phone preset breaks a little sooner.
//   • Contrast polarity — positive polarity (dark text on light) measures better for acuity and
//     comprehension under normal room lighting (Buchner & Baumgartner, 2007). In a dim room the
//     same bright panel becomes the glare source, which is why the dim variants invert it rather
//     than treating dark mode as a universal default.
//   • Evening blue light — reducing short-wavelength output in the hours before sleep is the
//     rationale for the warm overlay in the dim/night variants.
import { deepEqual } from './deepEqual.js';

export const BUILTIN_DEVICES = [
  ['desktop', '🖥 Desktop'],
  ['phone', '📱 Phone'],
  ['tablet', '📲 Tablet'],
];

// Ambient-light variants, applied only to the kinds where light actually changes the answer
// (typography + theme). A microphone preset doesn't care how bright the room is.
export const BUILTIN_LIGHT = [
  ['bright', '☀️ Bright / daylight'],
  ['normal', '💡 Normal room'],
  ['dim', '🌙 Dim / night'],
];

// Device-driven typography. Font size and CPL track viewing distance; leading clears the WCAG 1.5×
// floor everywhere and goes further where return sweeps are hardest.
const TAB_DEVICE = {
  desktop: {
    rightPaneFontSize: 13,
    autoFontCpl: 66,          // Bringhurst's single-column ideal — the pane width drives the size
    lineSpacing: 1.5,         // WCAG 1.4.12 floor
    hideRsvpPane: false,
    centerOnCurrent: true,
    linePaneSplit: false,
    currentLineFontSizeBoost: 0,
  },
  phone: {
    rightPaneFontSize: 17,    // held ~30 cm: bigger glyph, same angular size as 13pt at ~60 cm
    autoFontCpl: 40,          // a phone can't hold 66 CPL at a readable size; 40 keeps words whole
    lineSpacing: 1.65,        // short measure = more return sweeps, so more leading to guide them
    hideRsvpPane: true,       // the RSVP pane is cramped beside Lines on a phone
    centerOnCurrent: true,
    linePaneSplit: false,
    currentLineFontSizeBoost: 1,
    showPercentSeparators: true,
  },
  tablet: {
    rightPaneFontSize: 15,    // ~40 cm, between the two
    autoFontCpl: 55,          // Dyson & Haselgrove's best-comprehension-at-speed measure
    lineSpacing: 1.55,
    hideRsvpPane: false,
    centerOnCurrent: true,
    linePaneSplit: false,
    currentLineFontSizeBoost: 0,
  },
};

// Ambient-light layer: polarity, theme and contrast aids. Merged over the device layer.
const TAB_LIGHT = {
  // Daylight/glare: maximum positive-polarity contrast, and a current-line tint strong enough to
  // survive a washed-out screen.
  bright: { themeName: 'High Contrast', currentLineHighlight: true, currentWordStyles: ['Underline', 'Bold'] },
  // Typical indoor light: positive polarity, slightly reduced luminance. Warm Paper trades a little
  // contrast for less glare without crossing into the halation problems of light-on-dark.
  normal: { themeName: 'Warm Paper', currentLineHighlight: true, currentWordStyles: ['Underline'] },
  // Dim room: invert polarity so the panel stops being the brightest thing in the room, and lean on
  // a softer highlight — heavy styling blooms badly on a dark background.
  dim: { themeName: 'Dark', currentLineHighlight: true, currentWordStyles: ['Underline'] },
};

// kind → device → partial patch. Kinds mirror the ProfilesBar `kind` on each page:
// tab (Tab / Default Tab Settings), app (Application), bio (Biometric Controls),
// audio (Audio Settings, global keys), comfort (Comfort & Breaks), typing (Typing Settings).
const DATA = {
  tab: TAB_DEVICE,
  app: {
    desktop: { chipMode: false, autoMinimizeControls: false, gestureControls: false, shakeFullscreen: false, showPerfMeter: false, lazyTabsMobile: false, lockPortrait: false, nightShift: false },
    // Phone: float the face/stats as chips, shrink the dock while playing, swipe navigation,
    // lazy tabs (memory), portrait lock, and the perf meter (throttling shows up on phones).
    phone: { chipMode: true, autoMinimizeControls: true, gestureControls: true, shakeFullscreen: false, showPerfMeter: true, lazyTabsMobile: true, lockPortrait: true, nightShift: false },
    tablet: { chipMode: true, autoMinimizeControls: true, gestureControls: true, shakeFullscreen: false, showPerfMeter: false, lazyTabsMobile: true, lockPortrait: false, nightShift: false },
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
    // 20-20-20: a 20-minute cycle with a 20-second look-away is the optometric convention.
    desktop: { comfort: { enabled: true, breakIntervalMin: 20, microbreakSec: 20, autoBackoff: true } },
    // Held closer, so accommodation fatigues sooner — break at 15.
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

// Kinds whose answer depends on ambient light get device × light variants; the rest stay per-device.
const LIGHT_KINDS = new Set(['tab']);
// The night variants also want the warm overlay, which lives on the application page.
const APP_LIGHT = {
  bright: { nightShift: false },
  normal: { nightShift: false },
  dim: { nightShift: true, nightShiftStrength: 0.35 },
};

export function builtinProfiles(kind) {
  const byDev = DATA[kind];
  if (!byDev) return [];
  const devices = BUILTIN_DEVICES.filter(([id]) => byDev[id]);
  if (!LIGHT_KINDS.has(kind) && kind !== 'app') {
    return devices.map(([id, name]) => ({ name: `${name} (built-in)`, device: id, data: byDev[id], builtin: true }));
  }
  const lightLayer = kind === 'tab' ? TAB_LIGHT : APP_LIGHT;
  const out = [];
  for (const [id, name] of devices) {
    for (const [light, lightName] of BUILTIN_LIGHT) {
      out.push({
        name: `${name} · ${lightName} (built-in)`,
        device: id,
        light,
        data: { ...byDev[id], ...lightLayer[light] },
        builtin: true,
      });
    }
  }
  return out;
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
