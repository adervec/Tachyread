// FileSettings and GlobalSettings defaults (mirrors WPF FileSettings/GlobalSettings).

export function defaultFileSettings() {
  return {
    wordIndex: 0,
    wpm: 250,
    speedUnit: 'Words',
    darkMode: false,
    themeName: '',
    serif: false,
    guideColor: 'Red',
    showGuideLines: true,
    totalWords: 0,
    persistentWordsRead: 0,
    persistentActiveTimeSecs: 0,
    persistentTotalTimeSecs: 0,
    dailyHistory: [],
    completions: [],
    doubleTimeProperNamesMultiplier: 1.0,
    doubleTimeLongWordsMultiplier: 1.0,
    doubleTimeDigitWordsMultiplier: 1.0,
    doubleTimeSpecialWordsMultiplier: 1.0,
    longWordThreshold: 9,
    showPercentSeparators: false,
    altSentenceColors: false, // mildly alternate the colour of consecutive unread sentences
    textAlignment: 'Left',
    blurLinesBefore: 0,  // READABLE lines above the current one; >0 → the 100 lines beyond are obscured
    blurLinesAfter: 0,   // READABLE lines below the current one; >0 → the 100 lines beyond are obscured
    obscureMode: 'blur', // how the obscured band looks: blur | hide | redact | illegible | translate
    blurGradient: 100,   // blur strength (%): ramps to full over the band's first few lines
    currentLineFontSizeBoost: 0,
    scrollReadPoint: 0,  // scroll-to-read "assume read" line, 0 (top of readable band) .. 1 (bottom)
    hideRsvpPane: false,
    contextWordCount: 0,
    contextWordsBefore: 0,
    contextWordsAfter: 0,
    currentLineHighlight: true, // tint the current line's row in the Lines pane (off = position shown by the word highlight only)
    currentWordStyles: ['Underline'], // combinable: Underline | Bold | Italic | Color | Background | Box | Glow | Overline
    currentWordColor: '', // highlight colour for Color/Background/Box/Glow/Underline styles ('' = theme default)
    currentWordFontDelta: 0, // current-word font-size adjust in points (−3..+3)
    rightPaneFontSize: 12,
    lineSpacing: 1.5, // Lines-pane line-height multiplier
    linesGridH: false, // faint horizontal gridlines on the Lines pane background
    linesGridV: false, // faint vertical gridlines on the Lines pane background
    wordSwaps: {}, // per-document display substitutions: { "word in text": "shown as" } (display only)
    wallText: false, // "wall of text": merge source lines into flowing blocks (newlines → spaces/tabs)
    wallBreakEvery: 0, // in wall mode, also start a new block every N source lines (0 = only sections/%)
    wallJoiner: '', // characters/emoji shown where a source newline was in wall mode ('' = plain space)
    sourceChecks: {}, // ticked checkboxes in html/markdown source sections: { section: [box…] }
    sourceCursor: true, // show the current-word marker on the Source page view
    sourceCursorStyle: 'vortex', // marker look: vortex (invert) | box | underline | highlight
    sourceCursorColor: '', // marker colour for box/underline/highlight ('' = default amber)
    sourcePad: 12, // inner padding (px) of the Source page so text doesn't touch the edge
    faceOpacity: 0.9, // transparency of the floating reader face on mobile (0.15–1)
    statsOpacity: 0.92, // transparency of the floating stats popup on mobile (0.2–1)
    bionicFont: false,
    paragraphBreakSecs: 0,
    lineBreakPauseMs: 0,
    contentChecksum: '',
    highlightORP: false,
    orpColor: '', // ORP letter colour in the Lines pane ('' = theme default, usually red)
    orpStyles: ['Bold'], // combinable Lines-pane ORP looks: Bold | Glow | Pulse | Underline | Box | Background | Larger | Italic | Caps
    statsChip: {}, // stats-chip block toggles (see STATS_CHIP_ITEMS; {} = the default layout)
    orpHorizontalPercent: 0.5,
    rsvpFocus: 'none', // eye-focuser at the ORP: none | fisheye | pulse | converge
    wpmWave: false, // let the pace breathe: sinusoidally fluctuate WPM around the setpoint
    wpmWaveDepth: 0.25, // wave amplitude as a fraction of WPM (0..0.6)
    wpmWavePeriodSec: 18, // seconds per full fast→slow→fast cycle
    autoSkipHeaders: false,
    enableProperNames: false,
    readAloud: false, // integrated TTS: speak from the current position and advance in sync
    audioCtrl: false, // hands-free voice / clap commands active for this tab (VOICE COMMAND toggle)
    // Non-driving "follow" TTS while reading (does NOT set the pace, unlike readAloud):
    //   'off' | 'firstWord' (speak each sentence's first word — a progress marker)
    //   | 'line' (speak the current line; usually cut off by the next line, since TTS lags fast reading)
    ttsFollowMode: 'off',
    annunciateVoice: '', // voice used by read-aloud + TTS reader
    annunciateRate: 0, // -5..+8 → 0.5..2.0×
    hideMode: 'None',
    adaptivePace: false, // comprehension-gated adaptive pacing: periodic cloze probes raise/lower WPM
    surprisalDwell: false, // spend more time on rare/informative words, less on common ones (mean pace preserved)
    surprisalStrength: 1, // 0 = off, 1 = full redistribution
    metronome: { enabled: false, volume: 0.25, subdivision: 1, accentEvery: 0 }, // rhythmic auditory pace cue at the current WPM
    goal: null,
    typing: {
      enabled: false, mode: 'passage', caseSensitive: false,
      // Text transforms so the drill shows exactly what you type. lowercase / noSpecial are opt-in;
      // bypassNonQwerty (on) converts or removes characters a standard QWERTY keyboard can't reach
      // (bullets, ¶, curly quotes, em-dashes, accents…) so book passages are actually typeable.
      lowercase: false, noSpecial: false, bypassNonQwerty: true,
      perWordTimeoutMs: 0, runMode: 'seconds', runLimit: 60, soundVolume: 0.4,
      // Countdown tick in timed runs (accelerates in the final seconds).
      tickClock: false,
      // Per-event sound cues, each a clickSound id or 'off'. Word cues default to the original
      // click/hiss; char and line/sentence/paragraph cues are off until you turn them on.
      sounds: {
        charCorrect: 'off', charWrong: 'off', wordPerfect: 'click', wordError: 'hiss',
        linePerfect: 'off', sentencePerfect: 'off', paragraphPerfect: 'off',
      },
    },
    speaking: { enabled: false, confidence: 'Medium', perWordTimeoutMs: 0, allowPartial: true },
    centerOnCurrent: true,
    lineLongPressMs: 450, // hold a line this long to jump to it — just long enough to reject accidental taps (0 = instant click)
    linePaneSplit: false, // split the Lines pane into before / current line / after zones
    lineAdvanceSound: false, // soft click when the current line changes
    lineSoundKind: 'soft', // which newline sound to play (see features/clickSound.js LINE_SOUNDS)
    autoSkipHeadersFooters: false,
    properNames: {}, // name → { aliases:[], notes:'' }
    properNameSeed: [], // wizard-located cast list [{name, note}] — seeds precise name highlighting
    indexEntries: [], // wizard-built index from the book's printed index: [{ term, pages:[], level }]
    notes: '',
    rating: 0, // 0–5 stars, set on the Book Finished dialog
    tocEntries: [], // persisted custom TOC: [{ wordIndex, title, level }]
    skipRanges: [], // word ranges excluded from the completion % (front/back matter): [{ start, end, label }]
    tocReadStats: {}, // per-section reading stats keyed by start wordIndex: { started, completed }
    tocCollapseCompleted: false, // auto-collapse fully-read sections in the TOC tree
    tocColumns: { // which TOC columns are visible (the name column is always shown)
      startLine: true, startWord: true, startPct: true,
      lenLines: true, lenWords: true, lenPct: true, childPct: true,
      started: true, completed: true, pctRead: true, wpm: true,
    },
    tocBarNumeralStyle: 'none', // none | arabic | roman | words — numeral shown on TOC-bar icons
    tocNumeralRegex: [], // per-tier custom numeral-extraction regex (capture group 1 = numeral)
    // Elaborate styling of the line-view lines that are TOC headings, with a distinct look per
    // tier. 'auto' = use the current theme's heading-style pack; 'off' = plain; or a pack name
    // (classic | rule | terminal | deco | ornate | engraved | neon | retro) to force one.
    tocHeadingStyle: 'auto',
    // Animated faces
    showEyes: false,
    faceCount: 1,
    faceStyles: ['Man', 'Owl', 'Robot'],
    artStyle: 'Cartoon',
    // Reading pointer
    showPointer: false,
    pointerStyle: 'Arrow',
    pointerPlacement: 'Left',
    pointerSize: 16,
    pointerBlinkMs: 0,
  };
}

