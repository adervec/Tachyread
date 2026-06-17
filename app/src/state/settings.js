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
    lineSpacing: 0,
    paraSpacing: 0,
    textAlignment: 'Left',
    blurLinesBefore: 0,
    blurLinesAfter: 0,
    currentLineFontSizeBoost: 0,
    hideRsvpPane: false,
    contextWordCount: 0,
    contextWordsBefore: 0,
    contextWordsAfter: 0,
    currentWordStyles: ['Underline'], // combinable: Underline | Bold | Background | Color | Box
    rightPaneFontSize: 12,
    bionicFont: false,
    paragraphBreakSecs: 0,
    lineBreakPauseMs: 0,
    contentChecksum: '',
    highlightORP: false,
    orpHorizontalPercent: 0.5,
    autoSkipHeaders: false,
    enableProperNames: false,
    readAloud: false, // integrated TTS: speak from the current position and advance in sync
    annunciateVoice: '', // voice used by read-aloud + TTS reader
    annunciateRate: 0, // -5..+8 → 0.5..2.0×
    hideMode: 'None',
    adaptivePace: false, // comprehension-gated adaptive pacing: periodic cloze probes raise/lower WPM
    surprisalDwell: false, // spend more time on rare/informative words, less on common ones (mean pace preserved)
    surprisalStrength: 1, // 0 = off, 1 = full redistribution
    metronome: { enabled: false, volume: 0.25, subdivision: 1, accentEvery: 0 }, // rhythmic auditory pace cue at the current WPM
    goal: null,
    typing: { enabled: false, mode: 'passage', caseSensitive: false, stripPunctuation: true, perWordTimeoutMs: 0, runMode: 'seconds', runLimit: 60, soundVolume: 0.4 },
    speaking: { enabled: false, confidence: 'Medium', perWordTimeoutMs: 0, allowPartial: true },
    centerOnCurrent: true,
    lineLongPressMs: 3000, // hold a line this long to jump to it (0 = instant click)
    linePaneSplit: false, // split the Lines pane into before / current line / after zones
    lineAdvanceSound: false, // soft click when the current line changes
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

export function defaultGlobalSettings() {
  return {
    defaultSerifFamily: 'Cambria, Georgia, "Times New Roman", serif',
    defaultSansFamily: 'Segoe UI, Arial, sans-serif',
    audioCtrlMode: 'Both', // Voice | Claps | Both
    fileDefaults: defaultFileSettings(),
    recentFiles: [], // {name, checksum, lastOpened}
    ocrTemplates: [], // saved Grab layout templates: { name, regions:[{fx,fy,fw,fh}] }
    tocTierIcons: ['📖', '📑', '📄', '§', '•'], // TOC-bar icon per hierarchy tier (index = level)
    drillBestSpan: 0, // best perceptual-span drill width (words) reached
    bestFlowWpm: 0, // best Flow Writer net output WPM
    bestDictationWpm: 0, // best dictation net output WPM
    vocabDeck: [], // spaced-repetition cards: { word, context, addedAt, reps, interval, ease, due, lastGrade }
    // Comfort & calibration: 20-20-20 eye-rest microbreaks + fatigue-aware speed easing.
    comfort: { enabled: true, breakIntervalMin: 20, microbreakSec: 20, autoBackoff: true },
    // Ambient background soundscape — last-used type + volume. Volume is hard-capped low by the
    // engine (features/ambient.js) so it can never overpower read-aloud / TTS.
    ambient: { type: 'Brown', volume: 0.18 },
    // Cloud sync / backup target. provider: 'localFolder' | 'googleDrive'; driveClientId is the user's
    // own Google OAuth client ID (kept local). lastSync is a timestamp for the UI.
    sync: { provider: 'localFolder', driveClientId: '', lastSync: 0, autoBackup: false, autoBackupMinutes: 30 },
    deviceName: '', // friendly label this device stamps on synced grab markers (e.g. "Laptop")
    // Book groups: editions of the same book grouped so progress syncs across them as a percentage.
    // { id, name, members:[checksum], createdAt }
    bookGroups: [],
    // Grabs that exist on OTHER devices (markers only — no images/text travel via sync).
    // { checksum, name, createdAt, pageCount, device, seenAt }
    remoteGrabs: [],
    // Reading list / literary journey scaffolding: per-book shelf overrides keyed by checksum
    // ('reading' | 'finished' | 'toread' | 'paused'). Absent → shelf is inferred from progress.
    readingList: { shelves: {} },
    // Start on the landing page even when tabs are restored: no tab is active on launch, so the
    // last document's text isn't revealed to bystanders until you pick its tab. Default on.
    startOnLanding: true,
    // Defer building a restored tab's document until it's first opened (saves memory, esp. on
    // phones with several large books open). Applied on compact screens; eager on desktop.
    lazyTabsMobile: true,
    // Small bottom-bar readout of how hard the app is working (frame pacing). Useful on phones.
    showPerfMeter: true,
    // Read-aloud auto-stop: pause speech after this many minutes of playback (0 = never).
    ttsAutoStopMin: 0,
    // Touch gesture navigation (off by default — it can interfere with text selection/scroll):
    // horizontal swipes over the reading area step lines (long swipes step paragraphs).
    gestureControls: false,
    // Auto-minimize the controls dock while playing on compact screens, for more text room.
    autoMinimizeControls: false,
    // Pause non-TTS playback when the reading text scrolls off-screen (you can't read what you can't
    // see). Read-aloud / typing are exempt. Default on.
    pauseWhenTextHidden: true,
    // Webcam attention (opt-in, experimental): pause non-TTS reading when the camera can't see you
    // facing the screen with eyes open. Processed entirely on-device; nothing leaves the machine.
    webcamAttention: false,
    // Webcam doze detection (opt-in): stop read-aloud if your eyes stay shut / you're gone a while.
    webcamDoze: false,
    // Show a small live camera preview (with a status ring) while a webcam guard is on. Default on
    // so you can confirm framing and that the camera is active.
    webcamPreview: true,
    // Calibrated eye-blink threshold from the calibration step ({ open, closed, threshold }).
    webcamCalib: {},
  };
}
