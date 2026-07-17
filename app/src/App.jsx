import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppProvider, useApp } from './state/AppContext.jsx';
import MenuBar from './components/MenuBar.jsx';
import TabBar from './components/TabBar.jsx';
import RsvpPane from './components/RsvpPane.jsx';
import DashboardPane from './components/DashboardPane.jsx';
import FloatingFace from './components/FloatingFace.jsx';
import FloatingStats from './components/FloatingStats.jsx';
import FloatingGoal from './components/FloatingGoal.jsx';
import FloatingTimer from './components/FloatingTimer.jsx';
import SourcePane from './components/SourcePane.jsx';
import LinePane from './components/LinePane.jsx';
import ControlsBar from './components/ControlsBar.jsx';
import TocPane from './components/TocPane.jsx';
import ChapterHeading from './components/ChapterHeading.jsx';
import PaneLayout from './components/PaneLayout.jsx';
import ReaderRotator from './components/ReaderRotator.jsx';
import FaceStage from './components/FaceStage.jsx';
import PerfMonitor from './components/PerfMonitor.jsx';
import { useIsCompact, deviceKind, isCompactScreen } from './state/device.js';
import BiometricFeed from './components/BiometricFeed.jsx';
import TypingRun from './components/TypingRun.jsx';
import FindDialog from './dialogs/FindDialog.jsx';
import GoToLineDialog from './dialogs/GoToLineDialog.jsx';
import SettingsDialog from './dialogs/SettingsDialog.jsx';
import StatisticsDialog from './dialogs/StatisticsDialog.jsx';
import ProperNamesDialog from './dialogs/ProperNamesDialog.jsx';
import AudiobookDialog from './dialogs/AudiobookDialog.jsx';
import NotesDialog from './dialogs/NotesDialog.jsx';
import FootnoteOverlay from './dialogs/FootnoteOverlay.jsx';
import TtsPopupDialog from './dialogs/TtsPopupDialog.jsx';
import FaceLibraryDialog from './dialogs/FaceLibraryDialog.jsx';
import TypingProgressDialog from './dialogs/TypingProgressDialog.jsx';
import AppSettingsDialog from './dialogs/AppSettingsDialog.jsx';
import BookFinishedDialog from './dialogs/BookFinishedDialog.jsx';
import GrabWizard from './dialogs/GrabWizard.jsx';
import WebGrabWizard from './dialogs/WebGrabWizard.jsx';
import HtmlStructureWizard from './dialogs/HtmlStructureWizard.jsx';
import HtmlToolsDialog from './dialogs/HtmlToolsDialog.jsx';
import ApiUsageDialog from './dialogs/ApiUsageDialog.jsx';
import TocWizard from './dialogs/TocWizard.jsx';
import ResourceWizard from './dialogs/ResourceWizard.jsx';
import IndexPane from './components/IndexPane.jsx';
import { buildProperNamesFromList } from './document/resourceWizard.js';
import { createEngine, wordDurationMs } from './engine/rsvpEngine.js';
import { createModeDetector } from './engine/readingMode.js';
import { startMediaSession, updateMediaSession, stopMediaSession, armMediaKeepAlive, nudgeMediaKeepAlive, getSpeechAudio } from './features/mediaSession.js';
import DisclaimerDialog from './dialogs/DisclaimerDialog.jsx';
import AdaptiveProbe from './components/AdaptiveProbe.jsx';
import { computeSurprisalWeights } from './engine/surprisal.js';
import SpanDrillDialog from './dialogs/SpanDrillDialog.jsx';
import EyeWarmupDialog from './dialogs/EyeWarmupDialog.jsx';
import TypingSettingsDialog from './dialogs/TypingSettingsDialog.jsx';
import AudioSettingsDialog from './dialogs/AudioSettingsDialog.jsx';
import BiometricControlsDialog from './dialogs/BiometricControlsDialog.jsx';
import ComfortSettingsDialog from './dialogs/ComfortSettingsDialog.jsx';
import ImportDialog from './dialogs/ImportDialog.jsx';
import FontManagerDialog from './dialogs/FontManagerDialog.jsx';
import HelpDialog from './dialogs/HelpDialog.jsx';
import FlowWriterDialog from './dialogs/FlowWriterDialog.jsx';
import VocabDialog from './dialogs/VocabDialog.jsx';
import RegressionDialog from './dialogs/RegressionDialog.jsx';
import ProgressDetailDialog from './dialogs/ProgressDetailDialog.jsx';
import { fmtTime, fmtDateTime } from './features/dateFmt.js';
import DictationDialog from './dialogs/DictationDialog.jsx';
import AttentionDialog from './dialogs/AttentionDialog.jsx';
import AmbientDialog from './dialogs/AmbientDialog.jsx';
import DataDialog from './dialogs/DataDialog.jsx';
import BookGroupsDialog from './dialogs/BookGroupsDialog.jsx';
import LiteraryJourneyDialog from './dialogs/LiteraryJourneyDialog.jsx';
import ComfortMonitor from './components/ComfortMonitor.jsx';
import { getLineIndex, getParagraphRange, detectProperNames, audiobookChunks } from './document/readerDocument.js';
import { getTocEntries, sectionSpan, mergeSkipRanges, currentChapter } from './document/toc.js';
import { defaultFileSettings, tabDefaultsFrom } from './state/settings.js';
import { cancelSpeech, speak, setPreferredLanguage } from './features/tts.js';
import { getLanguage } from './state/languages.js';
import TypingPlanDialog from './dialogs/TypingPlanDialog.jsx';
import SaveTabDialog from './dialogs/SaveTabDialog.jsx';
import { createReadAloud } from './features/readAloud.js';
import { createOfflineReadAloud } from './features/offlineReadAloud.js';
import { playButtonView } from './features/playButtonMode.js';
import { defaultVoiceForLang, voiceLabel } from './features/piperTts.js';
import { enterFocus, exitFocus, repaintCovers } from './features/focusMode.js';
import { createRecognizer, wordMatches, speechRecognitionSupported } from './features/speechRecognition.js';
import { recordClip } from './features/audioRecorder.js';
import { saveAudioClip, clearSession, saveSession, saveTypingRun, saveFocusSession, getAudiobookManifest, entryClips, applySyncedPosition, getPendingSyncConflicts, clearPendingSyncConflicts, addReadSection, getBinding } from './state/storage.js';
import { sectionChecksum } from './document/sectionHash.js';
import { acquireInstance } from './state/singleInstance.js';
import { startVoiceCommands, startClapDetector } from './features/audioControl.js';
import { startMicScope, micScopeSupported } from './features/micScope.js';
import { playLineClick } from './features/clickSound.js';
import { createMetronome } from './features/metronome.js';
import { saveTextToFile, saveBlobToFile } from './features/fileSystem.js';
import { buildTabPdf } from './features/exportPdf.js';
import { ambient } from './features/ambient.js';
import { createAttentionMonitor } from './features/webcamAttention.js';
import { createGestureMonitor, DEFAULT_HAND_CALIB, DEFAULT_GESTURES, GESTURE_INFO } from './features/handGestures.js';
import { runCommand, actionLabel, matchVoice, DEFAULT_GESTURE_MAP, DEFAULT_VOICE_COMMANDS, DEFAULT_CLAP_MAP } from './features/commandRegistry.js';
import HandCalibrationDialog from './dialogs/HandCalibrationDialog.jsx';
import WebcamCalibrationDialog from './dialogs/WebcamCalibrationDialog.jsx';
import { createAlarm } from './features/alarm.js';

const WEBCAM_LABEL = {
  starting: 'starting camera…', watching: 'watching', away: 'looked away — paused', drowsy: 'drowsy',
  unsupported: 'face detection not supported here', denied: 'camera blocked', error: 'camera error', off: '',
};
const HAND_LABEL = {
  starting: 'starting camera…', watching: 'show a hand', hand: 'hand ✋', 'scroll-up': 'scroll ↑', 'scroll-down': 'scroll ↓',
  unsupported: 'hand tracking not supported here', denied: 'camera blocked', error: 'camera error', off: '',
};
import { getSyncProvider, getDriveProfile } from './features/sync/syncProviders.js';
import { backupToProvider, syncWithProvider } from './features/sync/syncManager.js';
import { applyTheme } from './state/themes.js';
import { ensureFamilyLoaded } from './state/fonts.js';
import './App.css';

// A word at index i starts a new sentence if it's the first word or the previous word ends with
// sentence-terminating punctuation (allowing trailing quotes / brackets). Used by the "first word"
// TTS progress marker.
function isSentenceStart(doc, i) {
  if (i <= 0) return true;
  const prev = doc.words[i - 1] || '';
  return /[.!?…][)"'”’\]]*$/.test(prev);
}