// Per-document fields (progress, identity, per-book content) that must NOT be copied when setting
// the global Default Tab Settings to match a specific tab — only the reusable appearance/behaviour
// preferences carry over.
const NON_DEFAULT_FIELDS = new Set([
  'wordIndex', 'totalWords', 'contentChecksum', 'fileName',
  'persistentWordsRead', 'persistentActiveTimeSecs', 'persistentTotalTimeSecs',
  'dailyHistory', 'completions', 'rating', 'notes',
  'tocEntries', 'tocReadStats', 'skipRanges', 'sourceChecks',
  'properNames', 'properNameSeed', 'indexEntries', 'goal',
  'updatedAt', 'posUpdatedAt', 'posDevice', // sync stamps — never part of a tab's reusable look
  'sourcePages', 'sourceKind', 'sourceCurSeg', 'sourceMaxSeg', // reading-history source-page summary
]);

export function tabDefaultsFrom(settings) {
  const out = {};
  for (const k of Object.keys(settings || {})) if (!NON_DEFAULT_FIELDS.has(k)) out[k] = settings[k];
  return out;
}

// Which of a tab's reusable settings differ from the given defaults (the user's Default Tab
// Settings). Per-document/progress fields (NON_DEFAULT_FIELDS) are ignored — they always differ.
// Backs the "Tab Settings…" menu badge and the per-setting difference chips inside the dialog.
export function offDefaultKeys(settings, defaults) {
  const cur = tabDefaultsFrom(settings);
  const base = tabDefaultsFrom({ ...defaultFileSettings(), ...(defaults || {}) });
  const out = [];
  for (const k of new Set([...Object.keys(cur), ...Object.keys(base)])) {
    if (JSON.stringify(cur[k]) !== JSON.stringify(base[k])) out.push(k);
  }
  return out.sort();
}
export function countOffDefaultSettings(settings, defaults) {
  return offDefaultKeys(settings, defaults).length;
}

