import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext.jsx';
import MenuBar from './components/MenuBar.jsx';
import TabBar from './components/TabBar.jsx';
import RsvpPane from './components/RsvpPane.jsx';
import DashboardPane from './components/DashboardPane.jsx';
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
import AudioChat from './components/AudioChat.jsx';
import TypingRun from './components/TypingRun.jsx';
import FindDialog from './dialogs/FindDialog.jsx';
import GoToLineDialog from './dialogs/GoToLineDialog.jsx';
import SettingsDialog from './dialogs/SettingsDialog.jsx';
import StatisticsDialog from './dialogs/StatisticsDialog.jsx';
import HistoryDialog from './dialogs/HistoryDialog.jsx';
import ProperNamesDialog from './dialogs/ProperNamesDialog.jsx';
import AudiobookDialog from './dialogs/AudiobookDialog.jsx';
import FootnoteOverlay from './dialogs/FootnoteOverlay.jsx';
import TtsPopupDialog from './dialogs/TtsPopupDialog.jsx';
import FaceLibraryDialog from './dialogs/FaceLibraryDialog.jsx';
import TypingProgressDialog from './dialogs/TypingProgressDialog.jsx';
import AppSettingsDialog from './dialogs/AppSettingsDialog.jsx';
import BookFinishedDialog from './dialogs/BookFinishedDialog.jsx';
import GrabWizard from './dialogs/GrabWizard.jsx';
import TocWizard from './dialogs/TocWizard.jsx';
import ResourceWizard from './dialogs/ResourceWizard.jsx';
import IndexPane from './components/IndexPane.jsx';
import { buildProperNamesFromList } from './document/resourceWizard.js';
import { createEngine, wordDurationMs } from './engine/rsvpEngine.js';
import DisclaimerDialog from './dialogs/DisclaimerDialog.jsx';
import AdaptiveProbe from './components/AdaptiveProbe.jsx';
import { computeSurprisalWeights } from './engine/surprisal.js';
import SpanDrillDialog from './dialogs/SpanDrillDialog.jsx';
import FlowWriterDialog from './dialogs/FlowWriterDialog.jsx';
import VocabDialog from './dialogs/VocabDialog.jsx';
import RegressionDialog from './dialogs/RegressionDialog.jsx';
import ProgressDetailDialog from './dialogs/ProgressDetailDialog.jsx';
import DictationDialog from './dialogs/DictationDialog.jsx';
import AttentionDialog from './dialogs/AttentionDialog.jsx';
import AmbientDialog from './dialogs/AmbientDialog.jsx';
import DataDialog from './dialogs/DataDialog.jsx';
import BookGroupsDialog from './dialogs/BookGroupsDialog.jsx';
import ComfortMonitor from './components/ComfortMonitor.jsx';
import { getLineIndex, getParagraphRange, detectProperNames } from './document/readerDocument.js';
import { getTocEntries, sectionSpan, mergeSkipRanges } from './document/toc.js';
import { defaultFileSettings, tabDefaultsFrom } from './state/settings.js';
import { cancelSpeech, rateFromIndex, speak } from './features/tts.js';
import TypingPlanDialog from './dialogs/TypingPlanDialog.jsx';
import SaveTabDialog from './dialogs/SaveTabDialog.jsx';
import { createReadAloud } from './features/readAloud.js';
import { enterFocus, exitFocus, repaintCovers } from './features/focusMode.js';
import { createRecognizer, wordMatches, speechRecognitionSupported } from './features/speechRecognition.js';
import { recordClip } from './features/audioRecorder.js';
import { saveAudioClip, clearSession, saveSession, saveTypingRun, saveFocusSession } from './state/storage.js';
import { acquireInstance } from './state/singleInstance.js';
import { startVoiceCommands, startClapDetector } from './features/audioControl.js';
import { playLineClick } from './features/clickSound.js';
import { createMetronome } from './features/metronome.js';
import { saveTextToFile, saveBlobToFile } from './features/fileSystem.js';
import { buildTabPdf } from './features/exportPdf.js';
import { ambient } from './features/ambient.js';
import { createAttentionMonitor } from './features/webcamAttention.js';
import WebcamPreview from './components/WebcamPreview.jsx';
import WebcamCalibrationDialog from './dialogs/WebcamCalibrationDialog.jsx';
import { createAlarm } from './features/alarm.js';

