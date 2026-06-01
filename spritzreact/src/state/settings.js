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
    hideSpritzPane: false,
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
    goal: null,
    typing: { enabled: false, caseSensitive: false, stripPunctuation: true, perWordTimeoutMs: 0, runMode: 'seconds', runLimit: 60, soundVolume: 0.4 },
    speaking: { enabled: false, confidence: 'Medium', perWordTimeoutMs: 0, allowPartial: true },
    centerOnCurrent: true,
    lineLongPressMs: 3000, // hold a line this long to jump to it (0 = instant click)
    linePaneSplit: false, // split the Lines pane into before / current line / after zones
    lineAdvanceSound: false, // soft click when the current line changes
    autoSkipHeadersFooters: false,
    properNames: {}, // name → { aliases:[], notes:'' }
    notes: '',
    rating: 0, // 0–5 stars, set on the Book Finished dialog
    tocEntries: [], // persisted custom TOC: [{ wordIndex, title, level }]
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
  };
}