// Global fields that hold user DATA / content (not preferences). An "application settings reset"
// restores every preference to its default but preserves these so a reset never destroys the
// user's library, history, saved work, sync setup, or their separate Default Tab Settings.
export const GLOBAL_DATA_KEYS = new Set([
  'recentFiles', 'ocrTemplates', 'vocabDeck', 'bookGroups', 'remoteGrabs', 'remoteAudiobooks', 'typingPlans', 'elevenLabsKey', 'anthropicKey', 'translateKey', 'settingsProfiles',
  'readingList', 'drillBestSpan', 'bestFlowWpm', 'bestDictationWpm', 'webcamCalib', 'sync',
  'deviceName', 'fileDefaults', 'ambient',
]);

// Reset global preferences to defaults while keeping the user's data (GLOBAL_DATA_KEYS).
export function resetGlobalToDefaults(current) {
  const out = { ...defaultGlobalSettings() };
  for (const k of GLOBAL_DATA_KEYS) if (current && current[k] !== undefined) out[k] = current[k];
  return out;
}

// The slice of global settings that cloud-syncs as "application settings": every preference PLUS the
// Default Tab Settings (fileDefaults). User DATA / libraries (the rest of GLOBAL_DATA_KEYS), device-
// local sync metadata, and the sync timestamp itself stay on the device. bookGroups sync through the
// progress merge instead. Mirrored by isSyncedGlobalKey (which keys, when changed, bump the stamp).
const GLOBAL_SYNC_EXCLUDE = new Set([...GLOBAL_DATA_KEYS, 'settingsUpdatedAt']); // note: keeps fileDefaults
export function isSyncedGlobalKey(k) { return k === 'fileDefaults' || !GLOBAL_SYNC_EXCLUDE.has(k); }
export function syncableGlobalSettings(g) {
  const out = {};
  for (const k of Object.keys(g || {})) if (isSyncedGlobalKey(k)) out[k] = g[k];
  return out;
}