const WEBCAM_LABEL = {
  starting: 'starting camera…', watching: 'watching', away: 'looked away — paused', drowsy: 'drowsy',
  unsupported: 'face detection not supported here', denied: 'camera blocked', error: 'camera error', off: '',
};
import { getSyncProvider } from './features/sync/syncProviders.js';
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
  const { state, activeTab: rawActiveTab, hydrateTab, openFile, openClipboard, setStatus, patchSettings, patchTab, openDialog, closeDialog, dispatch, updateGlobal, flushReadState, closeAllTabs } = useApp();
  // A lazy (restored, not-yet-loaded) tab has no parsed document — treat it as "no active reader"
  // until it hydrates, so nothing downstream touches activeTab.doc before it exists.
  const activeTab = rawActiveTab && !rawActiveTab.lazy ? rawActiveTab : null;
  const isCompact = useIsCompact();
  const [mobileView, setMobileView] = useState('rsvp'); // compact-screen single reading view: 'rsvp' | 'lines'
  const [controlsCollapsed, setControlsCollapsed] = useState(false); // minimize the bottom dock for text room
  const [chromeHidden, setChromeHidden] = useState(false); // mobile: hide menu+tabs above the reader for text room
  const touchRef = useRef(null); // swipe-gesture start point
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createEngine();
  const [playing, setPlaying] = useState(false);

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
    setGoalKills((k) => [...k, { label, time: new Date().toLocaleTimeString() }]);
  }, []);
  const [audioLog, setAudioLog] = useState([]); // ephemeral audio-command transcript
  const audioLogId = useRef(0);
  const pushAudioLog = useCallback((entry) => {
    setAudioLog((l) => [...l.slice(-49), { id: ++audioLogId.current, time: new Date().toLocaleTimeString(), ...entry }]);
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
  const [tocFlash, setTocFlash] = useState({ index: -1, token: 0 });
  const peekToLine = useCallback((line) => setPeek((s) => ({ line, token: s.token + 1 })), []);
  const clearPeek = useCallback(() => setPeek((s) => (s.line < 0 ? s : { line: -1, token: s.token + 1 })), []);
  // Revert any active peek once the reader actually moves or starts playing.
  useEffect(() => { clearPeek(); }, [activeTab?.settings.wordIndex, playing, clearPeek]);
  const onTocIcon = useCallback((index) => {
    if (!state.showToc) dispatch({ type: 'TOGGLE_TOC' });
    setTocFlash((s) => ({ index, token: s.token + 1 }));
  }, [dispatch, state.showToc]);
  const [paneWidths, setPaneWidths] = useState({ toc: 320, dash: 260, rsvp: 420, source: 380 });
  const resizePane = (id, w) => setPaneWidths((prev) => ({ ...prev, [id]: w }));
  // Filled by the Lines pane: page(dir) → the top/bottom currently-visible line index (excluding
  // blurred / unrevealed lines). Drives the PgUp/PgDn buttons + keys.
  const linesVisibleRef = useRef(null);
  const recognizerRef = useRef(null);
  const audioRecRef = useRef({ rec: null, lineIndex: -1 });
  const audioCtrlRef = useRef(null);
  const clapRef = useRef(null);
  // Read-aloud (integrated TTS) plumbing.
  const activeTabRef = useRef(null);
  activeTabRef.current = activeTab;
  const readAloudRef = useRef(null);
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

  // Pause playback and stop counting reading time while the tab is hidden (the user is
  // doing something else) — the reading tracker should not credit background time.
  useEffect(() => {
    function onVis() {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) {
        setPlaying(false);
        cancelSpeech();
      }
      activeTab?.tracker?.setHidden(hidden);
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
    const ms = wordDurationMs(word, settings, isProperName, isHF, atParaEnd, atLineEnd) * sw;

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
    if (!inc) tab.tracker?.recordMove(cur, wi, Date.now());
    const prevLine = getLineIndex(tab.doc, cur);
    const newLine = getLineIndex(tab.doc, wi);
    if (!inc && wi > cur && newLine !== prevLine) {
      tab.sessionLinesRead.add(prevLine);
      tab.readLinesAllTime.add(prevLine);
    }
    patchSettings(tab.id, { wordIndex: wi });
  }

  useEffect(() => {
    if (!readAloudRef.current) {
      readAloudRef.current = createReadAloud({
        getWords: () => activeTabRef.current?.doc.words || [],
        getIndex: () => activeTabRef.current?.settings.wordIndex || 0,
        setIndex: ttsSetIndex,
        getVoiceName: () => activeTabRef.current?.settings.annunciateVoice,
        getRate: () => rateFromIndex(activeTabRef.current?.settings.annunciateRate || 0),
        onEnd: () => setPlaying(false),
      });
    }
    const on = playing && !!activeTab?.settings?.readAloud;
    if (on) {
      readAloudRef.current.start();
    } else {
      readAloudRef.current.stop();
    }
    return () => readAloudRef.current?.stop();
    // eslint-disable-next-line
  }, [playing, activeTab?.settings?.readAloud, activeTab?.id]);

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
    const inc = incognitoRef.current;
    // Reading-efficiency tracking (classifies read / skip / re-read / revisit + active time).
    if (!inc) activeTab.tracker?.recordMove(cur, next, Date.now());
    // Forward motion (playback, a forward word step, scrolling forward) means you read the text you
    // passed — credit those words for coverage even on a multi-word step the move-classifier treats
    // as a skim/skip. recordMove above keeps the time/WPM accounting honest.
    if (!inc && next > cur) activeTab.tracker?.markRangeRead(cur, next);
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
      const voice = { voiceName: activeTab.settings.annunciateVoice, rate: rateFromIndex(activeTab.settings.annunciateRate || 0) };
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
    const inc = incognitoRef.current;
    // opts.read marks a DELIBERATE forward navigation (end of line/paragraph, page down) as reading
    // the text passed — unlike a jump to elsewhere (TOC/Find/Go-to), which stays a skip.
    const fwdRead = opts.read && next > cur;
    if (!inc) activeTab.tracker?.recordMove(cur, next, Date.now());
    if (!inc && fwdRead) activeTab.tracker?.markRangeRead(cur, next);
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
    const doc = activeTab.doc;
    const cur = activeTab.settings.wordIndex;
    const curLine = getLineIndex(doc, cur);
    if (kind === 'prevWord') return stepWord(-1, { nav: true });
    if (kind === 'nextWord') return stepWord(1, { nav: true });
    if (kind === 'prevLine') {
      for (let li = curLine - 1; li >= 0; li--) {
        if (!doc.lines[li].isEmpty) {
          jumpWord(doc.lines[li].startWordIndex);
          return;
        }
      }
      jumpWord(0);
      return;
    }
    if (kind === 'nextLine') {
      for (let li = curLine + 1; li < doc.lines.length; li++) {
        if (!doc.lines[li].isEmpty) {
          jumpWord(doc.lines[li].startWordIndex, { nav: true, read: true });
          return;
        }
      }
      jumpWord(doc.words.length - 1, { nav: true, read: true });
      return;
    }
    if (kind === 'prevPara') {
      const rng = getParagraphRange(doc, curLine);
      if (cur > doc.lines[rng.startLine].startWordIndex) {
        jumpWord(doc.lines[rng.startLine].startWordIndex);
        return;
      }
      // Previous paragraph
      let li = rng.startLine - 1;
      while (li >= 0 && doc.lines[li].isEmpty) li--;
      if (li < 0) {
        jumpWord(0);
        return;
      }
      const prng = getParagraphRange(doc, li);
      jumpWord(doc.lines[prng.startLine].startWordIndex);
      return;
    }
    if (kind === 'nextPara') {
      const rng = getParagraphRange(doc, curLine);
      let li = rng.endLine + 1;
      while (li < doc.lines.length && doc.lines[li].isEmpty) li++;
      if (li >= doc.lines.length) {
        jumpWord(doc.words.length - 1, { nav: true, read: true });
        return;
      }
      jumpWord(doc.lines[li].startWordIndex, { nav: true, read: true });
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
    const target = linesVisibleRef.current?.page?.(dir);
    if (target == null) { nav(dir > 0 ? 'nextPara' : 'prevPara'); return; }
    const doc = activeTab.doc;
    const li = Math.max(0, Math.min(doc.lines.length - 1, target));
    const wi = doc.lines[li].startWordIndex;
    if (wi === activeTab.settings.wordIndex) { nav(dir > 0 ? 'nextPara' : 'prevPara'); return; }
    // Paging DOWN counts as reading the text you paged past; paging up is just navigation.
    jumpWord(wi, dir > 0 ? { nav: true, read: true } : { nav: true });
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
  const webcamRef = useRef(null);

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
  const camOn = state.global.webcamAttention || state.global.webcamDoze || state.global.webcamAwayAlarm
    || state.global.webcamDistanceNudge || state.global.webcamFocusStats;
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
          f.attentive = attentive;
        }
      },
      onDoze: (dozing) => {
        // doze → stop read-aloud (it's otherwise exempt from the guards). No auto-resume: if you
        // nodded off, it just stops, like the wind-down timer.
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

  // Auto-stop timer: after this many minutes of continuous playback, pause and silence speech.
  // Handy for winding down to read-aloud without it running all night. Restarts on each Play.
  useEffect(() => {
    const mins = state.global.ttsAutoStopMin || 0;
    if (!playing || mins <= 0) return undefined;
    const id = setTimeout(() => {
      engineRef.current.pause();
      setPlaying(false);
      cancelSpeech();
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

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // Allow Esc to close footnote even from inputs
        if (e.key === 'Escape' && showFootnote) {
          setShowFootnote(false);
        }
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        playPause();
      } else if (e.key === 'ArrowLeft' && !ctrl) {
        nav('prevWord');
      } else if (e.key === 'ArrowRight' && !ctrl) {
        nav('nextWord');
      } else if (e.key === 'ArrowUp' && !ctrl) {
        nav('prevLine');
      } else if (e.key === 'ArrowDown' && !ctrl) {
        nav('nextLine');
      } else if (e.key === 'ArrowUp' && ctrl) {
        e.preventDefault();
        nav('prevPara');
      } else if (e.key === 'ArrowDown' && ctrl) {
        e.preventDefault();
        nav('nextPara');
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        pageLines(-1);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        pageLines(1);
      } else if (e.key === 'Home') {
        nav('restart');
      } else if (ctrl && !shift && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        triggerOpen('.txt,.md,.csv,.log');
      } else if (ctrl && !shift && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        triggerOpen('.docx,.pdf,.epub,.txt,.md');
      } else if (ctrl && !shift && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        openClipboard();
      } else if (ctrl && !shift && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (activeTab) openDialog({ kind: 'find' });
      } else if (ctrl && !shift && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (activeTab) openDialog({ kind: 'goto' });
      } else if (ctrl && !shift && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        openDialog({ kind: 'stats' });
      } else if (ctrl && !shift && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        openDialog({ kind: 'history' });
      } else if (ctrl && !shift && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        if (activeTab) openDialog({ kind: 'proper-names' });
      } else if (ctrl && shift && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        if (activeTab) setShowFootnote((s) => !s);
      } else if (ctrl && shift && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        if (activeTab) openDialog({ kind: 'audiobook' });
      } else if (ctrl && shift && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        if (activeTab) openDialog({ kind: 'tts-popup' });
      } else if (ctrl && shift && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        openDialog({ kind: 'grab' });
      } else if (e.key === 'Escape') {
        if (showFootnote) setShowFootnote(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [activeTab, playing, showFootnote]);

  function triggerOpen(accept) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => input.files?.[0] && openFile(input.files[0]);
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
      const file = e.dataTransfer?.files?.[0];
      if (file) openFile(file);
    }
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [openFile]);

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
      onResult: ({ transcript, confidence, isFinal }) => {
        if (!isFinal && !cfg.allowPartial) return;
        const target = activeTab.doc.words[activeTab.settings.wordIndex] || '';
        if ((confidence || 0) >= minConf && wordMatches(target, transcript)) {
          stepWord(1);
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
  }, [activeTab?.id, activeTab?.settings.speaking?.enabled, activeTab?.settings.wordIndex]);

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
      setAudioLog([]); // ephemeral transcript — clear when listening stops
      return;
    }
    const CMD_LABEL = { play: '▶ play', pause: '❚❚ pause', next: '→ next word', back: '← prev word' };
    const mode = state.global.audioCtrlMode || 'Both';
    if (mode === 'Voice' || mode === 'Both') {
      const r = startVoiceCommands({
        onHeard: ({ transcript, isFinal, command }) => {
          if (!isFinal) return;
          pushAudioLog({ transcript, command, action: command ? CMD_LABEL[command] : null });
        },
        onCommand: (cmd) => {
          if (cmd === 'play') setPlaying(true);
          else if (cmd === 'pause') setPlaying(false);
          else if (cmd === 'next') stepWord(1, { nav: true });
          else if (cmd === 'back') stepWord(-1, { nav: true });
        },
      });
      audioCtrlRef.current = r;
    }
    if (mode === 'Claps' || mode === 'Both') {
      startClapDetector((claps) => {
        let action = null;
        if (claps === 1) { setPlaying((p) => !p); action = '⏯ play/pause'; }
        else if (claps === 2) { stepWord(1, { nav: true }); action = '→ next word'; }
        else if (claps === 3) { stepWord(-1, { nav: true }); action = '← prev word'; }
        pushAudioLog({ transcript: `👏 × ${claps}`, command: action ? 'clap' : null, action });
      }).then((cd) => (clapRef.current = cd)).catch(() => {});
    }
    return () => {
      if (audioCtrlRef.current) try { audioCtrlRef.current.stop(); } catch { /* ignore */ }
      audioCtrlRef.current = null;
      if (clapRef.current) try { clapRef.current.stop(); } catch { /* ignore */ }
      clapRef.current = null;
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
        updateGlobal({ sync: { ...cfg, lastSync: Date.now() } });
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
        updateGlobal({ sync: { ...cfg, lastSync: r.at } });
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
    if (action === 'sync-now') return doSyncNow();
    if (action === 'save-tab' && activeTab) return doSaveTab();
    if (action === 'open-clip') return openClipboard();
    if (action === 'grab') return openDialog({ kind: 'grab' });
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
          try { if (await p.isConnected()) { const r = await backupToProvider(cfg.provider, cfg, { silent: true }); updateGlobal({ sync: { ...cfg, lastSync: r.at } }); } } catch { /* ignore */ }
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
    if (action === 'data') return openDialog({ kind: 'data' });
    if (action === 'book-groups') return openDialog({ kind: 'book-groups' });
    if (action === 'def-settings') return openDialog({ kind: 'def-settings' });
    if (action === 'tab-settings' && activeTab) return openDialog({ kind: 'tab-settings' });
    if (action === 'reset-tab' && activeTab) {
      const defaults = state.global.fileDefaults || defaultFileSettings();
      patchSettings(activeTab.id, { ...defaults, wordIndex: activeTab.settings.wordIndex, contentChecksum: activeTab.settings.contentChecksum });
      return;
    }
    if (action === 'stats') return openDialog({ kind: 'stats' });
    if (action === 'progress-detail' && activeTab) return openDialog({ kind: 'progress-detail' });
    if (action === 'history') return openDialog({ kind: 'history' });
    if (action === 'proper-names' && activeTab) return openDialog({ kind: 'proper-names' });
    if (action === 'toc-wizard' && activeTab) return openDialog({ kind: 'toc-wizard' });
    if (action === 'names-wizard' && activeTab) return openDialog({ kind: 'resource-wizard', resourceKind: 'names' });
    if (action === 'index-wizard' && activeTab) return openDialog({ kind: 'resource-wizard', resourceKind: 'index' });
    if (action === 'notes-wizard' && activeTab) return openDialog({ kind: 'resource-wizard', resourceKind: 'notes' });
    if (action === 'audiobook' && activeTab) return openDialog({ kind: 'audiobook' });
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

  const hideWord = !state.showRsvp || !!activeTab?.settings?.hideRsvpPane;
  // On a phone showing only the Lines view, lock it to the viewport (no page scroll) so the lines
  // pane fills the whole screen (current line kept centred) instead of stacking at a fraction height.
  const linesLocked = isCompact && (mobileView === 'lines' || hideWord)
    && !state.showToc && !state.showSource && !state.showIndex;
  // On a phone, an open TOC / Source / Index takes over the reader's space (rather than stacking)
  // and pauses playback — there's no room to do both, and you're not reading the text then.
  const auxOpen = isCompact && (state.showToc || (state.showSource && !!activeTab?.doc?.source) || state.showIndex);
  const panesFull = linesLocked || auxOpen;

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
    let showLinesPane = true;
    if (isCompact) {
      if (auxOpen) { showRsvpPane = false; showLinesPane = false; } // TOC/Source/Index takes the reader's space
      else if (hideWord) { showRsvpPane = false; showLinesPane = true; }
      else if (mobileView === 'rsvp') { showRsvpPane = true; showLinesPane = false; }
      else { showRsvpPane = false; showLinesPane = true; }
    }
    if (showRsvpPane) arr.push({ id: 'rsvp', label: 'Fast Reader', node: <RsvpPane tab={activeTab} onVisible={onRsvpVisible} /> });
    if (state.showSource && activeTab.doc.source)
      arr.push({ id: 'source', label: 'Source', node: <SourcePane tab={activeTab} /> });
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
        />
      ),
    });
    return arr;
    // eslint-disable-next-line
  }, [activeTab, state.showToc, state.showDash, state.showSource, state.showIndex, hideWord, peek, tocFlash, isCompact, mobileView, auxOpen, onRsvpVisible, onLinesVisible, state.global.scrollAdvances]);

  const dialog = state.dialog;

  return (
    <div
      className={`app${state.incognito ? ' incognito' : ''}${state.global.focusMode ? ' focus-on' : ''}${forcePortrait != null ? ' force-portrait' : ''}`}
      style={forcePortrait != null ? { transform: `translate(-50%, -50%) rotate(${forcePortrait}deg)` } : undefined}
    >
      <header className={`app-chrome${isCompact && chromeHidden ? ' collapsed' : ''}`}>
        <div className="chrome-body">
          <MenuBar onFileOpen={openFile} onAction={handleMenuAction} />
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
      {activeTab ? (
        <div className="main-wrap">
          <ChapterHeading tab={activeTab} onJumpWord={jumpWord} />
          {isCompact && !auxOpen && (
            <div className="reading-view-switch" role="tablist" aria-label="Reading view">
              {!hideWord && (
                <>
                  <button
                    role="tab"
                    aria-selected={mobileView === 'rsvp'}
                    className={mobileView === 'rsvp' ? 'on' : ''}
                    onClick={() => setMobileView('rsvp')}
                  >
                    ⚡ Fast Reader
                  </button>
                  <button
                    role="tab"
                    aria-selected={mobileView === 'lines'}
                    className={mobileView === 'lines' ? 'on' : ''}
                    onClick={() => setMobileView('lines')}
                  >
                    ☰ Lines
                  </button>
                </>
              )}
              {/* Rotate JUST the reader box (not the menus/controls) by a quarter-turn. */}
              <button
                className={`rv-rotate${readerRotation ? ' on' : ''}`}
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
                onExitContinue={planState ? undefined : (wi) => { jumpWord(wi); patchSettings(activeTab.id, { typing: { ...activeTab.settings.typing, enabled: false } }); }}
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
          <p>Supports .txt, .md, .docx, .pdf, .epub.</p>
          {state.tabs.length > 0 && <p>Or pick one of your {state.tabs.length} open tab(s) above.</p>}
          <p className="hint">Shortcuts: Space play, ←→ word, ↑↓ line, Ctrl+↑↓ paragraph, Home restart, Ctrl+F find</p>
        </div>
      )}
      </div>
      <div className={`controls-dock${controlsCollapsed ? ' collapsed' : ''}`}>
        <button
          className="dock-handle"
          onClick={() => setControlsCollapsed((c) => !c)}
          title={controlsCollapsed ? 'Show controls' : 'Minimize controls — more room for text'}
          aria-label={controlsCollapsed ? 'Show controls' : 'Minimize controls'}
        >
          <span className="dock-grip" />
          <span className="dock-handle-label">{controlsCollapsed ? '⌃ controls' : '⌄'}</span>
        </button>
        {controlsCollapsed ? (
          activeTab && (
            <div className="dock-mini">
              <button className="play-btn-mini" title="Play / Pause (Space)" onClick={playPause}>{playing ? '❚❚' : '▶'}</button>
              <span className="dock-mini-meta">{activeTab.settings.wordIndex + 1} / {activeTab.doc.words.length}</span>
            </div>
          )
        ) : (
        <div className="dock-row">
        {activeTab && state.showDash && (
          <div className="dock-dash">
            <DashboardPane tab={activeTab} dock />
          </div>
        )}
        {activeTab ? (
          <ControlsBar
            tab={activeTab}
            playing={playing}
            onJumpWord={jumpWord}
            onPeek={(wi) => peekToLine(getLineIndex(activeTab.doc, wi))}
            peekIdx={peek.line >= 0 ? (activeTab.doc.lines[peek.line]?.startWordIndex ?? -1) : -1}
            onConfirmFinished={() => openDialog({ kind: 'finished' })}
            audioCtrl={!!activeTab.settings.audioCtrl}
            readAloud={!!activeTab.settings.readAloud}
            onToggleFocus={toggleFocusMode}
            onToggleReadAloud={() =>
              patchSettings(activeTab.id, {
                readAloud: !activeTab.settings.readAloud,
                typing: { ...activeTab.settings.typing, enabled: false },
                speaking: { ...activeTab.settings.speaking, enabled: false },
              })
            }
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
            onToggleAudioCtrl={() => patchSettings(activeTab.id, { audioCtrl: !activeTab.settings.audioCtrl })}
            onGoalComplete={onGoalComplete}
            goalKills={goalKills}
            onTocIcon={onTocIcon}
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
        {camOn && webcamState !== 'off' && (
          <span className={`webcam-badge wb-${webcamState}`} title="Webcam — frames are analysed on your device and never leave it">
            📷 {WEBCAM_LABEL[webcamState] || webcamState}
          </span>
        )}
      </div>

      {/* Dialogs */}
      {dialog?.kind === 'find' && activeTab && (
        <FindDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'goto' && activeTab && (
        <GoToLineDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'tab-settings' && activeTab && (
        <SettingsDialog
          settings={activeTab.settings}
          onPatch={(p) => patchSettings(activeTab.id, p)}
          onClose={closeDialog}
          title="Tab Settings"
        />
      )}
      {dialog?.kind === 'def-settings' && (
        <SettingsDialog
          settings={state.global.fileDefaults}
          onPatch={(p) => updateGlobal({ fileDefaults: { ...state.global.fileDefaults, ...p } })}
          onClose={closeDialog}
          title="Default Tab Settings"
          matchCurrent={activeTab ? () => tabDefaultsFrom(activeTab.settings) : null}
          onResetFactory={() => { const d = defaultFileSettings(); updateGlobal({ fileDefaults: d }); return d; }}
        />
      )}
      {dialog?.kind === 'app-settings' && (
        <AppSettingsDialog
          global={state.global}
          onPatch={(p) => updateGlobal(p)}
          onCalibrate={() => openDialog({ kind: 'webcam-calib' })}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'data' && <DataDialog onClose={closeDialog} />}
      {dialog?.kind === 'book-groups' && <BookGroupsDialog onClose={closeDialog} />}
      {dialog?.kind === 'stats' && (
        <StatisticsDialog tab={activeTab} onClose={closeDialog} />
      )}
      {dialog?.kind === 'history' && <HistoryDialog onClose={closeDialog} />}
      {dialog?.kind === 'proper-names' && activeTab && (
        <ProperNamesDialog
          tab={activeTab}
          onJumpWord={jumpWord}
          onWizard={() => openDialog({ kind: 'resource-wizard', resourceKind: 'names' })}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'audiobook' && activeTab && (
        <AudiobookDialog tab={activeTab} onClose={closeDialog} />
      )}
      {dialog?.kind === 'tts-popup' && activeTab && (
        <TtsPopupDialog tab={activeTab} onClose={closeDialog} />
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
      {dialog?.kind === 'flow-writer' && <FlowWriterDialog doc={activeTab?.doc} onClose={closeDialog} />}
      {dialog?.kind === 'dictation' && <DictationDialog onClose={closeDialog} />}
      {dialog?.kind === 'ambient' && <AmbientDialog onClose={closeDialog} />}
      {dialog?.kind === 'vocab' && <VocabDialog doc={activeTab?.doc} onClose={closeDialog} />}
      {dialog?.kind === 'regressions' && activeTab && (
        <RegressionDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'progress-detail' && activeTab && (
        <ProgressDetailDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'attention' && activeTab && (
        <AttentionDialog tab={activeTab} recentScores={probeScoresRef.current} onClose={closeDialog} />
      )}
      {dialog?.kind === 'grab' && <GrabWizard onClose={closeDialog} />}
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

      {/* Live audio-command transcript (sanity check). Ephemeral; only while listening. */}
      {!!activeTab?.settings?.audioCtrl && <AudioChat log={audioLog} />}

      {/* Small webcam self-view while a guard is on — confirm framing; nothing leaves the device. */}
      {camOn && state.global.webcamPreview && webcamStream && (
        <WebcamPreview
          stream={webcamStream}
          state={webcamState}
          canCalibrate={!!webcamRef.current?.eyesAvailable?.()}
          onCalibrate={() => openDialog({ kind: 'webcam-calib' })}
          onHide={() => updateGlobal({ webcamPreview: false })}
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

      {/* Single shared WebGL context for every 3D reader face (drei <View> portals here).
          Mounted only while faces are actually shown so there's no idle render loop. */}
      {state.showDash && !!activeTab?.settings?.showEyes && <FaceStage />}
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