function AppInner() {
  const { state, activeTab: rawActiveTab, hydrateTab, openFiles, openClipboard, openRecent, setStatus, patchSettings, patchTab, openDialog, closeDialog, setActiveTab, setActivePanel, dispatch, updateGlobal, flushReadState, closeAllTabs } = useApp();
  // A lazy (restored, not-yet-loaded) tab has no parsed document — treat it as "no active reader"
  // until it hydrates, so nothing downstream touches activeTab.doc before it exists.
  const activeTab = rawActiveTab && !rawActiveTab.lazy ? rawActiveTab : null;
  const isCompact = useIsCompact();
  // Chip mode: face/stats/goal/timer float as transparent draggable chips instead of sitting in the
  // dock. Always on for compact screens; opt-in on desktop via state.global.chipMode.
  const chips = isCompact || !!state.global.chipMode;
  const [mobileView, setMobileView] = useState('rsvp'); // compact-screen single reading view: 'rsvp' | 'lines'
  const [recenterKey, setRecenterKey] = useState(0); // bump to snap the Lines pane back to the current word
  const [bioFeedPos, setBioFeedPos] = useState(() => state.global.bioFeedPos || null); // draggable Biometric Control Feed
  const [controlsCollapsed, setControlsCollapsed] = useState(false); // minimize the bottom dock for text room
  const [chromeHidden, setChromeHidden] = useState(false); // mobile: hide menu+tabs above the reader for text room
  const [immersive, setImmersive] = useState(false); // mobile: reading area fills the whole screen (tiny ⛶ overlay to exit)
  const touchRef = useRef(null); // swipe-gesture start point
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createEngine();
  const [playing, setPlaying] = useState(false);

  // Document language (Application Settings) → speech recognition + TTS voice matching.
  const docLang = getLanguage(state.global.language);
  useEffect(() => { setPreferredLanguage(docLang.bcp); }, [docLang.bcp]);

  // Arm the read-aloud background keep-alive early so the silent audio unlocks on the FIRST tap —
  // otherwise it can't play when the screen locks. Harmless if read-aloud is never used.
  useEffect(() => { armMediaKeepAlive(); }, []);

  // Live reading-mode detection: every advancement notes its input source; the chip in the
  // controls bar shows how the app currently thinks you're reading (see engine/readingMode.js).
  // Idle grace (AFK guard) as a live ref, so the tracker's active-time cap and the mode chip's
  // idle window both follow the Application Settings value without rebuilding anything.
  const graceMsRef = useRef(60000);
  graceMsRef.current = Math.max(5, Math.min(600, Number(state.global.idleGraceSecs) || 60)) * 1000;
  const modeDetRef = useRef(null);
  if (!modeDetRef.current) modeDetRef.current = createModeDetector(() => graceMsRef.current);
  const [readingMode, setReadingMode] = useState('idle');
  const [modeIdleFrac, setModeIdleFrac] = useState(null); // 1→0 as a stepping mode drains to idle
  // Draggable floating-chip positions (seeded from the last-saved spot; persisted on drop).
  const [facePos, setFacePos] = useState(() => state.global.mobileFacePos || null);
  const [statsPos, setStatsPos] = useState(() => state.global.mobileStatsPos || null);
  const [goalPos, setGoalPos] = useState(() => state.global.mobileGoalPos || null);
  const [timerPos, setTimerPos] = useState(() => state.global.mobileTimerPos || null);
  // Epoch-ms the read-aloud auto-stop fires (0 = none), so the timer chip can count down.
  const [autoStopAt, setAutoStopAt] = useState(0);
  // Live scroll-mode flag for closures (Space keydown) that would otherwise read a stale value.
  const scrollAdvancesRef = useRef(state.global.scrollAdvances);
  scrollAdvancesRef.current = state.global.scrollAdvances;

  // When the active tab is a lazy placeholder (e.g. selected via a restored tab strip, or auto-
  // selected after closing another tab), build its document on demand.
  useEffect(() => {
    if (rawActiveTab?.lazy) hydrateTab(rawActiveTab.id);
  }, [rawActiveTab?.id, rawActiveTab?.lazy, hydrateTab]);

  // Incognito: a live ref so the move-recording paths read the current value without re-subscribing.
  const incognitoRef = useRef(state.incognito);
  incognitoRef.current = state.incognito;
  const prevIncog = useRef(state.incognito);
  useEffect(() => {
    if (prevIncog.current === state.incognito) return;
    prevIncog.current = state.incognito;
    setStatus(state.incognito
      ? '🕶 Incognito on — nothing is being recorded; your reading history is untouched.'
      : 'Incognito off — your place was rewound and tracking resumed. Nothing was saved.');
  }, [state.incognito, setStatus]);
  const [dragOver, setDragOver] = useState(false);
  const [closing, setClosing] = useState(null); // null | 'disconnect' | 'shutdown'
  const [goalKills, setGoalKills] = useState([]); // session-only killfeed of completed goals
  const onGoalComplete = useCallback((label) => {
    setGoalKills((k) => [...k, { label, time: fmtTime(Date.now(), true) }]);
  }, []);
  const [typingRuns, setTypingRuns] = useState([]); // session killfeed of completed typing runs
  const onSaveTypingRun = useCallback((run) => {
    setTypingRuns((r) => [...r, run]);
    saveTypingRun(run).catch(() => {});
  }, []);
  const [planState, setPlanState] = useState(null); // running typing plan: { plan, step, set } | null
  const planStateRef = useRef(null);
  const setPlan = useCallback((ps) => { planStateRef.current = ps; setPlanState(ps); }, []);
  const [showFootnote, setShowFootnote] = useState(false);
  // Comfort/calibration: voluntary-break trigger token, and a rolling log of recent comprehension
  // outcomes (1 = passed an adaptive probe, 0 = missed) that feeds the fatigue estimate.
  const [breakSignal, setBreakSignal] = useState(0);
  const probeScoresRef = useRef([]);
  // Peek: preview a line without moving the reading position. The Lines pane scrolls to it (list
  // view) or shows it in the bottom zone (split view), reverting once normal reading resumes.
  const [peek, setPeek] = useState({ line: -1, token: 0 });
  const [scrollCmd, setScrollCmd] = useState(null); // scroll-mode nav command for LinePane {token, kind}
  // Cross-device position conflicts surfaced by a progress-sync merge (see importProgressData) —
  // the newest position was applied; this modal lets the user override per book.
  const [syncConflicts, setSyncConflicts] = useState(null);
  useEffect(() => {
    // Manual "Restore from sync" reloads right after import, so conflicts are also persisted —
    // re-raise any pending ones here, then listen for live ones (auto boot-sync doesn't reload).
    getPendingSyncConflicts().then((c) => { if (c.length) setSyncConflicts((prev) => [...(prev || []), ...c]); }).catch(() => {});
    const onConf = (e) => setSyncConflicts((prev) => [...(prev || []), ...(e.detail || [])]);
    window.addEventListener('tachyread-sync-conflicts', onConf);
    return () => window.removeEventListener('tachyread-sync-conflicts', onConf);
  }, []);
  function dismissSyncConflicts() {
    setSyncConflicts(null);
    clearPendingSyncConflicts().catch(() => {});
  }
  async function resolveSyncConflict(c, useOther) {
    const pos = useOther ? c.other.pos : c.applied.pos;
    await applySyncedPosition(c.checksum, pos, state.global.deviceName || '');
    const t = state.tabs.find((tt) => (tt.lazy ? tt.settings?.contentChecksum : tt.doc?.contentChecksum) === c.checksum);
    if (t && !t.lazy) patchSettings(t.id, { wordIndex: pos });
    setSyncConflicts((list) => {
      const n = (list || []).filter((x) => x !== c);
      if (!n.length) clearPendingSyncConflicts().catch(() => {});
      return n.length ? n : null;
    });
  }
  const [tocFlash, setTocFlash] = useState({ index: -1, token: 0 });
  const peekToLine = useCallback((line) => setPeek((s) => ({ line, token: s.token + 1 })), []);
  const clearPeek = useCallback(() => setPeek((s) => (s.line < 0 ? s : { line: -1, token: s.token + 1 })), []);
  // Revert any active peek once the reader actually moves or starts playing.
  useEffect(() => { clearPeek(); }, [activeTab?.settings.wordIndex, playing, clearPeek]);
  const onTocIcon = useCallback((index) => {
    if (!state.showToc) dispatch({ type: 'TOGGLE_TOC' });
    setTocFlash((s) => ({ index, token: s.token + 1 }));
  }, [dispatch, state.showToc]);

  // Poll the mode detector (1 Hz + immediately on state flips) into a stable string for the chip,
  // plus the time-until-idle fraction that drives the chip's countdown underline (null when the
  // mode is idle / a live override like auto/TTS/peek, which don't drain to idle).
  useEffect(() => {
    const listening = playing && !!activeTab?.settings.readAloud;
    const peeking = peek.line >= 0;
    const compute = () => {
      const m = modeDetRef.current.current({ playing, listening, peeking });
      setReadingMode(m);
      const at = ['idle', 'auto', 'listen', 'peek', 'speak'].includes(m) ? null : modeDetRef.current.idleAt();
      setModeIdleFrac(at ? Math.max(0, Math.min(1, (at - Date.now()) / graceMsRef.current)) : null);
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [playing, activeTab?.settings.readAloud, peek.line]);
  const [paneWidths, setPaneWidths] = useState({ toc: 320, dash: 260, rsvp: 420, source: 380 });
  const resizePane = (id, w) => setPaneWidths((prev) => ({ ...prev, [id]: w }));
  // Filled by the Lines pane: page(dir) → the top/bottom currently-visible line index (excluding
  // blurred / unrevealed lines). Drives the PgUp/PgDn buttons + keys.
  const linesVisibleRef = useRef(null);
  const dialogSlotRef = useRef(null); // mount point (inside .content-area) a docked dialog tab portals into
  const kbdRef = useRef({}); // latest context for the mount-once global key handler (refreshed each render)
  const recognizerRef = useRef(null);
  const audioRecRef = useRef({ rec: null, lineIndex: -1 });
  const audioCtrlRef = useRef(null);
  const clapRef = useRef(null);
  const micScopeRef = useRef(null);
  const [micScope, setMicScope] = useState(null); // live mic analyser for the oscilloscope (or null)
  // Read-aloud (integrated TTS) plumbing.
  const activeTabRef = useRef(null);
  activeTabRef.current = activeTab;
  const readAloudRef = useRef(null);
  const readAloudModeRef = useRef(null); // false = native Web Speech, true = offline Piper
  const [ttsStatus, setTtsStatus] = useState('idle'); // offline read-aloud state: idle | playing | native | error
  const [abCoverage, setAbCoverage] = useState(null); // { pct, generated, total } audiobook coverage of the active doc
  // Live read-aloud speed (0.5–2.0), read via a ref so the driver closures always see the latest.
  const ttsSpeedRef = useRef(1);
  ttsSpeedRef.current = Math.max(0.5, Math.min(2, state.global.ttsSpeed || 1));
  // Set when the user manually navigates during read-aloud, so speech resyncs to the new spot.
  // NOT set on read-aloud's own boundary advances — that distinction is what stops each sentence
  // from being cancelled and re-spoken (the "reads every sentence twice" bug).
  const ttsNavResyncRef = useRef(false);
  const metronomeRef = useRef(null); // rhythmic auditory pace cue (Web Audio)

  // Run proper-name detection lazily when enabled on a tab (it's opt-in due to memory cost). If the
  // wizard located a cast list (properNameSeed), build precisely from that; otherwise fall back to
  // the blind capitalisation heuristic.
  useEffect(() => {
    if (!activeTab?.settings.enableProperNames) return;
    const doc = activeTab.doc;
    if (doc.properNames && doc.properNames.size > 0) return;
    const seed = activeTab.settings.properNameSeed;
    if (seed && seed.length) doc.properNames = buildProperNamesFromList(doc, seed);
    else detectProperNames(doc);
    // Nudge a re-render so the line pane / RSVP engine pick up the new Map.
    patchTab(activeTab.id, { _propNamesGen: (activeTab._propNamesGen || 0) + 1 });
    // eslint-disable-next-line
  }, [activeTab?.id, activeTab?.settings.enableProperNames, activeTab?.settings.properNameSeed]);

  // Apply the active tab's theme (one of ~30 named palettes) via CSS custom properties.
  // Falls back to the legacy darkMode flag when no themeName is set.
  useEffect(() => {
    const name = activeTab?.settings?.themeName || (activeTab?.settings?.darkMode ? 'Dark' : 'Light');
    applyTheme(name, state.global.defaultSerifFamily, state.global.defaultSansFamily);
  }, [
    activeTab?.settings?.themeName,
    activeTab?.settings?.darkMode,
    state.global.defaultSerifFamily,
    state.global.defaultSansFamily,
  ]);

  // Make sure the configured reading fonts are actually loadable. Bundled families register their
  // own @font-face (and only fetch the woff2 when rendered); a Google family is fetched from the CDN
  // only when the user has opted in (state.global.enableGoogleFonts).
  useEffect(() => {
    const en = !!state.global.enableGoogleFonts;
    ensureFamilyLoaded(state.global.defaultSerifFamily, en);
    ensureFamilyLoaded(state.global.defaultSansFamily, en);
  }, [state.global.defaultSerifFamily, state.global.defaultSansFamily, state.global.enableGoogleFonts]);

  // Pause visual playback and stop counting reading time while the tab is hidden (the user is
  // doing something else). Read-aloud is EXEMPT: it's audio, so it should keep playing with the
  // screen off / phone locked (a Media Session keeps it alive — see the read-aloud effect).
  useEffect(() => {
    function onVis() {
      const hidden = document.visibilityState === 'hidden';
      const listening = !!activeTab?.settings?.readAloud;
      if (hidden && !listening) {
        setPlaying(false);
        cancelSpeech();
      } else if (hidden && listening) {
        // Screen locking / tab hiding tends to pause the keep-alive audio — re-kick it so the
        // audio session (and thus background speech) survives.
        nudgeMediaKeepAlive();
      }
      // While listening, keep crediting the words TTS reads out — they're being consumed even
      // with the screen off. Otherwise pause time accounting for the backgrounded tab.
      activeTab?.tracker?.setHidden(hidden && !listening);
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [activeTab]);

  // Per-section reading timestamps for the TOC: record when each section was first reached
  // (started) and when it became fully read (completed). Polled so it's independent of whether
  // the TOC pane is open; only writes when something actually changes.
  useEffect(() => {
    if (!activeTab) return;
    const id = setInterval(() => {
      if (incognitoRef.current) return; // incognito: don't record per-section reading timestamps
      const tab = activeTabRef.current;
      if (!tab?.tracker) return;
      const entries = getTocEntries(tab);
      if (!entries.length) return;
      const total = tab.doc.words.length || 1;
      const wi = tab.settings.wordIndex;
      const stats = { ...(tab.settings.tocReadStats || {}) };
      let changed = false;
      // started: deepest section the cursor is currently inside
      let curStart = null;
      for (const e of entries) { if (e.wordIndex <= wi) curStart = e.wordIndex; else break; }
      if (curStart != null && !stats[curStart]?.started) {
        stats[curStart] = { ...(stats[curStart] || {}), started: Date.now() };
        changed = true;
      }
      // completed: any section now fully read
      entries.forEach((e, i) => {
        const span = sectionSpan(entries, i, total);
        const rs = tab.tracker.rangeStats(span.start, span.end);
        if (rs.readFrac >= 0.999 && !stats[e.wordIndex]?.completed) {
          stats[e.wordIndex] = { ...(stats[e.wordIndex] || {}), started: stats[e.wordIndex]?.started || Date.now(), completed: Date.now() };
          changed = true;
          // Fingerprint the finished section's content so a successive edition can recognize it.
          const hash = sectionChecksum(tab.doc.words, span.start, span.end);
          if (hash) addReadSection(hash, { title: e.title, words: span.end - span.start, file: tab.doc.fileName });
        }
      });
      if (changed) patchSettings(tab.id, { tocReadStats: stats });
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [activeTab?.id]);

  // Surprisal-weighted dwell: per-word time weights (mean-normalized so average pace is preserved).
  // Recomputed only when the doc or the setting changes; the driver multiplies each word's duration by it.
  const surprisalWeights = useMemo(
    () => (activeTab?.settings.surprisalDwell && activeTab.doc
      ? computeSurprisalWeights(activeTab.doc.words, activeTab.settings.surprisalStrength ?? 1)
      : null),
    [activeTab?.doc, activeTab?.settings.surprisalDwell, activeTab?.settings.surprisalStrength],
  );

  // RSVP playback driver. Reschedules on each settings.wordIndex change while playing.
  // When read-aloud is on, speech drives advancement instead of this timer (see below).
  useEffect(() => {
    if (!activeTab || !playing || activeTab.settings.readAloud || activeTab.settings.typing?.enabled) {
      engineRef.current.cancel();
      return;
    }
    const { doc, settings } = activeTab;
    const idx = settings.wordIndex;
    if (idx >= doc.words.length - 1) {
      engineRef.current.pause();
      setPlaying(false);
      return;
    }
    const word = doc.words[idx];
    const lineIdx = getLineIndex(doc, idx);
    const nextLine = idx + 1 < doc.words.length ? getLineIndex(doc, idx + 1) : lineIdx;
    const atLineEnd = nextLine !== lineIdx;
    const isHF = doc.headerFooterLines.has(lineIdx);
    // Paragraph end = sentence end + next line is empty
    const atParaEnd =
      atLineEnd && nextLine < doc.lines.length && doc.lines[nextLine].isEmpty;
    const isProperName = doc.properNames?.has?.((word || '').toLowerCase().replace(/[^\p{L}\p{N}]+$/u, ''));

    const sw = surprisalWeights ? (surprisalWeights[idx] || 1) : 1;
    // Optional sinusoidal breathing: pace speeds up and slows down around the setpoint so the eye
    // gets brief rests. Averages to 1 over a cycle, so the mean WPM is unchanged. Divides the delay
    // (higher effective WPM = shorter gap).
    let wave = 1;
    if (settings.wpmWave) {
      const depth = Math.max(0, Math.min(0.6, settings.wpmWaveDepth ?? 0.25));
      const period = Math.max(4, settings.wpmWavePeriodSec || 18);
      wave = 1 + depth * Math.sin((Date.now() / 1000) * (2 * Math.PI / period));
    }
    const ms = wordDurationMs(word, settings, isProperName, isHF, atParaEnd, atLineEnd) * sw / wave;

    engineRef.current.scheduleNext(ms, () => {
      stepWord(1);
    });
    return () => engineRef.current.cancel();
    // eslint-disable-next-line
  }, [activeTab?.settings.wordIndex, playing, activeTab?.id, activeTab?.settings.readAloud, activeTab?.settings.typing?.enabled]);

  // Read-aloud driver: while playing + readAloud, speak forward from the current position and
  // advance the reading index in sync via boundary events (counts as reading at the spoken
  // pace). Manual line/word jumps resync the speech to wherever you moved.
  function ttsSetIndex(wi) {
    const tab = activeTabRef.current;
    if (!tab) return;
    const cur = tab.settings.wordIndex;
    if (wi === cur) return;
    const inc = incognitoRef.current;
    if (!inc) tab.tracker?.recordMove(cur, wi, Date.now(), 'listen');
    const prevLine = getLineIndex(tab.doc, cur);
    const newLine = getLineIndex(tab.doc, wi);
    if (!inc && wi > cur && newLine !== prevLine) {
      tab.sessionLinesRead.add(prevLine);
      tab.readLinesAllTime.add(prevLine);
    }
    patchSettings(tab.id, { wordIndex: wi });
  }

  useEffect(() => {
    // Pick the read-aloud backend: offline Piper (real audio → survives screen lock) or the native
    // Web Speech engine. Rebuild the driver when the mode flips.
    const offline = !!state.global.offlineVoice;
    if (!readAloudRef.current || readAloudModeRef.current !== offline) {
      readAloudRef.current?.stop();
      readAloudModeRef.current = offline;
      readAloudRef.current = offline
        ? createOfflineReadAloud({
            getDoc: () => activeTabRef.current?.doc,
            getIndex: () => activeTabRef.current?.settings.wordIndex || 0,
            setIndex: ttsSetIndex,
            getVoiceName: () => activeTabRef.current?.settings.annunciateVoice, // native fallback voice
            getRate: () => ttsSpeedRef.current,
            onEnd: () => setPlaying(false),
            onStatus: (s) => setTtsStatus(s),
          })
        : createReadAloud({
            getWords: () => activeTabRef.current?.doc.words || [],
            getIndex: () => activeTabRef.current?.settings.wordIndex || 0,
            setIndex: ttsSetIndex,
            getVoiceName: () => activeTabRef.current?.settings.annunciateVoice,
            getRate: () => ttsSpeedRef.current,
            onEnd: () => setPlaying(false),
          });
    }
    const on = playing && !!activeTab?.settings?.readAloud;
    if (on) {
      readAloudRef.current.start();
      // Lock-screen controls. Native mode needs the inaudible keep-alive tone; offline mode's real
      // synthesized speech IS the session, so skip the tone there.
      startMediaSession(mediaMeta(), {
        onPlay: () => { if (!playingRef.current) playPauseRef.current?.(); },
        onPause: () => { if (playingRef.current) playPauseRef.current?.(); },
        onNext: () => navRef.current?.('nextPara'),
        onPrev: () => navRef.current?.('prevPara'),
        onSeekForward: () => navRef.current?.('nextLine'),
        onSeekBackward: () => navRef.current?.('prevLine'),
      }, { keepAlive: !offline });
    } else {
      readAloudRef.current.stop();
      stopMediaSession();
      setTtsStatus('idle');
    }
    return () => { readAloudRef.current?.stop(); stopMediaSession(); };
    // eslint-disable-next-line
  }, [playing, activeTab?.settings?.readAloud, activeTab?.id, state.global.offlineVoice]);

  useEffect(() => {
    if (state.global.offlineVoice && ttsStatus === 'error') setStatus('Offline voice unavailable — download its model in Audio → Audio Settings.');
  }, [ttsStatus, state.global.offlineVoice]);

  // Audiobook coverage of the active doc while read-aloud is on — for the status badge (nudges you to
  // pre-generate more in the manager for lock-screen playback). Static during a run (no auto-synth).
  useEffect(() => {
    const on = playing && !!activeTab?.settings?.readAloud && !!activeTab?.doc?.contentChecksum;
    if (!on) { setAbCoverage(null); return undefined; }
    let alive = true;
    (async () => {
      const cks = audiobookChunks(activeTab.doc);
      const manifest = await getAudiobookManifest(activeTab.doc.contentChecksum);
      if (!alive) return;
      const g = cks.filter((c) => entryClips(manifest.lines[c.startLine]).length).length;
      setAbCoverage({ pct: cks.length ? Math.round((g / cks.length) * 100) : 0, generated: g, total: cks.length });
    })();
    return () => { alive = false; };
  }, [playing, activeTab?.settings?.readAloud, activeTab?.id]);

  // Keep the lock-screen metadata current as reading moves — refresh the track name when the whole-
  // number percent (or chapter) changes, so it shows live progress without churning every word.
  const mediaKeyRef = useRef('');
  useEffect(() => {
    if (!(playing && activeTab?.settings?.readAloud)) return;
    const meta = mediaMeta();
    const key = `${meta.pct}|${meta.title}`;
    if (key !== mediaKeyRef.current) {
      mediaKeyRef.current = key;
      updateMediaSession(meta);
    }
    // eslint-disable-next-line
  }, [activeTab?.settings.wordIndex, playing, activeTab?.settings?.readAloud]);

  // Live playback-speed change applies immediately to the currently-playing offline clip; native
  // TTS picks up the new rate on its next (short) chunk.
  useEffect(() => {
    const a = getSpeechAudio();
    if (a) a.playbackRate = ttsSpeedRef.current;
  }, [state.global.ttsSpeed]);

  // Manual navigation while reading aloud → resync speech to the new position. Runs after the new
  // index has committed, but only when the move came from the user (flag set by stepWord/jumpWord),
  // so read-aloud's own per-word advances never trigger a resync (which would restart the sentence).
  useEffect(() => {
    if (!playing || !activeTab?.settings?.readAloud) return;
    if (ttsNavResyncRef.current) {
      ttsNavResyncRef.current = false;
      readAloudRef.current?.resync();
    }
    // eslint-disable-next-line
  }, [activeTab?.settings.wordIndex]);

  // Rhythmic pacing: an optional Web-Audio metronome that ticks at the current reading pace while
  // playing — a steady cadence cue to read along with. Tempo is read live from settings.wpm, so it
  // tracks the adaptive pacer with no restart. Silenced during read-aloud / typing (those drive
  // their own rhythm).
  useEffect(() => {
    if (!metronomeRef.current) metronomeRef.current = createMetronome();
    const m = metronomeRef.current;
    const cfg = activeTab?.settings.metronome;
    const on =
      !!cfg?.enabled && playing && !activeTab?.settings.readAloud && !activeTab?.settings.typing?.enabled;
    if (on) {
      m.start({
        getWpm: () => activeTabRef.current?.settings.wpm || 300,
        subdivision: cfg.subdivision || 1,
        accentEvery: cfg.accentEvery || 0,
        volume: cfg.volume ?? 0.25,
      });
    } else {
      m.stop();
    }
    return () => m.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playing,
    activeTab?.id,
    activeTab?.settings.metronome?.enabled,
    activeTab?.settings.metronome?.subdivision,
    activeTab?.settings.metronome?.accentEvery,
    activeTab?.settings.metronome?.volume,
    activeTab?.settings.readAloud,
    activeTab?.settings.typing?.enabled,
  ]);

  function stepWord(delta, opts = {}) {
    if (!activeTab) return;
    const cur = activeTab.settings.wordIndex;
    let next = Math.max(0, Math.min(activeTab.doc.words.length - 1, cur + delta));
    // Skip header/footer lines if enabled (only when advancing forward)
    if (delta > 0 && activeTab.settings.autoSkipHeaders) {
      const doc = activeTab.doc;
      while (next < doc.words.length - 1) {
        const li = getLineIndex(doc, next);
        if (!doc.headerFooterLines.has(li)) break;
        next++;
      }
    }
    if (next === cur) return;
    const srcKind = opts.src || 'auto'; // untagged steps come from the playback engine
    modeDetRef.current.note(srcKind);
    const inc = incognitoRef.current;
    // Reading-efficiency tracking (classifies read / skip / re-read / revisit + active time).
    if (!inc) activeTab.tracker?.recordMove(cur, next, Date.now(), srcKind);
    // Forward motion (playback, a forward word step, scrolling forward) means you read the text you
    // passed — credit those words for coverage even on a multi-word step the move-classifier treats
    // as a skim/skip. recordMove above keeps the time/WPM accounting honest.
    if (!inc && next > cur) activeTab.tracker?.markRangeRead(cur, next, srcKind);
    // Line status coloring for the right pane.
    const prevLine = getLineIndex(activeTab.doc, cur);
    const newLine = getLineIndex(activeTab.doc, next);
    if (newLine !== prevLine && activeTab.settings.lineAdvanceSound) playLineClick(0.16, activeTab.settings.lineSoundKind);
    if (!inc) {
      if (next > cur) {
        // Mark every line we left behind as read (covers single steps and multi-line scroll jumps).
        for (let li = prevLine; li < newLine; li++) {
          activeTab.sessionLinesRead.add(li);
          activeTab.readLinesAllTime.add(li);
        }
      } else if (opts.nav) {
        activeTab.sessionNavLinesRead.add(newLine);
      }
    }
    // Non-driving "follow" TTS: speak as normal forward reading moves, without setting the pace.
    //   firstWord — the first word of each sentence reached (a spoken progress marker)
    //   line      — the whole current line; cut off by the next line, since TTS lags fast reading
    const followMode = activeTab.settings.ttsFollowMode || (activeTab.settings.firstWordTts ? 'firstWord' : 'off');
    if (followMode !== 'off' && next > cur && !opts.nav && !activeTab.settings.readAloud) {
      const voice = { voiceName: activeTab.settings.annunciateVoice, rate: ttsSpeedRef.current };
      if (followMode === 'firstWord' && isSentenceStart(activeTab.doc, next) && !window.speechSynthesis?.speaking) {
        const w = (activeTab.doc.words[next] || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (w) speak(w, voice);
      } else if (followMode === 'line' && newLine !== prevLine) {
        cancelSpeech(); // cut off the previous line so each new line starts speaking immediately
        const lt = (activeTab.doc.lines[newLine]?.text || '').trim();
        if (lt) speak(lt, voice);
      }
    }
    if (opts.nav) ttsNavResyncRef.current = true; // manual step during read-aloud → resync speech
    patchSettings(activeTab.id, { wordIndex: next });
  }

  function jumpWord(wi, opts = { nav: true }) {
    if (!activeTab) return;
    const cur = activeTab.settings.wordIndex;
    const next = Math.max(0, Math.min(activeTab.doc.words.length - 1, wi));
    if (next === cur) return;
    modeDetRef.current.note(opts.src || 'jump'); // untagged jumps are TOC/Find/click navigation
    const inc = incognitoRef.current;
    // opts.read marks a DELIBERATE forward navigation (end of line/paragraph, page down) as reading
    // the text passed — unlike a jump to elsewhere (TOC/Find/Go-to), which stays a skip.
    const fwdRead = opts.read && next > cur;
    if (!inc) {
      if (opts.src === 'scroll') {
        // Scroll-to-read: frame-sized frontier advances aggregate into a gesture credited at the
        // dwell pace (see readingTracker.noteScrollAdvance) — recordMove would misread them as
        // skims (burst of tiny gaps) after an idle-capped dwell.
        activeTab.tracker?.noteScrollAdvance(cur, next, Date.now());
      } else {
        activeTab.tracker?.recordMove(cur, next, Date.now(), opts.src);
        if (fwdRead) activeTab.tracker?.markRangeRead(cur, next, opts.src);
      }
    }
    const prevLine = getLineIndex(activeTab.doc, cur);
    const newLine = getLineIndex(activeTab.doc, next);
    if (newLine !== prevLine && activeTab.settings.lineAdvanceSound) playLineClick(0.16, activeTab.settings.lineSoundKind);
    if (!inc) {
      if (fwdRead) {
        for (let li = prevLine; li < newLine; li++) {
          activeTab.sessionLinesRead.add(li);
          activeTab.readLinesAllTime.add(li);
        }
      } else if (opts.nav) {
        activeTab.sessionNavLinesRead.add(newLine);
      }
    }
    if (opts.nav) ttsNavResyncRef.current = true; // manual jump during read-aloud → resync speech
    patchSettings(activeTab.id, { wordIndex: next });
  }

  // Set "finish this section" (start→end words) as the active goal — used by the TOC pane.
  function setSectionGoal(start, end, label) {
    if (!activeTab) return;
    patchSettings(activeTab.id, { goal: { type: 'Section', start, end, label, baseline: start, set: true } });
  }

  function nav(kind) {
    if (!activeTab) return;
    // In scroll-to-read the nav buttons drive the SCROLL, not the index: snap the current line to
    // the configured read point, then scroll by the corresponding amount (LinePane executes it).
    if (state.global.scrollAdvances && state.showLines !== false) {
      setScrollCmd((c) => ({ token: (c?.token || 0) + 1, kind }));
      return;
    }
    const doc = activeTab.doc;
    const cur = activeTab.settings.wordIndex;
    const curLine = getLineIndex(doc, cur);
    if (kind === 'prevWord') return stepWord(-1, { nav: true, src: 'word' });
    if (kind === 'nextWord') return stepWord(1, { nav: true, src: 'word' });
    if (kind === 'prevLine') {
      for (let li = curLine - 1; li >= 0; li--) {
        if (!doc.lines[li].isEmpty) {
          jumpWord(doc.lines[li].startWordIndex, { nav: true, src: 'line' });
          return;
        }
      }
      jumpWord(0, { nav: true, src: 'line' });
      return;
    }
    if (kind === 'nextLine') {
      for (let li = curLine + 1; li < doc.lines.length; li++) {
        if (!doc.lines[li].isEmpty) {
          jumpWord(doc.lines[li].startWordIndex, { nav: true, read: true, src: 'line' });
          return;
        }
      }
      jumpWord(doc.words.length - 1, { nav: true, read: true, src: 'line' });
      return;
    }
    if (kind === 'prevPara') {
      const rng = getParagraphRange(doc, curLine);
      if (cur > doc.lines[rng.startLine].startWordIndex) {
        jumpWord(doc.lines[rng.startLine].startWordIndex, { nav: true, src: 'para' });
        return;
      }
      // Previous paragraph
      let li = rng.startLine - 1;
      while (li >= 0 && doc.lines[li].isEmpty) li--;
      if (li < 0) {
        jumpWord(0, { nav: true, src: 'para' });
        return;
      }
      const prng = getParagraphRange(doc, li);
      jumpWord(doc.lines[prng.startLine].startWordIndex, { nav: true, src: 'para' });
      return;
    }
    if (kind === 'nextPara') {
      const rng = getParagraphRange(doc, curLine);
      let li = rng.endLine + 1;
      while (li < doc.lines.length && doc.lines[li].isEmpty) li++;
      if (li >= doc.lines.length) {
        jumpWord(doc.words.length - 1, { nav: true, read: true, src: 'para' });
        return;
      }
      jumpWord(doc.lines[li].startWordIndex, { nav: true, read: true, src: 'para' });
      return;
    }
    if (kind === 'restart') {
      jumpWord(0);
      return;
    }
  }

  // Page by a screenful of the Lines pane: move the reading position so the current line becomes
  // the line that was at the top (PgUp) / bottom (PgDn) of the visible area. Blurred and unrevealed
  // lines don't count as visible. Falls back to paragraph paging when the Lines pane isn't mounted
  // (e.g. mobile Fast-Reader view) or can't report a range.
  function pageLines(dir) {
    if (!activeTab) return;
    if (state.global.scrollAdvances && state.showLines !== false) {
      setScrollCmd((c) => ({ token: (c?.token || 0) + 1, kind: dir > 0 ? 'pageDown' : 'pageUp' }));
      return;
    }
    const target = linesVisibleRef.current?.page?.(dir);
    if (target == null) { nav(dir > 0 ? 'nextPara' : 'prevPara'); return; }
    const doc = activeTab.doc;
    const li = Math.max(0, Math.min(doc.lines.length - 1, target));
    const wi = doc.lines[li].startWordIndex;
    if (wi === activeTab.settings.wordIndex) { nav(dir > 0 ? 'nextPara' : 'prevPara'); return; }
    // Paging DOWN counts as reading the text you paged past; paging up is just navigation.
    jumpWord(wi, dir > 0 ? { nav: true, read: true, src: 'page' } : { nav: true, src: 'page' });
  }

  // ── Pause when the reader isn't engaged ─────────────────────────────────────────────────────
  // Two guards pause NON-TTS reading (read-aloud / typing are exempt): the text scrolling off-screen,
  // and — with the webcam feature — the user looking away. An auto-pause is remembered and resumed
  // when the blocker clears, so a brief glance away doesn't lose your place.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const blockRef = useRef({ offscreen: false, away: false });
  const autoPausedRef = useRef(false);
  const offscreenTimer = useRef(null);
  const paneVis = useRef({ rsvp: false, lines: false });
  const pauseTextHiddenRef = useRef(state.global.pauseWhenTextHidden);
  pauseTextHiddenRef.current = state.global.pauseWhenTextHidden;
  const [webcamState, setWebcamState] = useState('off');
  const [webcamStream, setWebcamStream] = useState(null);
  const [gestureStream, setGestureStream] = useState(null); // hand-gesture camera stream (for the popup)
  const webcamRef = useRef(null);
  // Unified Biometric Control Feed log — camera events (away/back, doze, gestures) and voice/clap
  // commands interleaved, time-ordered. Each entry carries source: 'camera' | 'voice'.
  const [bioLog, setBioLog] = useState([]);
  const bioLogId = useRef(0);
  const pushBioLog = useCallback((e) => {
    setBioLog((l) => [...l.slice(-49), { id: ++bioLogId.current, time: fmtTime(Date.now(), true), ...e }]);
  }, []);

  const evalBlock = useCallback(() => {
    const tab = activeTabRef.current;
    if (!tab) return;
    const nonTts = !tab.settings.readAloud && !tab.settings.typing?.enabled;
    const blocked = blockRef.current.offscreen || blockRef.current.away;
    if (blocked) {
      if (playingRef.current && nonTts) {
        autoPausedRef.current = true;
        engineRef.current.pause();
        setPlaying(false);
      }
    } else if (autoPausedRef.current && !playingRef.current && nonTts) {
      autoPausedRef.current = false;
      engineRef.current.start();
      setPlaying(true);
    }
  }, []);

  const reportPaneVisible = useCallback((id, v) => {
    paneVis.current[id] = v;
    if (offscreenTimer.current) { clearTimeout(offscreenTimer.current); offscreenTimer.current = null; }
    const anyVisible = paneVis.current.rsvp || paneVis.current.lines;
    if (!pauseTextHiddenRef.current || anyVisible) {
      blockRef.current.offscreen = false;
      evalBlock();
    } else {
      // brief delay so a pane unmount / view switch / re-layout isn't mistaken for "hidden"
      offscreenTimer.current = setTimeout(() => { blockRef.current.offscreen = true; evalBlock(); }, 500);
    }
  }, [evalBlock]);
  const onRsvpVisible = useCallback((v) => reportPaneVisible('rsvp', v), [reportPaneVisible]);
  const onLinesVisible = useCallback((v) => reportPaneVisible('lines', v), [reportPaneVisible]);

  // Webcam monitor (opt-in). The camera runs if EITHER guard is on; each behaviour is gated live so
  // toggling one doesn't restart the camera. attention → pause non-TTS reading; doze → stop read-aloud.
  const webcamAttentionRef = useRef(state.global.webcamAttention);
  webcamAttentionRef.current = state.global.webcamAttention;
  const webcamDozeRef = useRef(state.global.webcamDoze);
  webcamDozeRef.current = state.global.webcamDoze;
  const awayAlarmRef = useRef(state.global.webcamAwayAlarm);
  awayAlarmRef.current = state.global.webcamAwayAlarm;
  const awayAlarmSecRef = useRef(state.global.webcamAwayAlarmSec);
  awayAlarmSecRef.current = state.global.webcamAwayAlarmSec;
  const escalatingRef = useRef(state.global.webcamEscalatingAlarm);
  escalatingRef.current = state.global.webcamEscalatingAlarm;
  const distanceNudgeRef = useRef(state.global.webcamDistanceNudge);
  distanceNudgeRef.current = state.global.webcamDistanceNudge;
  const focusStatsRef = useRef(state.global.webcamFocusStats);
  focusStatsRef.current = state.global.webcamFocusStats;
  const focusRef = useRef(null); // current camera-on focus session accumulator
  const alarmEngineRef = useRef(null);
  const alarmDismissedRef = useRef(false);
  const [awayAlarmActive, setAwayAlarmActive] = useState(false);
  const [tooClose, setTooClose] = useState(false);
  const dismissAwayAlarm = useCallback(() => {
    alarmEngineRef.current?.stop();
    setAwayAlarmActive(false);
    alarmDismissedRef.current = true; // suppress until attention returns
  }, []);
  // Front-camera attention/gesture features are disabled on mobile (battery/CPU, and small screens
  // rarely face the user squarely) — only OCR/Grab (which uses the rear/document camera) runs there.
  const camGuardsOn = state.global.webcamAttention || state.global.webcamDoze || state.global.webcamAwayAlarm
    || state.global.webcamDistanceNudge || state.global.webcamFocusStats;
  const camOn = !isCompact && camGuardsOn;
  const handGesturesOn = !isCompact && !!state.global.handGestures;
  const audioCtrlOn = !!activeTab?.settings?.audioCtrl;
  useEffect(() => {
    if (!camOn) {
      webcamRef.current?.stop();
      webcamRef.current = null;
      blockRef.current.away = false;
      evalBlock();
      return undefined;
    }
    focusRef.current = { startTs: Date.now(), lastTs: Date.now(), attentive: true, watchedMs: 0, awayMs: 0, distractions: 0 };
    const mon = createAttentionMonitor({
      blinkThreshold: state.global.webcamCalib?.threshold ?? 0.5,
      // MediaPipe FaceLandmarker is battery/CPU-heavy on phones — sample at half the rate there
      // (still well inside the doze/away grace windows) to keep the reader responsive.
      intervalMs: deviceKind() === 'Mobile' ? 500 : 250,
      onStream: (s) => setWebcamStream(s),
      onState: (s) => setWebcamState(s),
      onAttention: (attentive) => {
        // visual reading pause — only when the attention guard is on
        blockRef.current.away = webcamAttentionRef.current ? !attentive : false;
        evalBlock();
        // look-away analytics: tally watched vs away time + distraction count
        const f = focusRef.current;
        if (f) {
          const now = Date.now();
          if (f.attentive) f.watchedMs += now - f.lastTs; else f.awayMs += now - f.lastTs;
          f.lastTs = now;
          if (!attentive) f.distractions += 1;
          if (f.attentive !== attentive) pushBioLog(attentive ? { source: 'camera', icon: '👀', text: 'Back — watching', tone: 'ok' } : { source: 'camera', icon: '🙈', text: 'Looked away', tone: 'warn' });
          f.attentive = attentive;
        }
      },
      onDoze: (dozing) => {
        // doze → stop read-aloud (it's otherwise exempt from the guards). No auto-resume: if you
        // nodded off, it just stops, like the wind-down timer.
        if (dozing) pushBioLog({ source: 'camera', icon: '💤', text: 'Drowsy — eyes shut', tone: 'warn' });
        if (dozing && webcamDozeRef.current && playingRef.current && activeTabRef.current?.settings.readAloud) {
          engineRef.current.pause();
          setPlaying(false);
          cancelSpeech();
          if (activeTabRef.current) flushReadState(activeTabRef.current);
          setStatus('Read-aloud stopped — you seemed to nod off.');
        }
      },
      onAway: (awayMs) => {
        // Escalating alarm: sound an alert once you've been away longer than the configured delay.
        const running = alarmEngineRef.current?.isRunning?.();
        if (!awayAlarmRef.current || awayMs === 0) {
          if (awayMs === 0) alarmDismissedRef.current = false; // attention back → re-arm
          if (running) { alarmEngineRef.current.stop(); setAwayAlarmActive(false); }
          return;
        }
        if (!alarmDismissedRef.current && awayMs >= (awayAlarmSecRef.current || 15) * 1000) {
          if (!alarmEngineRef.current) alarmEngineRef.current = createAlarm();
          if (!alarmEngineRef.current.isRunning()) { alarmEngineRef.current.start({ escalate: !!escalatingRef.current }); setAwayAlarmActive(true); }
        }
      },
      onProximity: (close) => {
        setTooClose(distanceNudgeRef.current ? close : false);
        if (close) pushBioLog({ source: 'camera', icon: '↔', text: 'Too close to the screen', tone: 'warn' });
      },
    });
    webcamRef.current = mon;
    mon.start();
    return () => {
      mon.stop();
      webcamRef.current = null;
      blockRef.current.away = false;
      alarmEngineRef.current?.stop();
      setAwayAlarmActive(false);
      setTooClose(false);
      alarmDismissedRef.current = false;
      // finalize the focus session
      const f = focusRef.current;
      focusRef.current = null;
      if (f && focusStatsRef.current) {
        const now = Date.now();
        if (f.attentive) f.watchedMs += now - f.lastTs; else f.awayMs += now - f.lastTs;
        if (f.watchedMs + f.awayMs > 30000) {
          saveFocusSession({ ts: f.startTs, watchedMs: f.watchedMs, awayMs: f.awayMs, distractions: f.distractions, docName: activeTabRef.current?.doc?.fileName || '' }).catch(() => {});
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  function playPause() {
    if (!activeTab) return;
    // Scroll-to-read owns the pace — auto-play would fight the scroll. Block starting playback
    // (the play button is disabled too); pausing an already-running player still works. Read from a
    // ref: the document keydown (Space) handler holds a stale closure that predates the mode flip.
    if (scrollAdvancesRef.current && !playing) {
      setStatus('📜 Scroll-to-read is on — scroll the Lines pane to read (auto-play is off).');
      return;
    }
    autoPausedRef.current = false; // manual control overrides any auto-pause memory
    if (playing) {
      engineRef.current.pause();
      setPlaying(false);
      cancelSpeech();
      flushReadState(activeTab);
    } else {
      engineRef.current.start();
      setPlaying(true);
    }
  }
  // Turning on scroll-to-read while playing stops the player — the two paces can't coexist.
  useEffect(() => {
    if (state.global.scrollAdvances && playing) {
      engineRef.current.pause();
      setPlaying(false);
      cancelSpeech();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.global.scrollAdvances]);
  const playPauseRef = useRef(null);
  playPauseRef.current = playPause;
  const navRef = useRef(null);
  navRef.current = nav;

  // Lock-screen / notification metadata for the current read-aloud: the book title + the chapter
  // being read (so the phone's media controls show where you are).
  function mediaMeta() {
    const tab = activeTabRef.current;
    if (!tab) return { title: 'Reading', artist: '', album: 'Tachyread', pct: 0 };
    const book = tab.doc?.fileName || 'Reading';
    const total = tab.doc?.words?.length || 1;
    const pct = Math.min(100, Math.round((tab.settings.wordIndex / total) * 100));
    let chapter = '';
    try {
      const entries = getTocEntries(tab);
      const ch = currentChapter(entries, tab.settings.wordIndex, tab.doc.words.length);
      if (ch?.title) chapter = ch.title;
    } catch { /* no toc */ }
    // The track name (title) leads with progress so the lock screen shows where you are.
    return { title: `${pct}% · ${chapter || book}`, artist: book, album: 'Tachyread — read-aloud', pct };
  }

  // Small action bag the command registry runs against (shared by gestures, voice, and claps).
  // Everything here goes through call-time closures, so triggers always see the live handlers.
  const cmdCtx = () => ({
    playPause: () => playPauseRef.current?.(),
    setPlaying,
    nav,
    adjustWpm,
    page: pageLines,
    jumpToCurrent: () => jumpToCurrent(),
    jumpToFrontier: () => jumpToFrontier(),
    jumpToGap: () => jumpToGap(),
    toggleReadAloud: () => toggleReadAloud(),
    toggleScroll: () => toggleScrollRead(),
    toggleFocus: () => toggleFocusMode(),
    toggleFaces: () => { const t = activeTabRef.current; if (t) patchSettings(t.id, { showEyes: !t.settings.showEyes }); },
    toggleStats: () => dispatch({ type: 'TOGGLE_STATS' }),
    switchTab: (d) => cycleTabs(d),
    sourcePage: (d) => jumpSourcePage(d),
  });
  // Latest voice-command phrase list, read live by the recognizer's matcher (so edits in Biometric
  // Controls take effect without toggling voice off/on).
  const voiceCommandsRef = useRef(DEFAULT_VOICE_COMMANDS);
  voiceCommandsRef.current = state.global.voiceCommands?.length ? state.global.voiceCommands : DEFAULT_VOICE_COMMANDS;
  // Discrete hand gestures (and the wave) → whatever command the user mapped them to. Each gesture is
  // individually enabled in settings; the map decides the action (gestureMap; falls back to defaults).
  const handleGestureRef = useRef(null);
  handleGestureRef.current = (kind) => {
    if (!activeTab) return;
    const gmap = { ...DEFAULT_GESTURE_MAP, ...(state.global.gestureMap || {}) };
    const cmdId = gmap[kind];
    const info = GESTURE_INFO[kind];
    if (cmdId) {
      runCommand(cmdId, cmdCtx());
      setStatus(`${info?.icon || '🖐'} ${actionLabel(cmdId)}`);
    }
    pushBioLog({ source: 'camera', icon: info?.icon || '🖐', text: info?.label || kind, action: cmdId ? actionLabel(cmdId) : null, tone: 'gesture' });
  };

  // Hand-gesture controls (opt-in): open palm = scroll joystick over the Lines pane (raise/lower
  // = direction, distance from your calibrated rest = speed); a wave toggles play/pause.
  const [handState, setHandState] = useState('off');
  const handRef = useRef(null);
  const handVelRef = useRef(0);
  useEffect(() => {
    if (!handGesturesOn) {
      handRef.current?.stop();
      handRef.current = null;
      handVelRef.current = 0;
      setHandState('off');
      setGestureStream(null);
      return undefined;
    }
    const mon = createGestureMonitor({
      calib: state.global.handCalib || DEFAULT_HAND_CALIB,
      gestures: state.global.handGestureSet || DEFAULT_GESTURES,
      intervalMs: deviceKind() === 'Mobile' ? 150 : 100,
      onState: setHandState,
      onStream: (s) => setGestureStream(s),
      onGesture: (kind) => handleGestureRef.current?.(kind),
      onHand: ({ present, v }) => {
        setHandState(!present ? 'watching' : v < 0 ? 'scroll-up' : v > 0 ? 'scroll-down' : 'hand');
      },
      onScroll: (v) => { handVelRef.current = v; },
      onWave: () => handleGestureRef.current?.('wave'),
    });
    handRef.current = mon;
    mon.start();
    // Smooth scroll pump: apply the joystick velocity to the Lines pane scroller every frame.
    let scroller = null;
    let raf;
    const pump = () => {
      raf = requestAnimationFrame(pump);
      const v = handVelRef.current;
      if (!v) return;
      if (!scroller || !scroller.isConnected) {
        const wrap = document.querySelector('.line-pane-list');
        scroller = wrap
          ? [...wrap.querySelectorAll('*')].find((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY)) || wrap
          : null;
      }
      scroller?.scrollBy(0, v * 9); // full deflection ≈ half a screen per second
    };
    raf = requestAnimationFrame(pump);
    return () => {
      cancelAnimationFrame(raf);
      mon.stop();
      handRef.current = null;
      handVelRef.current = 0;
      setHandState('off');
      setGestureStream(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handGesturesOn]);
  // Clear the unified feed once no biometric source (camera, gestures, or voice) is running.
  useEffect(() => { if (!camOn && !handGesturesOn && !audioCtrlOn) setBioLog([]); }, [camOn, handGesturesOn, audioCtrlOn]);
  // Turn off every front-camera feature at once (the popup's × does this).
  const turnOffCamera = useCallback(() => {
    updateGlobal({ webcamAttention: false, webcamDoze: false, webcamAwayAlarm: false, webcamDistanceNudge: false, webcamFocusStats: false, handGestures: false });
  }, [updateGlobal]);
  // Calibration / gesture toggles saved while running → apply live without restarting the camera.
  useEffect(() => {
    handRef.current?.setCalib(state.global.handCalib || DEFAULT_HAND_CALIB);
  }, [state.global.handCalib]);
  useEffect(() => {
    handRef.current?.setGestures(state.global.handGestureSet || DEFAULT_GESTURES);
  }, [state.global.handGestureSet]);

  // Auto-stop timer: after this many minutes of continuous playback, pause and silence speech.
  // Handy for winding down to read-aloud without it running all night. Restarts on each Play.
  useEffect(() => {
    const mins = state.global.ttsAutoStopMin || 0;
    if (!playing || mins <= 0) { setAutoStopAt(0); return undefined; }
    setAutoStopAt(Date.now() + mins * 60000);
    const id = setTimeout(() => {
      engineRef.current.pause();
      setPlaying(false);
      cancelSpeech();
      setAutoStopAt(0);
      if (activeTabRef.current) flushReadState(activeTabRef.current);
      setStatus(`Auto-stopped after ${mins} min.`);
    }, mins * 60000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, state.global.ttsAutoStopMin]);

  // Duck the ambient bed while read-aloud is actively speaking, so it never competes with the voice.
  useEffect(() => {
    ambient.setDucked(playing && !!activeTab?.settings?.readAloud);
  }, [playing, activeTab?.settings?.readAloud]);

  // Mobile text-maximise effect lives further down, after `hideWord` is computed (it depends on it).

  // Optional swipe gestures over the reading area: horizontal swipe = prev/next line, a long swipe
  // = prev/next paragraph. Off by default (vertical scroll/selection are left untouched either way).
  const gestureHandlers = state.global.gestureControls
    ? {
        onTouchStart: (e) => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY }; },
        onTouchEnd: (e) => {
          const s = touchRef.current;
          touchRef.current = null;
          if (!s) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return; // need a clear horizontal swipe
          const far = Math.abs(dx) > 170;
          if (dx < 0) nav(far ? 'nextPara' : 'nextLine');
          else nav(far ? 'prevPara' : 'prevLine');
        },
      }
    : {};

  // Scroll-to-read lives in the Lines pane itself now (see LinePane's onRowsRendered): the list
  // scrolls normally and whatever scrolls off the TOP is marked read — rather than tying scroll
  // deltas to word steps. Gated by state.global.scrollAdvances and passed in as `scrollRead`.

  // Focus mode: fullscreen the app + (Chromium) black out other monitors with cover windows. Must run
  // straight from the toggle click — the user gesture is what unlocks fullscreen / window-management /
  // pop-ups, so this can't live in an effect.
  const focusCoversRef = useRef([]);
  async function toggleFocusMode() {
    if (state.global.focusMode) {
      exitFocus(focusCoversRef.current); focusCoversRef.current = [];
      updateGlobal({ focusMode: false });
      return;
    }
    const res = await enterFocus(document.documentElement, state.global.focusDim ?? 0.92);
    focusCoversRef.current = res.covers;
    updateGlobal({ focusMode: true });
    const msg = {
      unsupported: 'Focus on. Multi-monitor blackout needs Chrome or Edge — app is fullscreen only.',
      denied: 'Focus on. Allow “window management” to black out other monitors.',
      single: 'Focus on. Only one monitor detected.',
      blocked: 'Focus on. Allow pop-ups to black out other monitors.',
      ok: `Focus on. Blacked out ${res.covers.length} other monitor${res.covers.length === 1 ? '' : 's'}.`,
    }[res.reason];
    if (msg) setStatus(msg);
  }
  // Keep cover dimness live as the slider moves; tear focus down if the user Escapes fullscreen.
  useEffect(() => {
    if (state.global.focusMode) repaintCovers(focusCoversRef.current, state.global.focusDim ?? 0.92);
  }, [state.global.focusDim, state.global.focusMode]);
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && state.global.focusMode) {
        exitFocus(focusCoversRef.current); focusCoversRef.current = [];
        updateGlobal({ focusMode: false });
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [state.global.focusMode, updateGlobal]);
  // Closing the blackout (cover) windows directly should also end focus mode — otherwise the chrome
  // keeps fading. They're separate windows that can't notify us, so poll: once they're all gone, tear
  // focus down (exit fullscreen, drop focus-on).
  useEffect(() => {
    if (!state.global.focusMode) return undefined;
    const covers = focusCoversRef.current;
    if (!covers || !covers.length) return undefined; // single monitor / pop-ups blocked: nothing to watch
    const id = setInterval(() => {
      if (covers.every((w) => !w || w.closed)) {
        exitFocus(focusCoversRef.current); focusCoversRef.current = [];
        updateGlobal({ focusMode: false });
      }
    }, 800);
    return () => clearInterval(id);
  }, [state.global.focusMode, updateGlobal]);
  // Never leave orphaned cover windows behind if the app tab goes away.
  useEffect(() => {
    const onHide = () => exitFocus(focusCoversRef.current);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // ── Typing plan runner ──────────────────────────────────────────────────────────────────────
  // A plan runs step by step, set by set; each step's drill config is pushed into the typing
  // settings, and the step's description is spoken (TTS) at the start of its first set. TypingRun is
  // keyed by step+set so each set is a fresh run.
  function configureTypingForStep(step) {
    const tab = activeTabRef.current;
    if (!tab) return;
    patchSettings(tab.id, {
      typing: { ...tab.settings.typing, enabled: true, mode: step.mode, runMode: step.runMode, runLimit: step.runLimit },
      readAloud: false,
      speaking: { ...tab.settings.speaking, enabled: false },
    });
  }
  function startPlan(plan) {
    if (!activeTab || !plan?.steps?.length) return;
    const step0 = plan.steps[0];
    configureTypingForStep(step0);
    setPlan({ plan, step: 0, set: 0 });
    closeDialog();
    setStatus(`▶ Plan “${plan.name}” — step 1/${plan.steps.length}.`);
    if (step0.description) setTimeout(() => speak(step0.description, {}), 250); // first set of step 0
  }
  function advancePlan() {
    const ps = planStateRef.current;
    const tab = activeTabRef.current;
    if (!ps || !tab) return;
    const { plan, step, set } = ps;
    const cur = plan.steps[step];
    if (set + 1 < Math.max(1, cur.sets || 1)) {
      setPlan({ plan, step, set: set + 1 }); // same step, next set — no spoken description
      return;
    }
    if (step + 1 < plan.steps.length) {
      const next = plan.steps[step + 1];
      configureTypingForStep(next);
      setPlan({ plan, step: step + 1, set: 0 });
      setStatus(`Plan “${plan.name}” — step ${step + 2}/${plan.steps.length}.`);
      if (next.description) setTimeout(() => speak(next.description, {}), 200); // first set of the new step
      return;
    }
    // plan complete
    patchSettings(tab.id, { typing: { ...tab.settings.typing, enabled: false } });
    setPlan(null);
    setStatus(`🏁 Plan “${plan.name}” complete.`);
  }
  function exitPlan() {
    const tab = activeTabRef.current;
    if (tab) patchSettings(tab.id, { typing: { ...tab.settings.typing, enabled: false } });
    setPlan(null);
    cancelSpeech();
  }

  // Keyboard shortcuts. Bound once; all live values come from kbdRef (refreshed each render). Layered:
  // Esc (works even in fields) → nothing else in a field → global Ctrl/F1 combos → reading-surface keys
  // (only when no dialog tab is focused and focus isn't on a control). See the Help → Keyboard guide.
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      const k = kbdRef.current;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = (e.key || '').toLowerCase();
      const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const inDialog = !!(k.state.modal || k.state.panels.some((p) => p.id === k.state.activePanelId));

      // Escape works from anywhere: close a footnote, else the focused dialog tab.
      if (e.key === 'Escape') {
        if (k.showFootnote) { k.setShowFootnote(false); return; }
        if (inDialog) { k.closeDialog(); }
        return;
      }
      if (inField) return; // never hijack keys while typing into a field

      // ── Global (work with or without a dialog open) ────────────────────────────
      if (e.key === 'F1') { e.preventDefault(); k.openDialog({ kind: 'help' }); return; }
      if (ctrl && (e.key === 'PageUp' || e.key === 'PageDown')) { e.preventDefault(); k.cycleTabs(e.key === 'PageUp' ? -1 : 1); return; }
      if (ctrl && !shift) {
        if (key === 'o') { e.preventDefault(); k.triggerOpen('.txt,.md,.csv,.log'); return; }
        if (key === 'd') { e.preventDefault(); k.triggerOpen('.docx,.pdf,.epub,.txt,.md,.markdown,.html,.htm'); return; }
        if (key === 'b') { e.preventDefault(); k.openClipboard(); return; }
        if (key === 'f') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'find' }); return; }
        if (key === 'g') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'goto' }); return; }
        if (key === 't') { e.preventDefault(); k.openDialog({ kind: 'stats' }); return; }
        if (key === 'h') { e.preventDefault(); k.openDialog({ kind: 'literary-journey', tab: 'rhistory' }); return; }
        if (key === 'i') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'proper-names' }); return; }
        if (key === ',') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'tab-settings' }); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (!inDialog) k.nav('prevPara'); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); if (!inDialog) k.nav('nextPara'); return; }
      }
      if (ctrl && shift) {
        if (key === 'f') { e.preventDefault(); if (k.activeTab) k.setShowFootnote((s) => !s); return; }
        if (key === 'a') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'audiobook' }); return; }
        if (key === 'n') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'notes' }); return; }
        if (key === 't') { e.preventDefault(); if (k.activeTab) k.openDialog({ kind: 'tts-popup' }); return; }
        if (key === 'g') { e.preventDefault(); k.openDialog({ kind: 'grab' }); return; }
      }
      if (ctrl) return; // any other Ctrl/Cmd combo is the browser's

      // ── Reading surface (only while actually reading — no dialog tab, focus not on a control) ─────
      if (inDialog) return;
      const onControl = !!(t.closest && t.closest('button, a[href], [role="button"]'));
      if (e.key === ' ' || e.code === 'Space') { if (onControl) return; e.preventDefault(); k.playPause(); return; }
      if (onControl) return; // let a focused control keep its own keys
      if (e.key === 'ArrowLeft') { k.nav('prevWord'); return; }
      if (e.key === 'ArrowRight') { k.nav('nextWord'); return; }
      if (e.key === 'ArrowUp') { k.nav('prevLine'); return; }
      if (e.key === 'ArrowDown') { k.nav('nextLine'); return; }
      if (e.key === 'PageUp') { e.preventDefault(); k.pageLines(-1); return; }
      if (e.key === 'PageDown') { e.preventDefault(); k.pageLines(1); return; }
      if (e.key === 'Home') { k.nav('restart'); return; }
      if (e.key === '-' || e.key === '_') { k.adjustWpm(-25); return; }
      if (e.key === '=' || e.key === '+') { k.adjustWpm(25); return; }
      if (e.key >= '1' && e.key <= '6') { k.togglePane(Number(e.key)); return; }
      if (key === 'j') { k.jumpToCurrent(); return; }
      if (key === 'u') { k.jumpToFrontier(); return; }
      if (key === 'g') { k.jumpToGap(); return; }
      if (key === 'a') { k.toggleReadAloud(); return; }
      if (key === 's') { k.toggleScrollRead(); return; }
      if (key === 'v') { k.toggleAudioCtrl(); return; }
      if (key === 'f') { k.toggleFocusMode(); return; }
      if (key === 'i') { k.dispatch({ type: 'TOGGLE_INCOGNITO' }); return; }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function triggerOpen(accept) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.onchange = () => input.files?.length && openFiles(input.files);
    input.click();
  }

  // Drag-drop file open
  useEffect(() => {
    function onDragOver(e) {
      e.preventDefault();
      setDragOver(true);
    }
    function onDragLeave(e) {
      if (e.target === document.documentElement || e.relatedTarget == null) setDragOver(false);
    }
    function onDrop(e) {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length) openFiles(files);
    }
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [openFiles]);

  // Speaking minigame: webkitSpeechRecognition
  useEffect(() => {
    if (!activeTab || !activeTab.settings.speaking?.enabled) {
      if (recognizerRef.current) {
        try { recognizerRef.current.stop(); } catch { /* ignore */ }
        recognizerRef.current = null;
      }
      return;
    }
    if (!speechRecognitionSupported()) {
      setStatus('Speaking mode requires Chrome/Edge (Web Speech Recognition API).');
      patchSettings(activeTab.id, { speaking: { ...activeTab.settings.speaking, enabled: false } });
      return;
    }
    const cfg = activeTab.settings.speaking;
    const minConf = cfg.confidence === 'High' ? 0.8 : cfg.confidence === 'Low' ? 0.3 : 0.55;
    const r = createRecognizer({
      lang: docLang.bcp,
      onResult: ({ transcript, confidence, isFinal }) => {
        if (!isFinal && !cfg.allowPartial) return;
        const target = activeTab.doc.words[activeTab.settings.wordIndex] || '';
        if ((confidence || 0) >= minConf && wordMatches(target, transcript)) {
          stepWord(1, { src: 'speak' });
        }
      },
      onError: (err) => {
        console.warn('Speech recognition error', err);
      },
    });
    if (r) {
      try { r.start(); } catch { /* ignore */ }
      recognizerRef.current = r;
    }
    return () => {
      if (recognizerRef.current) {
        try { recognizerRef.current.stop(); } catch { /* ignore */ }
        recognizerRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, [activeTab?.id, activeTab?.settings.speaking?.enabled, activeTab?.settings.wordIndex, docLang.bcp]);

  // Audiobook recording: capture per-line clips
  useEffect(() => {
    if (!activeTab) return;
    const want = !!activeTab.settings.audiobookRec;
    const curLine = getLineIndex(activeTab.doc, activeTab.settings.wordIndex);
    if (!want) {
      if (audioRecRef.current.rec) {
        try { audioRecRef.current.rec.stop(); } catch { /* ignore */ }
        audioRecRef.current = { rec: null, lineIndex: -1 };
      }
      return;
    }
    if (audioRecRef.current.lineIndex === curLine && audioRecRef.current.rec) return;
    // line changed: stop previous, start new
    if (audioRecRef.current.rec) {
      try { audioRecRef.current.rec.stop(); } catch { /* ignore */ }
    }
    const targetLine = curLine;
    recordClip({
      onStop: ({ blob, durationMs }) => {
        saveAudioClip(activeTab.doc.contentChecksum, targetLine, blob, durationMs).catch(() => {});
      },
    }).then((rec) => {
      audioRecRef.current = { rec, lineIndex: targetLine };
    });
    return () => {
      if (audioRecRef.current.rec) {
        try { audioRecRef.current.rec.stop(); } catch { /* ignore */ }
        audioRecRef.current = { rec: null, lineIndex: -1 };
      }
    };
    // eslint-disable-next-line
  }, [activeTab?.id, activeTab?.settings.audiobookRec, activeTab?.settings.wordIndex]);

  // Audio control (voice + clap)
  useEffect(() => {
    if (!activeTab?.settings.audioCtrl) {
      if (audioCtrlRef.current) {
        try { audioCtrlRef.current.stop(); } catch { /* ignore */ }
        audioCtrlRef.current = null;
      }
      if (clapRef.current) {
        try { clapRef.current.stop(); } catch { /* ignore */ }
        clapRef.current = null;
      }
      if (micScopeRef.current) { try { micScopeRef.current.stop(); } catch { /* ignore */ } micScopeRef.current = null; setMicScope(null); }
      return;
    }
    // Oscilloscope: a live waveform of the incoming mic audio while listening.
    if (micScopeSupported()) {
      startMicScope().then((s) => { micScopeRef.current = s; setMicScope(s); }).catch(() => {});
    }
    const mode = state.global.audioCtrlMode || 'Both';
    if (mode === 'Voice' || mode === 'Both') {
      const r = startVoiceCommands({
        // Match against the user's editable phrase list (read live via the ref so edits apply without
        // toggling voice off/on). Returns a commandId the registry runs.
        match: (t) => matchVoice(t, voiceCommandsRef.current),
        onHeard: ({ transcript, isFinal, command }) => {
          if (!isFinal) return;
          pushBioLog({ source: 'voice', text: transcript, action: command ? actionLabel(command) : null, tone: command ? 'valid' : 'noop' });
        },
        onCommand: (cmd) => { runCommand(cmd, cmdCtx()); },
      });
      audioCtrlRef.current = r;
    }
    if (mode === 'Claps' || mode === 'Both') {
      startClapDetector((claps) => {
        const cmap = { ...DEFAULT_CLAP_MAP, ...(state.global.clapMap || {}) };
        const cmdId = cmap[claps];
        if (cmdId) runCommand(cmdId, cmdCtx());
        pushBioLog({ source: 'voice', text: `👏 × ${claps}`, action: cmdId ? actionLabel(cmdId) : null, tone: cmdId ? 'valid' : 'noop' });
      }).then((cd) => (clapRef.current = cd)).catch(() => {});
    }
    return () => {
      if (audioCtrlRef.current) try { audioCtrlRef.current.stop(); } catch { /* ignore */ }
      audioCtrlRef.current = null;
      if (clapRef.current) try { clapRef.current.stop(); } catch { /* ignore */ }
      clapRef.current = null;
      if (micScopeRef.current) { try { micScopeRef.current.stop(); } catch { /* ignore */ } micScopeRef.current = null; setMicScope(null); }
    };
    // eslint-disable-next-line
  }, [activeTab?.id, activeTab?.settings.audioCtrl, state.global.audioCtrlMode]);

  // First-run disclaimer (seizure / not-advice / non-affiliation). Shown once;
  // reopen any time from View → About / Disclaimer.
  useEffect(() => {
    try {
      if (!localStorage.getItem('tachyread-disclaimer-ack')) openDialog({ kind: 'disclaimer' });
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line
  }, []);

  // Once-a-day desktop nudge to warm up the eyes before reading. Waits for stored settings to load
  // (globalHydrated) so a lastPrompt saved earlier today isn't missed, fires at most once per local
  // day, and never on mobile (the drills want a steady head + a real screen). Dismissed silently.
  const [warmupNudge, setWarmupNudge] = useState(false);
  const nudgeCheckedRef = useRef(false);
  useEffect(() => {
    if (nudgeCheckedRef.current || !state.globalHydrated || isCompact) return;
    nudgeCheckedRef.current = true;
    let acked = true;
    try { acked = !!localStorage.getItem('tachyread-disclaimer-ack'); } catch { /* ignore */ }
    if (!acked) return;
    const ew = state.global.eyeWarmup || {};
    if (ew.prompt === false) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (ew.lastPrompt === today) return;
    setWarmupNudge(true);
    updateGlobal({ eyeWarmup: { ...ew, lastPrompt: today } }); // stamp so it fires once/day even if ignored
  }, [state.globalHydrated, isCompact, state.global.eyeWarmup, updateGlobal]);
  function dismissWarmupNudge() { setWarmupNudge(false); }

  // One-click backup to the configured sync target (menu-bar ☁ Sync). Routes the user to setup when
  // the target isn't ready, otherwise pushes the backup and stamps lastSync.
  async function doSyncNow() {
    const cfg = state.global.sync;
    const p = cfg && getSyncProvider(cfg.provider);
    if (!p || !p.supported()) { setStatus('This browser can’t use that sync target — see File → Backup & Data.'); return; }
    const avail = p.available(cfg);
    if (avail !== true) { setStatus(avail.reason || 'Sync isn’t configured yet.'); openDialog({ kind: 'data' }); return; }
    setStatus('☁ Backing up…');
    try {
      const r = await backupToProvider(cfg.provider, cfg);
      updateGlobal({ sync: { ...cfg, lastSync: r.at } });
      setStatus(`☁ Backed up to ${p.label} (${Math.round(r.bytes / 1024)} KB).`);
    } catch (e) {
      setStatus('Sync failed: ' + (e?.message || e));
    }
  }

  // Auto-sync (when "Keep synced automatically" is on). Two halves, both fully silent — they only
  // reuse an existing grant and never pop a picker or sign-in on a timer:
  //   • boot: one two-way pull-merge-push so this device starts from the latest.
  //   • on change: a debounced push. The deps reset the 5s timer on every word step / settings tweak,
  //     so during continuous reading it never fires mid-stream — it pushes ~5s after you pause.
  const didBootSync = useRef(false);
  const pushTimer = useRef(null);
  const lastAutoPush = useRef(0);
  const autoReady = (cfg) => {
    const p = cfg?.auto ? getSyncProvider(cfg.provider) : null;
    return p && p.supported() && p.available(cfg) === true ? p : null;
  };
  useEffect(() => {
    const cfg = state.global.sync;
    if (didBootSync.current || !autoReady(cfg)) return;
    didBootSync.current = true;
    (async () => {
      try {
        await syncWithProvider(cfg.provider, cfg, { silent: true });
        updateGlobal({ sync: { ...cfg, lastSync: Date.now(), profile: getDriveProfile() || cfg.profile } });
      } catch { /* offline or no prior grant — use “Sync now” in Data once to grant */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.global.sync?.auto, state.global.sync?.provider]);
  useEffect(() => {
    const cfg = state.global.sync;
    const p = autoReady(cfg);
    if (!p) return undefined;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      try {
        if (Date.now() - lastAutoPush.current < 20000) return; // min gap — don't hammer the API
        if (!(await p.isConnected())) return;                  // only when a silent session exists
        const r = await backupToProvider(cfg.provider, cfg, { silent: true });
        lastAutoPush.current = r.at;
        updateGlobal({ sync: { ...cfg, lastSync: r.at, profile: getDriveProfile() || cfg.profile } });
      } catch { /* silent — the Data dialog surfaces errors */ }
    }, 5000);
    return () => clearTimeout(pushTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tabs, state.global.settingsUpdatedAt, state.global.sync?.auto, state.global.sync?.provider]);

  // Save a copy of the active tab's text to an external file (native Save dialog where supported).
  function doSaveTab() {
    if (!activeTab) return;
    openDialog({ kind: 'save-tab' });
  }

  // Save the active tab as TXT (text only) or PDF (for grabbed books: the captured page images +
  // a searchable text layer, so the source isn't lost).
  async function saveTabAs(format) {
    if (!activeTab) return;
    const doc = activeTab.doc;
    const base = (doc.fileName || 'document').replace(/\.[^.]+$/, '') || 'document';
    try {
      let res;
      if (format === 'pdf') {
        const blob = await buildTabPdf(doc);
        res = await saveBlobToFile(blob, `${base}.pdf`, [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]);
      } else {
        res = await saveTextToFile(doc.fullText || '', `${base}.txt`);
      }
      if (!res.canceled) setStatus(`Saved ${res.name}${res.method === 'download' ? ' to your downloads' : ''}.`);
    } catch (e) {
      setStatus(`Save failed: ${e?.message || e}`);
    }
  }

  // Apply a resource-wizard result (proper names / index / footnotes) to the active tab.
  function applyResource(payload) {
    if (!activeTab) return;
    if (payload.kind === 'names') {
      activeTab.doc.properNames = payload.map;
      patchSettings(activeTab.id, { enableProperNames: true, properNameSeed: payload.seed || [] });
      patchTab(activeTab.id, { _propNamesGen: (activeTab._propNamesGen || 0) + 1 });
      setStatus(`Proper names: ${payload.map.size} name(s) highlighted.`);
      openDialog({ kind: 'proper-names' });
    } else if (payload.kind === 'index') {
      const patch = { indexEntries: payload.entries };
      if (payload.skip) patch.skipRanges = mergeSkipRanges(activeTab.settings.skipRanges, [payload.skip]);
      patchSettings(activeTab.id, patch);
      if (!state.showIndex) dispatch({ type: 'TOGGLE_INDEX' });
      setStatus(`Index: ${payload.entries.length} term(s).`);
    } else if (payload.kind === 'notes') {
      activeTab.doc.footnotes = payload.map;
      if (payload.skip) patchSettings(activeTab.id, { skipRanges: mergeSkipRanges(activeTab.settings.skipRanges, [payload.skip]) });
      patchTab(activeTab.id, { _footnotesGen: (activeTab._footnotesGen || 0) + 1 });
      setStatus(`Footnotes: ${payload.map.size} found.`);
    }
  }

  function handleMenuAction(action) {
    if (action.startsWith('open-recent:')) return openRecent(action.slice(12));
    if (action === 'sync-now') return doSyncNow();
    if (action === 'save-tab' && activeTab) return doSaveTab();
    if (action === 'open-clip') return openClipboard();
    if (action === 'grab') return openDialog({ kind: 'grab' });
    if (action === 'web-grab') return openDialog({ kind: 'web-grab' });
    if (action === 'html-tools') return openDialog({ kind: 'html-tools' });
    if (action === 'api-usage') return openDialog({ kind: 'api-usage' });
    if (action === 'open-html-pick') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.html,.htm,.xhtml';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try { openDialog({ kind: 'html-structure', html: await f.text(), fileName: f.name.replace(/\.[^.]+$/, '') }); }
        catch (e) { setStatus('Could not read that file: ' + (e?.message || e)); }
      };
      input.click();
      return;
    }
    if (action === 'close-tab' && activeTab) {
      dispatch({ type: 'CLOSE_TAB', id: activeTab.id });
      return;
    }
    if (action === 'close-all') {
      closeAllTabs();
      return;
    }
    if (action === 'disconnect') {
      // Keep the saved session so reopening reconnects to these same files.
      const open = state.tabs.map((t) => ({ checksum: t.doc.contentChecksum, fileName: t.doc.fileName }));
      saveSession({ open, active: activeTab?.doc.contentChecksum || null }).catch(() => {});
      const finish = () => { setClosing('disconnect'); setTimeout(() => { try { window.close(); } catch { /* tab not script-opened */ } }, 50); };
      // Best-effort final backup if auto-sync is on and the target is silently usable.
      const cfg = state.global.sync;
      const p = cfg?.auto ? getSyncProvider(cfg.provider) : null;
      if (p) {
        setClosing('disconnect');
        (async () => {
          try { if (await p.isConnected()) { const r = await backupToProvider(cfg.provider, cfg, { silent: true }); updateGlobal({ sync: { ...cfg, lastSync: r.at, profile: getDriveProfile() || cfg.profile } }); } } catch { /* ignore */ }
          setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 50);
        })();
      } else {
        finish();
      }
      return;
    }
    if (action === 'shutdown') {
      // Clear the session and close every file tab so the next run starts clean.
      closeAllTabs();
      clearSession().catch(() => {});
      setClosing('shutdown');
      setTimeout(() => { try { window.close(); } catch { /* tab not script-opened */ } }, 50);
      return;
    }
    if (action === 'find' && activeTab) return openDialog({ kind: 'find' });
    if (action === 'goto' && activeTab) return openDialog({ kind: 'goto' });
    if (action === 'app-settings') return openDialog({ kind: 'app-settings' });
    if (action === 'biometric-settings') return openDialog({ kind: 'biometric-settings' });
    if (action === 'comfort-settings') return openDialog({ kind: 'comfort-settings' });
    if (action === 'toggle-lines') { dispatch({ type: 'TOGGLE_LINES' }); return; }
    if (action === 'typing-settings' && activeTab) return openDialog({ kind: 'typing-settings' });
    if (action === 'audio-settings' && activeTab) return openDialog({ kind: 'audio-settings' });
    if (action === 'font-manager' && activeTab) return openDialog({ kind: 'font-manager' });
    if (action === 'help') return openDialog({ kind: 'help' });
    if (action === 'data') return openDialog({ kind: 'data' });
    if (action === 'book-groups') return openDialog({ kind: 'book-groups' });
    if (action === 'literary-journey') return openDialog({ kind: 'literary-journey' });
    if (action === 'trackyread-book') {
      // Jump to the ACTIVE document's tracker book — or start linking it if it isn't tracked yet.
      const cs = activeTab?.doc?.contentChecksum;
      if (!cs) return openDialog({ kind: 'literary-journey' });
      getBinding().then((map) => {
        const bookId = map[cs] || null;
        openDialog({
          kind: 'literary-journey', tab: 'library',
          focusBookId: bookId,
          linkChecksum: bookId ? null : cs,
          linkFileName: activeTab.doc.fileName || '',
        });
      }).catch(() => openDialog({ kind: 'literary-journey' }));
      return;
    }
    if (action === 'def-settings') return openDialog({ kind: 'def-settings' });
    if (action === 'tab-settings' && activeTab) return openDialog({ kind: 'tab-settings' });
    if (action === 'reset-tab' && activeTab) {
      const defaults = state.global.fileDefaults || defaultFileSettings();
      patchSettings(activeTab.id, { ...defaults, wordIndex: activeTab.settings.wordIndex, contentChecksum: activeTab.settings.contentChecksum });
      return;
    }
    if (action === 'stats') return openDialog({ kind: 'stats' });
    if (action === 'progress-detail' && activeTab) return openDialog({ kind: 'progress-detail' });
    if (action === 'history') return openDialog({ kind: 'literary-journey', tab: 'rhistory' }); // history now lives inside Trackyread
    if (action === 'proper-names' && activeTab) return openDialog({ kind: 'proper-names' });
    if (action === 'toc-wizard' && activeTab) return openDialog({ kind: 'toc-wizard' });
    if (action === 'names-wizard' && activeTab) return openDialog({ kind: 'resource-wizard', resourceKind: 'names' });
    if (action === 'index-wizard' && activeTab) return openDialog({ kind: 'resource-wizard', resourceKind: 'index' });
    if (action === 'notes-wizard' && activeTab) return openDialog({ kind: 'resource-wizard', resourceKind: 'notes' });
    if (action === 'audiobook' && activeTab) return openDialog({ kind: 'audiobook' });
    if (action === 'notes' && activeTab) return openDialog({ kind: 'notes' });
    if (action === 'footnote' && activeTab) return setShowFootnote((s) => !s);
    if (action === 'typing' && activeTab) {
      patchSettings(activeTab.id, {
        typing: { ...activeTab.settings.typing, enabled: !activeTab.settings.typing?.enabled },
        speaking: { ...activeTab.settings.speaking, enabled: false },
        readAloud: false,
      });
      return;
    }
    if (action === 'tts-popup' && activeTab) return openDialog({ kind: 'tts-popup' });
    if (action === 'face-library') return openDialog({ kind: 'face-library' });
    if (action === 'disclaimer') return openDialog({ kind: 'disclaimer' });
    if (action === 'typing-progress') return openDialog({ kind: 'typing-progress' });
    if (action === 'typing-plans') return openDialog({ kind: 'typing-plan' });
    if (action === 'span-drill') return openDialog({ kind: 'span-drill' });
    if (action === 'eye-warmup') return openDialog({ kind: 'eye-warmup' });
    if (action === 'flow-writer') return openDialog({ kind: 'flow-writer' });
    if (action === 'vocab') return openDialog({ kind: 'vocab' });
    if (action === 'regressions' && activeTab) return openDialog({ kind: 'regressions' });
    if (action === 'attention' && activeTab) return openDialog({ kind: 'attention' });
    if (action === 'dictation') return openDialog({ kind: 'dictation' });
    if (action === 'ambient') return openDialog({ kind: 'ambient' });
    if (action === 'take-break') return setBreakSignal((n) => n + 1);
    if (action === 'toggle-incognito') { dispatch({ type: 'TOGGLE_INCOGNITO' }); return; }
    if (action === 'toggle-dark' && activeTab) {
      patchSettings(activeTab.id, { darkMode: !activeTab.settings.darkMode });
    }
  }

  // Shake-to-toggle full-screen reading (opt-in, mobile): a burst of ≥3 hard acceleration spikes
  // inside ~a second flips immersive mode, with a cooldown so one shake can't double-toggle.
  useEffect(() => {
    if (!isCompact || !state.global.shakeFullscreen) return undefined;
    let peaks = [];
    let lastToggle = 0;
    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (Math.abs(mag - 9.81) < 12) return; // ponytail: fixed threshold; expose a sensitivity slider if it misfires
      const now = Date.now();
      peaks = peaks.filter((t) => now - t < 1000);
      peaks.push(now);
      if (peaks.length >= 3 && now - lastToggle > 1500) {
        lastToggle = now;
        peaks = [];
        setImmersive((v) => !v);
      }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [isCompact, state.global.shakeFullscreen]);

  const hideWord = !state.showRsvp || !!activeTab?.settings?.hideRsvpPane;
  // On a phone showing only the Lines view, lock it to the viewport (no page scroll) so the lines
  // pane fills the whole screen (current line kept centred) instead of stacking at a fraction height.
  const linesLocked = isCompact && (mobileView === 'lines' || hideWord)
    && !state.showToc && !state.showSource && !state.showIndex;
  // On a phone, an open TOC / Source / Index takes over the reader's space (rather than stacking)
  // and pauses playback — there's no room to do both, and you're not reading the text then.
  const auxOpen = isCompact && (state.showToc || (state.showSource && !!activeTab?.doc?.source) || state.showIndex);
  const panesFull = linesLocked || auxOpen;

  // Mobile reading-view switch: show exactly one of ToC / Index (or neither → back to the reader).
  const showAuxOnly = (which) => {
    if (which !== 'toc' && state.showToc) dispatch({ type: 'TOGGLE_TOC' });
    if (which !== 'index' && state.showIndex) dispatch({ type: 'TOGGLE_INDEX' });
    if (which !== 'source' && state.showSource) dispatch({ type: 'TOGGLE_SOURCE' });
    if (which === 'toc' && !state.showToc) dispatch({ type: 'TOGGLE_TOC' });
    if (which === 'index' && !state.showIndex) dispatch({ type: 'TOGGLE_INDEX' });
    if (which === 'source' && !state.showSource) dispatch({ type: 'TOGGLE_SOURCE' });
  };
  // "Jump to current word": close any aux pane so a reader shows, then snap it to the current line.
  // Also drops any active peek — the trendline's peek marker must not linger once you've snapped back.
  const jumpToCurrent = () => {
    if (auxOpen) { showAuxOnly(null); setMobileView('lines'); }
    clearPeek();
    setRecenterKey((k) => k + 1);
  };
  // Jump to the first unread word after everything ever read (the reading frontier).
  const jumpToFrontier = () => {
    if (!activeTab?.tracker) return;
    jumpWord(activeTab.tracker.frontierIndex(), { nav: true, src: 'jump' });
    jumpToCurrent();
  };
  // Jump to the FIRST unread gap (skipped sections excluded); clicking again from that boundary hops
  // to the next read/unread boundary — a backfill cycle over the patchy sections.
  const jumpToGap = () => {
    const t = activeTabRef.current;
    if (!t?.tracker) return;
    const wi = t.tracker.nextUnreadBoundary(t.settings.wordIndex, t.settings.skipRanges || []);
    if (wi >= 0) { jumpWord(wi, { nav: true, src: 'jump' }); jumpToCurrent(); }
  };
  // Skip to the previous/next SOURCE page (a PDF page / EPUB·HTML section / grabbed image) — moves
  // the reading position to that segment's first word. Distinct from page-up/down (viewport lines).
  const jumpSourcePage = (delta) => {
    const at = activeTabRef.current; // ref, so a memoized SourcePane never calls a stale closure
    const doc = at?.doc;
    const w2s = doc?.wordToSegment;
    if (!w2s || !doc.segmentCount) return;
    const cur = w2s[Math.min(at.settings.wordIndex, w2s.length - 1)] || 0;
    const target = Math.max(0, Math.min(doc.segmentCount - 1, cur + delta));
    let wi = 0;
    for (let i = 0; i < w2s.length; i++) { if (w2s[i] === target) { wi = i; break; } }
    jumpWord(wi, { nav: true, src: 'jump' });
  };

  // ── Mode helpers (shared by the controls bar and keyboard shortcuts). Full read-aloud TTS drives the
  // position, so it's mutually exclusive with the speak-along FOLLOW modes AND with voice commands (and
  // with scroll-to-read, which paces itself): turning read-aloud on clears those; turning FOLLOW or
  // VOICE on clears read-aloud.
  function setReadAloud(on) {
    if (!activeTab) return;
    patchSettings(activeTab.id, {
      readAloud: on,
      ...(on ? {
        ttsFollowMode: 'off', firstWordTts: false, audioCtrl: false,
        typing: { ...activeTab.settings.typing, enabled: false },
        speaking: { ...activeTab.settings.speaking, enabled: false },
      } : {}),
    });
    if (on && state.global.scrollAdvances) updateGlobal({ scrollAdvances: false });
  }
  function toggleReadAloud() { if (activeTab) setReadAloud(!activeTab.settings.readAloud); }
  function setAudioCtrl(on) {
    if (!activeTab) return;
    patchSettings(activeTab.id, { audioCtrl: on, ...(on ? { readAloud: false } : {}) });
  }
  function toggleAudioCtrl() { if (activeTab) setAudioCtrl(!activeTab.settings.audioCtrl); }
  function toggleScrollRead() {
    const on = !state.global.scrollAdvances;
    updateGlobal({ scrollAdvances: on });
    if (on && activeTab?.settings.readAloud) setReadAloud(false);
  }
  function adjustWpm(delta) {
    if (!activeTab) return;
    const cur = Number(activeTab.settings.wpm) || 300;
    patchSettings(activeTab.id, { wpm: Math.max(50, Math.min(2000, cur + delta)) });
  }
  // Cycle focus across the whole tab strip (dialog tabs first, then document tabs) — Ctrl+PageUp/Down.
  function cycleTabs(dir) {
    const all = [...state.panels.map((p) => ({ kind: 'panel', id: p.id })), ...state.tabs.map((t) => ({ kind: 'doc', id: t.id }))];
    if (all.length < 2) return;
    let i = state.activePanelId != null
      ? all.findIndex((x) => x.kind === 'panel' && x.id === state.activePanelId)
      : all.findIndex((x) => x.kind === 'doc' && x.id === state.activeTabId);
    if (i < 0) i = 0;
    const next = all[(i + dir + all.length) % all.length];
    if (next.kind === 'panel') setActivePanel(next.id); else setActiveTab(next.id);
  }
  // Toggle a reading pane by its number-key (1 Fast Reader · 2 Lines · 3 ToC · 4 Stats · 5 Index · 6 Faces).
  function togglePane(n) {
    if (n === 1) dispatch({ type: 'TOGGLE_SHOW_RSVP' });
    else if (n === 2) dispatch({ type: 'TOGGLE_LINES' });
    else if (n === 3) dispatch({ type: 'TOGGLE_TOC' });
    else if (n === 4) dispatch({ type: 'TOGGLE_STATS' });
    else if (n === 5) dispatch({ type: 'TOGGLE_INDEX' });
    else if (n === 6 && activeTab) patchSettings(activeTab.id, { showEyes: !activeTab.settings.showEyes });
  }

  // Refresh the key handler's live context every render (handler is bound once, reads from this ref).
  kbdRef.current = {
    activeTab, state, showFootnote, playPause, nav, pageLines, jumpToCurrent, triggerOpen,
    openClipboard, openDialog, closeDialog, setShowFootnote, toggleFocusMode, dispatch,
    toggleReadAloud, toggleAudioCtrl, toggleScrollRead, adjustWpm, cycleTabs, togglePane, jumpToFrontier, jumpToGap,
  };

  // Maximise the text on a phone. The Lines view is for immersive (often thumb-scrolled) reading, so
  // tuck the top chrome AND minimise the controls dock to their handles whenever it's showing — the
  // lines pane then fills the screen. The Fast Reader view does the same only while playing, and only
  // if the user opted into auto-minimise. Either ⌃/⌄ handle pulls its bar back any time.
  useEffect(() => {
    if (!isCompact) return;
    const inLines = mobileView === 'lines' || hideWord;
    const minimize = inLines || (state.global.autoMinimizeControls && playing);
    setControlsCollapsed(minimize);
    setChromeHidden(minimize);
  }, [playing, isCompact, mobileView, hideWord, state.global.autoMinimizeControls]);
  // Mobile-only quarter-turn applied to just the reader box (not the menus/controls).
  const readerRotation = state.global.readerRotation || 0;

  // Lock the app to portrait: the web has no reliable cross-platform orientation lock, so when a phone
  // is physically turned to landscape we counter-rotate the WHOLE app by -angle — undoing the browser's
  // auto-rotation so the layout stays portrait instead of reflowing. Only fires on a compact/touch
  // device in landscape at a quarter-turn (angle 90/270), so it's a no-op on desktop and on tablets
  // used in their natural orientation. The manual ⟳ reader rotation is independent of this.
  const lockPortrait = state.global.lockPortrait !== false;
  const [forcePortrait, setForcePortrait] = useState(null); // counter-rotation in degrees, or null
  useEffect(() => {
    const evaluate = () => {
      const landscape = window.innerWidth > window.innerHeight;
      if (!lockPortrait || !isCompactScreen() || !landscape) { setForcePortrait(null); return; }
      let angle;
      if (typeof window.screen?.orientation?.angle === 'number') angle = window.screen.orientation.angle;
      else if (typeof window.orientation === 'number') angle = window.orientation === 90 ? 270 : window.orientation === -90 ? 90 : Math.abs(window.orientation);
      else angle = 90; // unknown but landscape → assume a quarter turn
      setForcePortrait(angle === 90 || angle === 270 ? -angle : null);
    };
    evaluate();
    window.addEventListener('resize', evaluate);
    window.addEventListener('orientationchange', evaluate);
    window.screen?.orientation?.addEventListener?.('change', evaluate);
    return () => {
      window.removeEventListener('resize', evaluate);
      window.removeEventListener('orientationchange', evaluate);
      window.screen?.orientation?.removeEventListener?.('change', evaluate);
    };
  }, [lockPortrait]);

  // Opening an aux pane on a phone pauses playback (you're navigating, not reading the text).
  useEffect(() => {
    if (auxOpen && playing) { engineRef.current.pause(); setPlaying(false); cancelSpeech(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auxOpen]);

  // Data-driven resizable pane set. Visibility toggles add/remove entries; the last pane
  // (Lines) flexes, the rest take draggable pixel widths from paneWidths.
  const panes = useMemo(() => {
    if (!activeTab) return [];
    const arr = [];
    if (state.showToc)
      arr.push({
        id: 'toc',
        label: 'ToC',
        node: (
          <TocPane
            tab={activeTab}
            onJumpWord={jumpWord}
            onScrollToLine={peekToLine}
            onSetSectionGoal={setSectionGoal}
            onPatch={(p) => patchSettings(activeTab.id, p)}
            onWizard={() => openDialog({ kind: 'toc-wizard' })}
            flashSignal={tocFlash}
          />
        ),
      });
    // Face & Stats no longer live among the reading panes — they sit to the left of the controls
    // bar (see the bottom dock below), so the reading area is just the reading views.
    // On compact screens show exactly one reading view at a time (Fast Reader OR Lines) so the
    // single column isn't a long scroll past two stacked readers. Desktop keeps both side by side.
    let showRsvpPane = !hideWord;
    let showLinesPane = state.showLines !== false; // desktop Lines-pane toggle (View menu / panel bar)
    if (isCompact) {
      if (auxOpen) { showRsvpPane = false; showLinesPane = false; } // TOC/Source/Index takes the reader's space
      else if (hideWord) { showRsvpPane = false; showLinesPane = true; }
      else if (mobileView === 'rsvp') { showRsvpPane = true; showLinesPane = false; }
      else { showRsvpPane = false; showLinesPane = true; }
    }
    if (showRsvpPane) arr.push({ id: 'rsvp', label: 'Fast Reader', node: <RsvpPane tab={activeTab} onVisible={onRsvpVisible} /> });
    if (state.showSource && activeTab.doc.source)
      arr.push({ id: 'source', label: 'Source', node: <SourcePane tab={activeTab} onPatch={(p) => patchSettings(activeTab.id, p)} onSourcePage={jumpSourcePage} /> });
    if (state.showIndex)
      arr.push({ id: 'index', label: 'Index', node: <IndexPane tab={activeTab} onJumpWord={jumpWord} onWizard={() => openDialog({ kind: 'resource-wizard', resourceKind: 'index' })} /> });
    if (showLinesPane) arr.push({
      id: 'lines',
      label: 'Lines',
      node: (
        <LinePane
          tab={{ ...activeTab, patchSettings: (p) => patchSettings(activeTab.id, p) }}
          onJumpWord={jumpWord}
          hideMode={activeTab.settings.hideMode || 'None'}
          peek={peek}
          visibleRef={linesVisibleRef}
          onVisible={onLinesVisible}
          compact={isCompact}
          scrollRead={state.global.scrollAdvances}
          scrollCmd={scrollCmd}
          recenterKey={recenterKey}
          onAddNote={(wi) => { jumpWord(wi); openDialog({ kind: 'notes' }); }}
        />
      ),
    });
    return arr;
    // eslint-disable-next-line
  }, [activeTab, state.showToc, state.showStats, state.showSource, state.showIndex, state.showLines, hideWord, peek, tocFlash, isCompact, mobileView, auxOpen, onRsvpVisible, onLinesVisible, state.global.scrollAdvances, scrollCmd, recenterKey]);

  // One derived `dialog` drives the whole render block below: a blocking modal wins, otherwise the
  // focused dialog tab. When it's a panel (no modal), `dialogDocked` restyles it from a centered
  // overlay into a non-blocking docked side panel — the tab's content, essentially.
  const dialog = state.modal || state.panels.find((p) => p.id === state.activePanelId) || null;
  const dialogDocked = !state.modal && !!dialog;
  // Doc-scoped dialog tabs render against the file they were OPENED for (their stamped docTabId),
  // not whatever tab is active now — so peeking another book can't retarget an open Audiobook/Notes
  // tab. Unscoped dialogs keep following the active tab.
  const dlgTab = dialog?.docTabId != null
    ? (() => { const t = state.tabs.find((tt) => tt.id === dialog.docTabId); return t && !t.lazy ? t : null; })()
    : activeTab;

  return (
    <div
      className={`app${state.incognito ? ' incognito' : ''}${state.global.focusMode ? ' focus-on' : ''}${forcePortrait != null ? ' force-portrait' : ''}${isCompact && immersive ? ' immersive' : ''}`}
      style={forcePortrait != null ? { transform: `translate(-50%, -50%) rotate(${forcePortrait}deg)` } : undefined}
    >
      {isCompact && immersive && (
        <button className="immersive-exit" title="Exit full-screen reading" aria-label="Exit full-screen reading" onClick={() => setImmersive(false)}>⛶</button>
      )}
      <header className={`app-chrome${isCompact && chromeHidden ? ' collapsed' : ''}`}>
        <div className="chrome-body">
          <MenuBar onFileOpen={openFiles} onAction={handleMenuAction} />
          <TabBar />
        </div>
        {isCompact && (
          <button
            className="chrome-handle"
            onClick={() => setChromeHidden((h) => !h)}
            title={chromeHidden ? 'Show menu & tabs' : 'Hide menu & tabs — more room for text'}
            aria-label={chromeHidden ? 'Show menu and tabs' : 'Hide menu and tabs'}
          >
            <span className="dock-grip" />
            <span className="dock-handle-label">{chromeHidden ? '⌄ menu & tabs' : '⌃'}</span>
          </button>
        )}
      </header>
      <div className="content-area">
      {state.incognito && (
        <div className="incognito-banner" role="status">
          <span className="incog-eyes">🕶</span>
          <span className="incog-text"><b>Incognito reading</b> — tracking is off. Nothing is recorded, and your place rewinds when you turn this off.</span>
          <button className="incog-off" onClick={() => dispatch({ type: 'TOGGLE_INCOGNITO' })}>Turn off</button>
        </div>
      )}
      {warmupNudge && (
        <div className="ew-nudge" role="status">
          <span>👁️ First read of the day — warm up your eyes first?</span>
          <span className="grow" />
          <button className="toggle-on" onClick={() => { dismissWarmupNudge(); openDialog({ kind: 'eye-warmup' }); }}>Warm up ▸</button>
          <button onClick={dismissWarmupNudge}>Not today</button>
          <button onClick={() => { dismissWarmupNudge(); updateGlobal({ eyeWarmup: { ...(state.global.eyeWarmup || {}), prompt: false } }); }}>Don’t ask</button>
          <button className="ew-nudge-x" title="Dismiss" onClick={dismissWarmupNudge}>×</button>
        </div>
      )}
      {/* The reading view stays MOUNTED (just hidden) while a dialog tab is focused, so closing the
          dialog returns to exactly the line you were on instead of remounting at the top. */}
      {(activeTab || !dialogDocked) && (activeTab ? (
        <div className="main-wrap" style={dialogDocked ? { display: 'none' } : undefined}>
          <ChapterHeading tab={activeTab} onJumpWord={jumpWord} />
          {isCompact && (
            <div className="reading-view-switch" role="tablist" aria-label="Reading view">
              {!hideWord && (
                <button
                  role="tab"
                  aria-selected={!auxOpen && mobileView === 'rsvp'}
                  className={!auxOpen && mobileView === 'rsvp' ? 'on' : ''}
                  onClick={() => { showAuxOnly(null); setMobileView('rsvp'); }}
                >
                  ⚡ Fast
                </button>
              )}
              <button
                role="tab"
                aria-selected={!auxOpen && mobileView === 'lines'}
                className={!auxOpen && mobileView === 'lines' ? 'on' : ''}
                onClick={() => { showAuxOnly(null); setMobileView('lines'); }}
              >
                ☰ Lines
              </button>
              <button
                role="tab"
                aria-selected={state.showToc}
                className={state.showToc ? 'on' : ''}
                onClick={() => showAuxOnly(state.showToc ? null : 'toc')}
              >
                📖 ToC
              </button>
              <button
                role="tab"
                aria-selected={state.showIndex}
                className={state.showIndex ? 'on' : ''}
                onClick={() => showAuxOnly(state.showIndex ? null : 'index')}
              >
                🔎 Index
              </button>
              {activeTab?.doc?.source && (
                <button
                  role="tab"
                  aria-selected={state.showSource}
                  className={state.showSource ? 'on' : ''}
                  onClick={() => showAuxOnly(state.showSource ? null : 'source')}
                >
                  🗐 Source
                </button>
              )}
              {!auxOpen && (
                <>
                  {/* Reader-area content toggles (faces / stats / incognito) live HERE on the top
                      bar with the rotate/lock buttons — not buried in the menu drawer. */}
                  <button
                    className={`rv-rotate${activeTab?.settings?.showEyes ? ' on' : ''}`}
                    title="Toggle the animated reader faces"
                    aria-pressed={!!activeTab?.settings?.showEyes}
                    onClick={() => activeTab && patchSettings(activeTab.id, { showEyes: !activeTab.settings.showEyes })}
                  >
                    🙂
                  </button>
                  <button
                    className={`rv-rotate${state.showStats ? ' on' : ''}`}
                    title="Toggle the reading stats"
                    aria-pressed={state.showStats}
                    onClick={() => dispatch({ type: 'TOGGLE_STATS' })}
                  >
                    📊
                  </button>
                  <button
                    className={`rv-rotate${state.incognito ? ' on' : ''}`}
                    title="Incognito reading — pause all tracking and persistence"
                    aria-pressed={state.incognito}
                    onClick={() => dispatch({ type: 'TOGGLE_INCOGNITO' })}
                  >
                    🕶
                  </button>
                  {/* Full-screen reading: hide ALL chrome (menus, tabs, controls, status) — a tiny
                      ⛶ overlay (or a vigorous shake, if enabled) brings it back. */}
                  <button
                    className="rv-rotate"
                    title="Full-screen reading — hides all menus and controls (tap the small ⛶ overlay to exit)"
                    aria-label="Full-screen reading"
                    onClick={() => setImmersive(true)}
                  >
                    ⛶
                  </button>
                  {/* Rotate JUST the reader box (not the menus/controls) by a quarter-turn. */}
                  <button
                    className={`rv-rotate rv-rot${readerRotation ? ' on' : ''}`}
                    title="Rotate the reader 90° (mobile only)"
                    aria-label={`Rotate reader (currently ${readerRotation}°)`}
                    onClick={() => updateGlobal({ readerRotation: ((state.global.readerRotation || 0) + 90) % 360 })}
                  >
                    ⟳{readerRotation ? ` ${readerRotation}°` : ''}
                  </button>
                  {/* Lock the whole app to portrait — ignore the phone's physical auto-rotate. */}
                  <button
                    className={`rv-rotate${lockPortrait ? ' on' : ''}`}
                    title={lockPortrait ? 'Portrait locked — the app ignores the phone’s auto-rotate. Tap to allow landscape.' : 'Tap to lock portrait (ignore the phone’s auto-rotate)'}
                    aria-label="Lock portrait orientation"
                    aria-pressed={lockPortrait}
                    onClick={() => updateGlobal({ lockPortrait: !lockPortrait })}
                  >
                    {lockPortrait ? '🔒' : '🔓'}
                  </button>
                </>
              )}
            </div>
          )}
          <div className={`main-area${panesFull ? ' panes-full' : ''}`} {...gestureHandlers}>
            {isCompact && readerRotation && !auxOpen ? (
              <ReaderRotator rotation={readerRotation}>
                <PaneLayout panes={panes} widths={paneWidths} onResize={resizePane} />
              </ReaderRotator>
            ) : (
              <PaneLayout panes={panes} widths={paneWidths} onResize={resizePane} />
            )}
            {activeTab.settings.typing?.enabled && (
              <TypingRun
                key={planState ? `plan-${planState.step}-${planState.set}` : 'single'}
                tab={activeTab}
                onPatch={(p) => patchSettings(activeTab.id, p)}
                onExitDiscard={planState ? exitPlan : () => patchSettings(activeTab.id, { typing: { ...activeTab.settings.typing, enabled: false } })}
                onExitContinue={planState ? undefined : (wi) => {
                  // Typed-through text counts as read, tagged as typing (no pace/efficiency credit).
                  const cur = activeTab.settings.wordIndex;
                  if (wi > cur && !incognitoRef.current) activeTab.tracker?.markRangeRead(cur, wi, 'typing');
                  jumpWord(wi);
                  patchSettings(activeTab.id, { typing: { ...activeTab.settings.typing, enabled: false } });
                }}
                onSaveRun={onSaveTypingRun}
                sessionRuns={typingRuns}
                endFanfare={state.global.typingEndFanfare !== false}
                plan={planState ? {
                  name: planState.plan.name,
                  step: planState.step + 1,
                  steps: planState.plan.steps.length,
                  set: planState.set + 1,
                  sets: Math.max(1, planState.plan.steps[planState.step].sets || 1),
                } : null}
                onPlanNext={advancePlan}
                onPlanExit={exitPlan}
              />
            )}
            {showFootnote && <FootnoteOverlay tab={activeTab} onClose={() => setShowFootnote(false)} />}
          </div>
        </div>
      ) : rawActiveTab?.lazy ? (
        <div className="empty-state">
          <div className="loading-spin" aria-hidden="true" />
          <h1>Opening {rawActiveTab.fileName}…</h1>
          <p>Loading this document for the first time this session.</p>
        </div>
      ) : (
        <div className="empty-state">
          <img className="empty-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Tachyread — the astral gavage goose" width="132" height="132" />
          <h1>Tachyread</h1>
          <p>Open a file (File → Open TXT, Ctrl+O), open a document (Ctrl+D), or drop a file here.</p>
          <p>Supports .txt, .md, .html, .docx, .pdf, .epub.</p>
          {state.tabs.length > 0 && <p>Or pick one of your {state.tabs.length} open tab(s) above.</p>}
          <p className="hint">Shortcuts: Space play, ←→ word, ↑↓ line, Ctrl+↑↓ paragraph, Home restart, Ctrl+F find</p>
        </div>
      ))}
      {/* A docked dialog tab portals its content in here, filling the tab's page (controls stay below). */}
      <div className="dialog-slot" ref={dialogSlotRef} />
      </div>
      {/* A docked dialog (settings/tools screen) fills the content area — the reading controls
          below it belong to the hidden reader, so hide them too (they read as residual state). */}
      <div className={`controls-dock${controlsCollapsed ? ' collapsed' : ''}`} style={dialogDocked ? { display: 'none' } : undefined}>
        <div className="dock-handle-bar">
          <button
            className="dock-handle"
            onClick={() => setControlsCollapsed((c) => !c)}
            title={controlsCollapsed ? 'Show controls' : 'Minimize controls — more room for text'}
            aria-label={controlsCollapsed ? 'Show controls' : 'Minimize controls'}
          >
            <span className="dock-grip" />
            <span className="dock-handle-label">{controlsCollapsed ? '⌃ controls' : '⌄'}</span>
          </button>
        </div>
        {controlsCollapsed ? (
          activeTab && (
            <div className="dock-mini">
              {(() => {
                const pv = playButtonView({
                  playing,
                  scrollMode: !!state.global.scrollAdvances,
                  readAloud: !!activeTab.settings.readAloud,
                  offlineVoice: !!state.global.offlineVoice,
                  followMode: activeTab.settings.ttsFollowMode || (activeTab.settings.firstWordTts ? 'firstWord' : 'off'),
                  timerMin: state.global.ttsAutoStopMin || 0,
                  adapt: !!activeTab.settings.adaptivePace,
                  voiceCmd: !!activeTab.settings.audioCtrl,
                });
                return (
                  <button
                    className={`play-btn-mini${pv.cls ? ' ' + pv.cls : ''}`}
                    disabled={pv.disabled}
                    title={pv.title}
                    onClick={pv.disabled ? undefined : playPause}
                  >
                    {pv.glyph}
                  </button>
                );
              })()}
              {/* The collapsed dock has room for the core nav, not just play — so paging through a
                  book (esp. with a pane hidden) doesn't force expanding the controls. */}
              <button className="dock-mini-nav" title="Page up (⇞)" aria-label="Page up" onClick={() => pageLines(-1)}>⇞</button>
              <button className="dock-mini-nav" title="Previous line (↑)" aria-label="Previous line" onClick={() => nav('prevLine')}>↑</button>
              <button className="dock-mini-nav" title="Next line (↓)" aria-label="Next line" onClick={() => nav('nextLine')}>↓</button>
              <button className="dock-mini-nav" title="Page down (⇟)" aria-label="Page down" onClick={() => pageLines(1)}>⇟</button>
              {activeTab.doc.source && state.showSource && (
                <>
                  <button className="dock-mini-nav src" title="Previous source page" aria-label="Previous source page" onClick={() => jumpSourcePage(-1)}>◀▤</button>
                  <button className="dock-mini-nav src" title="Next source page" aria-label="Next source page" onClick={() => jumpSourcePage(1)}>▤▶</button>
                </>
              )}
              <button className="dock-mini-jump" title="Jump to the current word" aria-label="Jump to current word" onClick={jumpToCurrent}>⌖</button>
              <span className="dock-mini-meta">{activeTab.settings.wordIndex + 1} / {activeTab.doc.words.length}</span>
            </div>
          )
        ) : (
        <div className="dock-row">
        {/* Dock faces/stats — unless chip mode is on (mobile always; desktop opt-in), where they
            float as draggable transparent chips instead so the dock stays out of the way. */}
        {!chips && activeTab && (activeTab.settings.showEyes || state.showStats) && (
          <div className="dock-dash">
            <DashboardPane tab={activeTab} dock showFaces={!!activeTab.settings.showEyes} showStats={state.showStats} />
          </div>
        )}
        {activeTab ? (
          <ControlsBar
            tab={activeTab}
            playing={playing}
            readingMode={readingMode}
            modeIdleFrac={modeIdleFrac}
            onJumpWord={jumpWord}
            onPeek={(wi) => peekToLine(getLineIndex(activeTab.doc, wi))}
            peekIdx={peek.line >= 0 ? (activeTab.doc.lines[peek.line]?.startWordIndex ?? -1) : -1}
            onConfirmFinished={() => openDialog({ kind: 'finished' })}
            audioCtrl={!!activeTab.settings.audioCtrl}
            readAloud={!!activeTab.settings.readAloud}
            onToggleFocus={toggleFocusMode}
            onToggleReadAloud={toggleReadAloud}
            onPlayPause={playPause}
            onPrevWord={() => nav('prevWord')}
            onNextWord={() => nav('nextWord')}
            onPrevLine={() => nav('prevLine')}
            onNextLine={() => nav('nextLine')}
            onPrevPara={() => nav('prevPara')}
            onNextPara={() => nav('nextPara')}
            onPageUp={() => pageLines(-1)}
            onPageDown={() => pageLines(1)}
            onRestart={() => nav('restart')}
            onToggleAudioCtrl={toggleAudioCtrl}
            onGoalComplete={onGoalComplete}
            goalKills={goalKills}
            onTocIcon={onTocIcon}
            onJumpToCurrent={jumpToCurrent}
            onJumpToFrontier={jumpToFrontier}
            onJumpToGap={jumpToGap}
          />
        ) : (
          <div className="controls-bar" style={{ opacity: 0.5 }}>
            <div className="progress-row"><div className="progress-bar" /><div className="progress-meta">— / —</div></div>
          </div>
        )}
        </div>
        )}
      </div>
      <div className="app-status">
        {state.global.showPerfMeter && <PerfMonitor />}
        <span className="app-status-text">{state.appStatus}</span>
        {playing && !!activeTab?.settings?.readAloud && (
          <span className="webcam-badge wb-watching" title="Read-aloud voice + how much of this book is pre-generated as an audiobook. Pre-generate more in Audio → Audiobook Manager for lock-screen playback (ungenerated parts use the light native voice).">
            🗣 {state.global.offlineVoice ? voiceLabel(state.global.offlineVoiceId || defaultVoiceForLang(state.global.language || 'en')).split(' · ')[0] : (activeTab.settings.annunciateVoice || 'browser voice')}
            {abCoverage ? ` · 📚 ${abCoverage.pct}%` : ''}
            {ttsStatus === 'native' ? ' · native' : ''}
          </span>
        )}
        {camOn && webcamState !== 'off' && (
          <button className={`webcam-badge wb-${webcamState}`} title={state.global.webcamPreview ? 'Webcam — frames are analysed on your device and never leave it' : 'Show the camera popup'} onClick={() => updateGlobal({ webcamPreview: true })}>
            📷 {WEBCAM_LABEL[webcamState] || webcamState}
          </button>
        )}
        {handGesturesOn && handState !== 'off' && (
          <button className={`webcam-badge wb-${handState.startsWith('scroll') || handState === 'hand' ? 'watching' : handState}`} title={state.global.webcamPreview ? 'Hand gestures — open palm above/below rest scrolls (farther = faster), a wave toggles play/pause. Frames stay on your device.' : 'Show the camera popup'} onClick={() => updateGlobal({ webcamPreview: true })}>
            🖐 {HAND_LABEL[handState] || handState}
          </button>
        )}
        {audioCtrlOn && (
          <button className="webcam-badge wb-watching" title={state.global.webcamPreview !== false ? 'Voice / clap commands listening — audio is analysed on your device.' : 'Show the Biometric Control Feed'} onClick={() => updateGlobal({ webcamPreview: true })}>
            🎤 listening
          </button>
        )}
      </div>

      {/* Dialogs. A docked (tab) panel portals into the .dialog-slot inside .content-area so it fills
          the tab's page; a blocking modal renders here as a centered full-screen overlay. */}
      {dialog && (() => {
        const inner = (<>
      {dialog?.kind === 'find' && activeTab && (
        <FindDialog
          tab={activeTab}
          onJumpWord={jumpWord}
          onPeek={(li) => peekToLine(li)}
          onSetGoal={(wi, label) => { const cur = activeTab.settings.wordIndex || 0; setSectionGoal(Math.min(cur, wi), Math.max(cur, wi) + 1, label); }}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'goto' && activeTab && (
        <GoToLineDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'tab-settings' && dlgTab && (
        <SettingsDialog
          settings={dlgTab.settings}
          onPatch={(p) => patchSettings(dlgTab.id, p)}
          onClose={closeDialog}
          title="Tab Settings"
          onOpenFontManager={() => openDialog({ kind: 'font-manager' })}
          diffAgainst={{ other: state.global.fileDefaults || {}, label: 'Differs from your defaults:', resettable: true }}
          profiles={state.global.settingsProfiles}
          onProfilesChange={(p) => updateGlobal({ settingsProfiles: p })}
        />
      )}
      {dialog?.kind === 'typing-settings' && dlgTab && (
        <TypingSettingsDialog
          settings={dlgTab.settings}
          onPatch={(p) => patchSettings(dlgTab.id, p)}
          global={state.global}
          onPatchGlobal={updateGlobal}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'audio-settings' && dlgTab && (
        <AudioSettingsDialog
          settings={dlgTab.settings}
          onPatch={(p) => patchSettings(dlgTab.id, p)}
          global={state.global}
          onPatchGlobal={updateGlobal}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'font-manager' && dlgTab && (
        <FontManagerDialog
          tab={dlgTab}
          global={state.global}
          onPatchSettings={(p) => patchSettings(dlgTab.id, p)}
          onPatchGlobal={updateGlobal}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'help' && <HelpDialog onClose={closeDialog} />}
      {dialog?.kind === 'def-settings' && (
        <SettingsDialog
          settings={state.global.fileDefaults}
          onPatch={(p) => updateGlobal({ fileDefaults: { ...state.global.fileDefaults, ...p } })}
          onClose={closeDialog}
          title="Default Tab Settings"
          diffAgainst={activeTab ? { other: activeTab.settings, label: 'The open tab differs on:', resettable: false } : null}
          matchCurrent={activeTab ? () => tabDefaultsFrom(activeTab.settings) : null}
          onResetFactory={() => { const d = defaultFileSettings(); updateGlobal({ fileDefaults: d }); return d; }}
        />
      )}
      {dialog?.kind === 'app-settings' && (
        <AppSettingsDialog
          global={state.global}
          onPatch={(p) => updateGlobal(p)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'biometric-settings' && (
        <BiometricControlsDialog
          global={state.global}
          onPatch={(p) => updateGlobal(p)}
          onCalibrate={() => openDialog({ kind: 'webcam-calib' })}
          onCalibrateHand={() => openDialog({ kind: 'hand-calib' })}
          isCompact={isCompact}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'comfort-settings' && (
        <ComfortSettingsDialog
          global={state.global}
          onPatch={(p) => updateGlobal(p)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'data' && <DataDialog onClose={closeDialog} />}
      {dialog?.kind === 'book-groups' && <BookGroupsDialog onClose={closeDialog} />}
      {dialog?.kind === 'stats' && (
        <StatisticsDialog tabs={state.tabs} activeTabId={state.activeTabId} onClose={closeDialog} />
      )}
      {dialog?.kind === 'literary-journey' && (
        <LiteraryJourneyDialog global={state.global} onPatch={(p) => updateGlobal(p)} initialTab={dialog.tab} focusBookId={dialog.focusBookId} linkChecksum={dialog.linkChecksum} linkFileName={dialog.linkFileName} onClose={closeDialog} />
      )}
      {dialog?.kind === 'proper-names' && dlgTab && (
        <ProperNamesDialog
          tab={dlgTab}
          onJumpWord={jumpWord}
          onWizard={() => openDialog({ kind: 'resource-wizard', resourceKind: 'names' })}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'audiobook' && dlgTab && (
        <AudiobookDialog tab={dlgTab} onClose={closeDialog} />
      )}
      {dialog?.kind === 'notes' && dlgTab && (
        <NotesDialog tab={dlgTab} onJumpWord={(wi) => jumpWord(wi)} onClose={closeDialog} />
      )}
      {dialog?.kind === 'tts-popup' && dlgTab && (
        <TtsPopupDialog tab={dlgTab} onClose={closeDialog} />
      )}
      {dialog?.kind === 'face-library' && <FaceLibraryDialog onClose={closeDialog} />}
      {dialog?.kind === 'disclaimer' && (
        <DisclaimerDialog
          onClose={() => {
            try { localStorage.setItem('tachyread-disclaimer-ack', '1'); } catch { /* ignore */ }
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === 'typing-progress' && <TypingProgressDialog onClose={closeDialog} />}
      {dialog?.kind === 'span-drill' && <SpanDrillDialog doc={activeTab?.doc} onClose={closeDialog} />}
      {dialog?.kind === 'eye-warmup' && <EyeWarmupDialog onClose={closeDialog} />}
      {dialog?.kind === 'flow-writer' && <FlowWriterDialog doc={activeTab?.doc} onClose={closeDialog} />}
      {dialog?.kind === 'dictation' && <DictationDialog onClose={closeDialog} />}
      {dialog?.kind === 'ambient' && <AmbientDialog onClose={closeDialog} />}
      {dialog?.kind === 'vocab' && <VocabDialog doc={activeTab?.doc} onClose={closeDialog} />}
      {dialog?.kind === 'regressions' && dlgTab && (
        <RegressionDialog tab={dlgTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'progress-detail' && dlgTab && (
        <ProgressDetailDialog tab={dlgTab} onJumpWord={jumpWord} onPatchSettings={(patch) => patchSettings(dlgTab.id, patch)} onClose={closeDialog} />
      )}
      {dialog?.kind === 'attention' && dlgTab && (
        <AttentionDialog tab={dlgTab} recentScores={probeScoresRef.current} onClose={closeDialog} />
      )}
      {dialog?.kind === 'grab' && <GrabWizard onClose={closeDialog} />}
      {dialog?.kind === 'web-grab' && <WebGrabWizard onClose={closeDialog} />}
      {dialog?.kind === 'html-structure' && <HtmlStructureWizard html={dialog.html} fileName={dialog.fileName} sourceUrl={dialog.sourceUrl} onClose={closeDialog} />}
      {dialog?.kind === 'html-tools' && <HtmlToolsDialog onClose={closeDialog} />}
      {dialog?.kind === 'api-usage' && <ApiUsageDialog onClose={closeDialog} />}
      {dialog?.kind === 'toc-wizard' && activeTab && (
        <TocWizard
          tab={activeTab}
          onApply={(entries, skip) => {
            patchSettings(activeTab.id, {
              tocEntries: entries,
              skipRanges: mergeSkipRanges(activeTab.settings.skipRanges, skip),
            });
            if (!state.showToc) dispatch({ type: 'TOGGLE_TOC' });
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'resource-wizard' && activeTab && (
        <ResourceWizard
          kind={dialog.resourceKind}
          tab={activeTab}
          onApply={applyResource}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'webcam-calib' && (
        <WebcamCalibrationDialog
          monitor={webcamRef.current}
          onSave={(threshold) => {
            webcamRef.current?.setBlinkThreshold(threshold);
            updateGlobal({ webcamCalib: { ...(state.global.webcamCalib || {}), threshold } });
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'hand-calib' && (
        <HandCalibrationDialog
          monitor={handRef.current}
          onSave={(cal) => updateGlobal({ handCalib: cal })}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'typing-plan' && (
        <TypingPlanDialog onStart={activeTab ? startPlan : null} onClose={closeDialog} />
      )}
      {dialog?.kind === 'save-tab' && activeTab && (
        <SaveTabDialog
          doc={activeTab.doc}
          onSave={saveTabAs}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'finished' && activeTab && (
        <BookFinishedDialog
          tab={activeTab}
          onPatch={(p) => patchSettings(activeTab.id, p)}
          onClose={closeDialog}
        />
      )}
        </>);
        // Docked tab → portal into the content-area slot (fills the page). Modal → inline overlay.
        if (dialogDocked) return dialogSlotRef.current ? createPortal(<div className="dialog-dock">{inner}</div>, dialogSlotRef.current) : null;
        return inner;
      })()}

      {/* Import prompt is driven by state.importing (file drop / open), independent of the dialog
          tabs — always a centered modal, never portaled into a tab. */}
      {state.importing && (
        <ImportDialog
          imp={state.importing}
          onClose={() => dispatch({ type: 'SET_IMPORT', payload: null })}
          onAction={handleMenuAction}
        />
      )}

      {/* Cross-device progress deconflict — shown when a sync merge found two devices moving the
          same book in different directions. The newest position is already applied; pick per book. */}
      {syncConflicts && syncConflicts.length > 0 && (
        <div className="dialog-backdrop" style={{ zIndex: 6000 }}>
          <div className="dialog" style={{ width: 'min(600px, 96vw)' }}>
            <div className="dialog-title"><span>Sync — whose progress wins?</span><button className="close-x" onClick={dismissSyncConflicts}>×</button></div>
            <div className="dialog-body">
              <p className="settings-note" style={{ marginTop: 0 }}>
                These books were moved on two devices in different directions. The most recent position
                is applied — keep it, or take the other device’s.
              </p>
              {syncConflicts.map((c, i) => {
                const pct = (p) => (c.total ? `${Math.round((p / c.total) * 100)}%` : `word ${p + 1}`);
                const when = (t) => (t ? fmtDateTime(t) : '—');
                return (
                  <div key={i} className="sync-conflict">
                    <div className="sync-conflict-name">{c.name || 'Untitled book'}</div>
                    <div className="sync-conflict-opts">
                      <button className="toggle-on" onClick={() => resolveSyncConflict(c, false)}>
                        Keep {pct(c.applied.pos)} <em>{c.applied.device || 'newest'} · {when(c.applied.at)}</em>
                      </button>
                      <button onClick={() => resolveSyncConflict(c, true)}>
                        Take {pct(c.other.pos)} <em>{c.other.device || 'other device'} · {when(c.other.at)}</em>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="dialog-buttons"><button onClick={dismissSyncConflicts}>Dismiss (keep newest)</button></div>
          </div>
        </div>
      )}

      {dragOver && <div className="drop-overlay">Drop file to open</div>}

      {activeTab && (
        <AdaptiveProbe
          tab={activeTab}
          playing={playing}
          onPause={() => setPlaying(false)}
          onResume={() => setPlaying(true)}
          onSetWpm={(w) => patchSettings(activeTab.id, { wpm: w })}
          onResult={(correct) => {
            probeScoresRef.current = [...probeScoresRef.current.slice(-9), correct ? 1 : 0];
          }}
        />
      )}

      {activeTab && (
        <ComfortMonitor
          tab={activeTab}
          playing={playing}
          cfg={state.global.comfort}
          manualSignal={breakSignal}
          getRecentScores={() => probeScoresRef.current}
          onPause={() => setPlaying(false)}
          onResume={() => setPlaying(true)}
          onSetWpm={(w) => patchSettings(activeTab.id, { wpm: w })}
        />
      )}

      {closing && (
        <div className="closing-overlay">
          <h1>{closing === 'shutdown' ? 'Shut down' : 'Disconnected'}</h1>
          <p>
            {closing === 'shutdown'
              ? 'All files closed — your next session starts clean.'
              : 'Your session is saved — it will reconnect next time you open the app.'}
          </p>
          <p className="hint">You can close this browser tab now. (Browsers may block a page from closing its own tab automatically.)</p>
        </div>
      )}

      {/* Biometric Control Feed: one draggable, resizable popup — self-view (when a camera feature is
          on) + mic oscilloscope (when voice is on) + a unified camera/voice event feed. − minimizes
          (badge restores); × turns every biometric source off. */}
      {(camOn || handGesturesOn || audioCtrlOn) && state.global.webcamPreview !== false && (webcamStream || gestureStream || audioCtrlOn) && (
        <BiometricFeed
          stream={webcamStream || gestureStream || null}
          camState={camOn ? webcamState : (handGesturesOn ? 'watching' : null)}
          handState={handGesturesOn ? handState : null}
          scope={micScope}
          mode={state.global.audioCtrlMode || 'Both'}
          voiceOn={audioCtrlOn}
          gestureMap={{ ...DEFAULT_GESTURE_MAP, ...(state.global.gestureMap || {}) }}
          voiceCommands={state.global.voiceCommands?.length ? state.global.voiceCommands : DEFAULT_VOICE_COMMANDS}
          clapMap={{ ...DEFAULT_CLAP_MAP, ...(state.global.clapMap || {}) }}
          log={bioLog}
          feedHeight={state.global.bioFeedHeight || null}
          onResizeFeed={(h) => updateGlobal({ bioFeedHeight: h })}
          features={{
            attention: !!state.global.webcamAttention, doze: !!state.global.webcamDoze,
            awayAlarm: !!state.global.webcamAwayAlarm, distanceNudge: !!state.global.webcamDistanceNudge,
            focusStats: !!state.global.webcamFocusStats, handGestures: handGesturesOn,
            gestures: { ...DEFAULT_GESTURES, ...(state.global.handGestureSet || {}) },
          }}
          pos={bioFeedPos}
          onMove={setBioFeedPos}
          onDrop={(p) => p && updateGlobal({ bioFeedPos: p })}
          canCalibrate={!!webcamRef.current?.eyesAvailable?.()}
          onCalibrate={() => openDialog({ kind: 'webcam-calib' })}
          onCalibrateHand={() => openDialog({ kind: 'hand-calib' })}
          onMinimize={() => updateGlobal({ webcamPreview: false })}
          onClose={() => { turnOffCamera(); if (audioCtrlOn && activeTab) patchSettings(activeTab.id, { audioCtrl: false }); }}
        />
      )}

      {/* Posture nudge — gentle reminder when you're sitting too close to the screen. */}
      {camOn && tooClose && (
        <div className="distance-nudge" role="status">↔ Ease back a little — you’re close to the screen.</div>
      )}

      {/* Looking-away alarm — flashing alert + beeper until you return or dismiss. */}
      {awayAlarmActive && (
        <div className="away-alarm" role="alertdialog" onClick={dismissAwayAlarm}>
          <div className="away-alarm-box">
            <div className="away-alarm-title">👀 Eyes on the page!</div>
            <p>You’ve been looking away. Look back to silence it, or tap to dismiss.</p>
            <button onClick={(e) => { e.stopPropagation(); dismissAwayAlarm(); }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Chip mode: the face, stats, goal and timer each float as separate draggable, transparency-
          adjustable chips (mobile always; desktop when chipMode is on). Faces are per-tab (showEyes);
          stats follow the app-level Stats toggle; goal/timer show when they have something to say. */}
      {chips && activeTab && !!activeTab.settings.showEyes && (
        <FloatingFace
          tab={activeTab}
          pos={facePos}
          onMove={setFacePos}
          onDrop={(p) => p && updateGlobal({ mobileFacePos: p })}
        />
      )}
      {chips && activeTab && state.showStats && (
        <FloatingStats
          tab={activeTab}
          pos={statsPos}
          onMove={setStatsPos}
          onDrop={(p) => p && updateGlobal({ mobileStatsPos: p })}
        />
      )}
      {chips && activeTab && (
        <FloatingGoal
          tab={activeTab}
          pos={goalPos}
          onMove={setGoalPos}
          onDrop={(p) => p && updateGlobal({ mobileGoalPos: p })}
        />
      )}
      {chips && activeTab && (
        <FloatingTimer
          tab={activeTab}
          pos={timerPos}
          onMove={setTimerPos}
          onDrop={(p) => p && updateGlobal({ mobileTimerPos: p })}
          autoStopAt={autoStopAt}
        />
      )}

      {/* Single shared WebGL context for every 3D reader face (drei <View> portals here).
          Mounted only while faces are actually shown so there's no idle render loop. */}
      {!!activeTab?.settings?.showEyes && <FaceStage />}
    </div>
  );
}

export default function App() {
  // Single-instance guard: if the app is already open in another browser tab, bow out and
  // touch nothing (no IndexedDB, no session writes) so the live tab isn't clobbered.
  const [instance] = useState(() => acquireInstance());
  if (!instance.primary) {
    return (
      <div className="closing-overlay">
        <h1>Tachyread</h1>
        <p>Already open in another browser tab.</p>
        <p className="hint">This app runs in a single tab so your files and progress stay in sync. Switch to that tab, or close it and reload here.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