export function defaultGlobalSettings() {
  return {
    // Document language (state/languages.js code) — drives OCR, dictation/read-along speech
    // recognition, and TTS voice matching. The UI itself stays English.
    language: 'en',
    defaultSerifFamily: 'Cambria, Georgia, "Times New Roman", serif',
    defaultSansFamily: 'Segoe UI, Arial, sans-serif',
    // Opt-in: load the full Google Fonts library from Google's CDN on demand. OFF by default
    // because it reveals the reader's IP/usage to Google and needs the network (see PRIVACY.md).
    // Bundled open fonts + the device's installed fonts work offline regardless of this setting.
    enableGoogleFonts: false,
    audioCtrlMode: 'Both', // Voice | Claps | Both
    fileDefaults: defaultFileSettings(),
    recentFiles: [], // {name, checksum, lastOpened}
    // Named settings profiles (device-local): tab = reusable tab-settings snapshots
    // (tabDefaultsFrom), app = application-preference snapshots (syncableGlobalSettings).
    settingsProfiles: { tab: [], app: [] }, // each: { name, data, savedAt }
    ocrTemplates: [], // saved Grab layout templates: { name, regions:[{fx,fy,fw,fh}] }
    tocTierIcons: ['📖', '📑', '📄', '§', '•'], // TOC-bar icon per hierarchy tier (index = level)
    drillBestSpan: 0, // best perceptual-span drill width (words) reached
    bestFlowWpm: 0, // best Flow Writer net output WPM
    bestDictationWpm: 0, // best dictation net output WPM
    vocabDeck: [], // spaced-repetition cards: { word, context, addedAt, reps, interval, ease, due, lastGrade }
    // Comfort & calibration: 20-20-20 eye-rest microbreaks + fatigue-aware speed easing.
    comfort: { enabled: true, breakIntervalMin: 20, microbreakSec: 20, autoBackoff: true },
    // Eye warmup: once-a-day desktop nudge + the last routine the user configured (total minutes and
    // which drills). prompt=false silences the nudge; lastPrompt is a YYYY-MM-DD guard so it fires once/day.
    eyeWarmup: { prompt: true, lastPrompt: '', minutes: 3, exercises: null }, // exercises null = the default set
    // Ambient background soundscape — last-used type + volume. Volume is hard-capped low by the
    // engine (features/ambient.js) so it can never overpower read-aloud / TTS.
    ambient: { type: 'Brown', volume: 0.18 },
    // Cloud sync / backup target. provider: 'localFolder' | 'googleDrive'; driveClientId is the user's
    // own Google OAuth client ID (kept local). lastSync is a timestamp for the UI.
    sync: { provider: 'localFolder', driveClientId: '', lastSync: 0, autoBackup: false, autoBackupMinutes: 30, auto: false },
    // When the syncable application settings (prefs + Default Tab Settings) last changed on this
    // device — the last-write-wins clock for settings sync. Bumped by updateGlobal, never by data churn.
    settingsUpdatedAt: 0,
    deviceName: '', // friendly label this device stamps on synced grab markers (e.g. "Laptop")
    // Book groups: editions of the same book grouped so progress syncs across them as a percentage.
    // { id, name, members:[checksum], createdAt }
    bookGroups: [],
    // Grabs that exist on OTHER devices (markers only — no images/text travel via sync).
    // { checksum, name, createdAt, pageCount, device, seenAt }
    remoteGrabs: [],
    // Audiobooks that exist on OTHER devices (markers only — the audio travels as an explicit file,
    // not via sync). { checksum, chunks, mic, tts, updatedAt, device, name, seenAt }
    remoteAudiobooks: [],
    // Saved typing plans (ordered workouts). { id, name, steps:[{ id, mode, runMode, runLimit, sets, description }] }
    typingPlans: [],
    // Reading list / literary journey scaffolding: per-book shelf overrides keyed by checksum
    // ('reading' | 'finished' | 'toread' | 'paused'). Absent → shelf is inferred from progress.
    readingList: { shelves: {} },
    // Start on the landing page even when tabs are restored: no tab is active on launch, so the
    // last document's text isn't revealed to bystanders until you pick its tab. Default on.
    startOnLanding: true,
    // Defer building a restored tab's document until it's first opened (saves memory, esp. on
    // phones with several large books open). Applied on compact screens; eager on desktop.
    lazyTabsMobile: true,
    // Let the tab strip wrap onto multiple rows instead of scrolling horizontally (desktop, many
    // tabs open). Toggled from the tab right-click menu. Default off = single scrolling row.
    tabBarMultiRow: false,
    // Small bottom-bar readout of how hard the app is working (frame pacing). Useful on phones.
    showPerfMeter: true,
    // Read-aloud auto-stop: pause speech after this many minutes of playback (0 = never).
    ttsAutoStopMin: 0,
    // Read-aloud playback speed multiplier (0.5–2.0), applied to both the native voice and the
    // offline Piper audio. Fine steps so you can nudge it slightly.
    ttsSpeed: 1,
    // Offline neural voice (Piper). When on, read-aloud synthesizes real audio (plays with the
    // screen locked, unlike native TTS which Android suspends). offlineVoiceId '' = auto by language.
    offlineVoice: false,
    offlineVoiceId: '',
    // ElevenLabs cloud TTS (optional audiobook-generation backend). Key stays on this device (a
    // secret — kept out of cloud sync); model + last-used voice remembered for the manager.
    elevenLabsKey: '',
    elevenModel: 'eleven_multilingual_v2',
    elevenVoiceId: '',
    // Anthropic API (optional AI in the Notes suite — summary, analysis, discussion). Key stays on
    // this device (a secret — kept out of cloud sync); model remembered.
    anthropicKey: '',
    anthropicModel: 'claude-sonnet-5',
    // Translation service (optional — powers the "translate" obscure mode + the side-by-side
    // parallel view). Key is a secret and stays on this device; the rest are preferences.
    translateProvider: 'mymemory', // mymemory | google | libre (see features/translateService.js)
    translateKey: '',
    translateEndpoint: '',         // LibreTranslate base URL
    translateTarget: 'ja',         // language the text is translated INTO
    // On a typing run's end, show a grade + final statement and play a grade-matched sound.
    typingEndFanfare: true,
    // Touch gesture navigation (off by default — it can interfere with text selection/scroll):
    // horizontal swipes over the reading area step lines (long swipes step paragraphs).
    gestureControls: false,
    // Webcam hand-gesture controls: open-palm joystick scrolls the Lines pane at variable speed,
    // a wave toggles play/pause. handCalib = { centerY, topY, bottomY } from the calibration.
    // handGestureSet = per-gesture on/off (null → feature defaults; discrete gestures start off).
    // Front-camera features (attention guards, hand gestures) are desktop-only by default —
    // battery/CPU-heavy, and a hand-held phone rarely faces you squarely. Tick to run them on a
    // small screen too. (Eye gestures opt into the camera by themselves and ignore this.)
    mobileCamera: false,
    handGestures: false,
    handCalib: null,
    handGestureSet: null,
    // Per-gesture minimum hold time (ms) for the held discrete hand gestures — raise it to filter
    // accidental flicks. { thumbUp|fist|victory|…: ms }; a missing entry uses DEFAULT_HOLD_MS.
    handHoldMs: null,
    // Eye-gesture controls (Biometric Controls → Eye gestures). Deliberate blinks / winks / eye
    // rolls mapped to commands by how long you hold them. Unlike the other camera features this one
    // runs on mobile too — it's explicitly opt-in, so the battery cost is the user's call.
    //   { on, cue (audio timing cue), cueVolume, rows: [{ kind, minMs, maxMs, commandId, on }] }
    eyeGestures: null,
    // Custom trigger→command maps (Biometric Controls). null → the defaults in commandRegistry.js,
    // which reproduce the original hardcoded behavior. Many triggers may point at one command.
    //   gestureMap: { thumbUp|thumbDown|fist|victory|wave: commandId }  (scroll stays the joystick)
    //   voiceCommands: [{ phrase, commandId }]  (add your own words; matched against the transcript)
    //   clapMap: { 1|2|3: commandId }
    gestureMap: null,
    voiceCommands: null,
    clapMap: null,
    mobileFacePos: null, // {x,y} of the draggable floating face on mobile (null = default corner)
    mobileStatsPos: null, // {x,y} of the draggable floating stats popup on mobile
    mobileGoalPos: null, // {x,y} of the draggable floating goal chip
    mobileTimerPos: null, // {x,y} of the draggable floating timer chip
    bioFeedPos: null, // {x,y} of the draggable Biometric Control Feed popup (null = default corner)
    bioFeedHeight: null, // px height of the feed's event list, set by dragging its resize grip (null = default)
    // Chip mode: on phones the face/stats/goal/timer always float as transparent draggable chips.
    // This turns that same floating-chip layout on for desktop too (the dock face/stats move out to
    // float), so the reading area stays clear.
    chipMode: false,
    // Auto-minimize the controls dock while playing on compact screens, for more text room.
    autoMinimizeControls: false,
    // Shake-to-toggle full-screen reading on phones (devicemotion; iOS asks permission once).
    shakeFullscreen: false,
    // Recently used reading fonts for the top-bar quick picker: [{ stack, label }]
    recentFonts: [],
    // Custom trigger sequences (Biometric Controls): [{ steps: ['g:fist','v:play'], commandId, on }]
    triggerSeqs: [],
    // Disabled clap mappings (preserved, just inert): { 1: true }
    clapOff: {},
    // Show per-hand (left/right) gesture mapping overrides in Biometric Controls
    gestureHands: false,
    // Pause non-TTS playback when the reading text scrolls off-screen (you can't read what you can't
    // see). Read-aloud / typing are exempt. Default on.
    pauseWhenTextHidden: true,
    // AFK guard: the longest pause (seconds) still credited as active reading. Gaps beyond this stop
    // counting toward active time/WPM, and the reading-mode chip drains to idle after it.
    idleGraceSecs: 60,
    // Webcam attention (opt-in, experimental): pause non-TTS reading when the camera can't see you
    // facing the screen with eyes open. Processed entirely on-device; nothing leaves the machine.
    webcamAttention: false,
    // Webcam doze detection (opt-in): stop read-aloud if your eyes stay shut / you're gone a while.
    webcamDoze: false,
    // Away alarm (opt-in): sound an alert if you look away from the screen for this many seconds.
    webcamAwayAlarm: false,
    webcamAwayAlarmSec: 15,
    // Escalating alarm (opt-in): the away alarm starts quiet and swells the longer you stay away.
    webcamEscalatingAlarm: false,
    // Posture nudge (opt-in): a gentle reminder when your face fills too much of the frame (too close).
    webcamDistanceNudge: false,
    // Look-away analytics (opt-in): log focus % / distractions per reading session into the history.
    webcamFocusStats: false,
    // Show a small live camera preview (with a status ring) while a webcam guard is on. Default on
    // so you can confirm framing and that the camera is active.
    webcamPreview: true,
    // Calibrated eye-blink threshold from the calibration step ({ open, closed, threshold }).
    webcamCalib: {},
    // Mobile-only quarter-turn (0 | 90 | 180 | 270) applied to JUST the reader box (Fast Reader /
    // Lines), leaving the menus, tabs and controls upright. Not a full device landscape mode.
    readerRotation: 0,
    // Lock the app to portrait on phones: when physically turned to landscape, the whole app
    // counter-rotates back to portrait instead of reflowing (the browser can't truly lock orientation
    // cross-platform). On by default; toggle off to allow the phone's landscape auto-rotate.
    lockPortrait: true,
    // When on, mouse-wheel / trackpad scrolling over the reader advances/rewinds the reading
    // position instead of scrolling the pane.
    scrollAdvances: false,
    // Focus mode: fullscreen + fade chrome + (Chromium) black out other monitors. focusDim is how
    // dark the other-monitor cover windows are (1 = pure black, lower = dark grey).
    focusMode: false,
    focusDim: 0.92,
  };
}
