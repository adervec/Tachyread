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
import FaceStage from './components/FaceStage.jsx';
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
import { createEngine, wordDurationMs } from './engine/rsvpEngine.js';
import DisclaimerDialog from './dialogs/DisclaimerDialog.jsx';
import AdaptiveProbe from './components/AdaptiveProbe.jsx';
import { computeSurprisalWeights } from './engine/surprisal.js';
import SpanDrillDialog from './dialogs/SpanDrillDialog.jsx';
import FlowWriterDialog from './dialogs/FlowWriterDialog.jsx';
import VocabDialog from './dialogs/VocabDialog.jsx';
import RegressionDialog from './dialogs/RegressionDialog.jsx';
import DictationDialog from './dialogs/DictationDialog.jsx';
import AttentionDialog from './dialogs/AttentionDialog.jsx';
import GammaPrimerDialog from './dialogs/GammaPrimerDialog.jsx';
import ComfortMonitor from './components/ComfortMonitor.jsx';
import { getLineIndex, getParagraphRange, detectProperNames } from './document/readerDocument.js';
import { getTocEntries, sectionSpan } from './document/toc.js';
import { defaultFileSettings } from './state/settings.js';
import { cancelSpeech, rateFromIndex } from './features/tts.js';
import { createReadAloud } from './features/readAloud.js';
import { createRecognizer, wordMatches, speechRecognitionSupported } from './features/speechRecognition.js';
import { recordClip } from './features/audioRecorder.js';
import { saveAudioClip, clearSession, saveSession, saveTypingRun } from './state/storage.js';
import { acquireInstance } from './state/singleInstance.js';
import { startVoiceCommands, startClapDetector } from './features/audioControl.js';
import { playLineClick } from './features/clickSound.js';
import { createMetronome } from './features/metronome.js';
import { applyTheme } from './state/themes.js';
import './App.css';

function AppInner() {
  const { state, activeTab, openFile, openClipboard, setStatus, patchSettings, patchTab, openDialog, closeDialog, dispatch, updateGlobal, flushReadState, closeAllTabs } = useApp();
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createEngine();
  const [playing, setPlaying] = useState(false);
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
  const [showFootnote, setShowFootnote] = useState(false);
  // Comfort/calibration: voluntary-break trigger token, and a rolling log of recent comprehension
  // outcomes (1 = passed an adaptive probe, 0 = missed) that feeds the fatigue estimate.
  const [breakSignal, setBreakSignal] = useState(0);
  const probeScoresRef = useRef([]);
  // Bump a token to ask the Lines pane to scroll to a line (without moving the reading position)
  // or to ask the TOC pane to reveal + flash an entry. The payload travels with the token.
  const [lineScroll, setLineScroll] = useState({ line: -1, token: 0 });
  const [tocFlash, setTocFlash] = useState({ index: -1, token: 0 });
  const scrollLinesToLine = useCallback((line) => setLineScroll((s) => ({ line, token: s.token + 1 })), []);
  const onTocIcon = useCallback((index) => {
    if (!state.showToc) dispatch({ type: 'TOGGLE_TOC' });
    setTocFlash((s) => ({ index, token: s.token + 1 }));
  }, [dispatch, state.showToc]);
  const [paneWidths, setPaneWidths] = useState({ toc: 320, dash: 260, rsvp: 420, source: 380 });
  const resizePane = (id, w) => setPaneWidths((prev) => ({ ...prev, [id]: w }));
  const recognizerRef = useRef(null);
  const audioRecRef = useRef({ rec: null, lineIndex: -1 });
  const audioCtrlRef = useRef(null);
  const clapRef = useRef(null);
  // Read-aloud (integrated TTS) plumbing.
  const activeTabRef = useRef(null);
  activeTabRef.current = activeTab;
  const readAloudRef = useRef(null);
  const ttsExpectedRef = useRef(-1); // index TTS last set, to tell self-advance from manual nav
  const metronomeRef = useRef(null); // rhythmic auditory pace cue (Web Audio)

  // Run proper-name detection lazily when enabled on a tab (it's opt-in due to memory cost).
  useEffect(() => {
    if (!activeTab?.settings.enableProperNames) return;
    const doc = activeTab.doc;
    if (doc.properNames && doc.properNames.size > 0) return;
    detectProperNames(doc);
    // Nudge a re-render so the line pane / RSVP engine pick up the new Map.
    patchTab(activeTab.id, { _propNamesGen: (activeTab._propNamesGen || 0) + 1 });
    // eslint-disable-next-line
  }, [activeTab?.id, activeTab?.settings.enableProperNames]);

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
    tab.tracker?.recordMove(cur, wi, Date.now());
    const prevLine = getLineIndex(tab.doc, cur);
    const newLine = getLineIndex(tab.doc, wi);
    if (wi > cur && newLine !== prevLine) {
      tab.sessionLinesRead.add(prevLine);
      tab.readLinesAllTime.add(prevLine);
    }
    ttsExpectedRef.current = wi;
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
      ttsExpectedRef.current = activeTab.settings.wordIndex; // seed so we don't self-resync
      readAloudRef.current.start();
    } else {
      readAloudRef.current.stop();
    }
    return () => readAloudRef.current?.stop();
    // eslint-disable-next-line
  }, [playing, activeTab?.settings?.readAloud, activeTab?.id]);

  // Manual navigation while reading aloud → resync speech to the new position.
  useEffect(() => {
    if (!playing || !activeTab?.settings?.readAloud) return;
    if (activeTab.settings.wordIndex !== ttsExpectedRef.current) {
      ttsExpectedRef.current = activeTab.settings.wordIndex; // mark handled before restarting
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
    // Reading-efficiency tracking (classifies read / skip / re-read / revisit + active time).
    activeTab.tracker?.recordMove(cur, next, Date.now());
    // Line status coloring for the right pane.
    const prevLine = getLineIndex(activeTab.doc, cur);
    const newLine = getLineIndex(activeTab.doc, next);
    if (newLine !== prevLine && activeTab.settings.lineAdvanceSound) playLineClick();
    if (delta === 1 && next > cur && !opts.nav) {
      if (newLine !== prevLine) {
        activeTab.sessionLinesRead.add(prevLine);
        activeTab.readLinesAllTime.add(prevLine);
      }
    } else if (opts.nav) {
      activeTab.sessionNavLinesRead.add(newLine);
    }
    patchSettings(activeTab.id, { wordIndex: next });
  }

  function jumpWord(wi, opts = { nav: true }) {
    if (!activeTab) return;
    const cur = activeTab.settings.wordIndex;
    const next = Math.max(0, Math.min(activeTab.doc.words.length - 1, wi));
    if (next === cur) return;
    activeTab.tracker?.recordMove(cur, next, Date.now());
    const prevLine = getLineIndex(activeTab.doc, cur);
    const newLine = getLineIndex(activeTab.doc, next);
    if (newLine !== prevLine && activeTab.settings.lineAdvanceSound) playLineClick();
    if (opts.nav) {
      activeTab.sessionNavLinesRead.add(newLine);
    }
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
          jumpWord(doc.lines[li].startWordIndex);
          return;
        }
      }
      jumpWord(doc.words.length - 1);
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
        jumpWord(doc.words.length - 1);
        return;
      }
      jumpWord(doc.lines[li].startWordIndex);
      return;
    }
    if (kind === 'restart') {
      jumpWord(0);
      return;
    }
  }

  function playPause() {
    if (!activeTab) return;
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

  function handleMenuAction(action) {
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
      setClosing('disconnect');
      setTimeout(() => { try { window.close(); } catch { /* tab not script-opened */ } }, 50);
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
    if (action === 'def-settings') return openDialog({ kind: 'def-settings' });
    if (action === 'tab-settings' && activeTab) return openDialog({ kind: 'tab-settings' });
    if (action === 'reset-tab' && activeTab) {
      const defaults = state.global.fileDefaults || defaultFileSettings();
      patchSettings(activeTab.id, { ...defaults, wordIndex: activeTab.settings.wordIndex, contentChecksum: activeTab.settings.contentChecksum });
      return;
    }
    if (action === 'stats') return openDialog({ kind: 'stats' });
    if (action === 'history') return openDialog({ kind: 'history' });
    if (action === 'proper-names' && activeTab) return openDialog({ kind: 'proper-names' });
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
    if (action === 'span-drill') return openDialog({ kind: 'span-drill' });
    if (action === 'flow-writer') return openDialog({ kind: 'flow-writer' });
    if (action === 'vocab') return openDialog({ kind: 'vocab' });
    if (action === 'regressions' && activeTab) return openDialog({ kind: 'regressions' });
    if (action === 'attention' && activeTab) return openDialog({ kind: 'attention' });
    if (action === 'dictation') return openDialog({ kind: 'dictation' });
    if (action === 'gamma') return openDialog({ kind: 'gamma' });
    if (action === 'take-break') return setBreakSignal((n) => n + 1);
    if (action === 'toggle-dark' && activeTab) {
      patchSettings(activeTab.id, { darkMode: !activeTab.settings.darkMode });
    }
  }

  const hideWord = !state.showRsvp || !!activeTab?.settings?.hideRsvpPane;

  // Data-driven resizable pane set. Visibility toggles add/remove entries; the last pane
  // (Lines) flexes, the rest take draggable pixel widths from paneWidths.
  const panes = useMemo(() => {
    if (!activeTab) return [];
    const arr = [];
    if (state.showToc)
      arr.push({
        id: 'toc',
        label: 'TOC',
        node: (
          <TocPane
            tab={activeTab}
            onJumpWord={jumpWord}
            onScrollToLine={scrollLinesToLine}
            onSetSectionGoal={setSectionGoal}
            onPatch={(p) => patchSettings(activeTab.id, p)}
            flashSignal={tocFlash}
          />
        ),
      });
    if (state.showDash) arr.push({ id: 'dash', label: 'Dashboard', node: <DashboardPane tab={activeTab} /> });
    if (!hideWord) arr.push({ id: 'rsvp', label: 'Fast Reader', node: <RsvpPane tab={activeTab} /> });
    if (state.showSource && activeTab.doc.source)
      arr.push({ id: 'source', label: 'Source', node: <SourcePane tab={activeTab} /> });
    arr.push({
      id: 'lines',
      label: 'Lines',
      node: (
        <LinePane
          tab={{ ...activeTab, patchSettings: (p) => patchSettings(activeTab.id, p) }}
          onJumpWord={jumpWord}
          hideMode={activeTab.settings.hideMode || 'None'}
          scrollSignal={lineScroll}
        />
      ),
    });
    return arr;
    // eslint-disable-next-line
  }, [activeTab, state.showToc, state.showDash, state.showSource, hideWord, lineScroll, tocFlash]);

  const dialog = state.dialog;

  return (
    <div className="app">
      <MenuBar onFileOpen={openFile} onAction={handleMenuAction} />
      <TabBar />
      {activeTab ? (
        <div className="main-wrap">
          <ChapterHeading tab={activeTab} onJumpWord={jumpWord} />
          <div className="main-area">
            <PaneLayout panes={panes} widths={paneWidths} onResize={resizePane} />
            {activeTab.settings.typing?.enabled && (
              <TypingRun
                tab={activeTab}
                onPatch={(p) => patchSettings(activeTab.id, p)}
                onExitDiscard={() => patchSettings(activeTab.id, { typing: { ...activeTab.settings.typing, enabled: false } })}
                onExitContinue={(wi) => { jumpWord(wi); patchSettings(activeTab.id, { typing: { ...activeTab.settings.typing, enabled: false } }); }}
                onSaveRun={onSaveTypingRun}
                sessionRuns={typingRuns}
              />
            )}
            {showFootnote && <FootnoteOverlay tab={activeTab} onClose={() => setShowFootnote(false)} />}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <img className="empty-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Tachyread — the astral gavage goose" width="132" height="132" />
          <h1>Tachyread</h1>
          <p>Open a file (File → Open TXT, Ctrl+O), open a document (Ctrl+D), or drop a file here.</p>
          <p>Supports .txt, .md, .docx, .pdf, .epub.</p>
          <p className="hint">Shortcuts: Space play, ←→ word, ↑↓ line, Ctrl+↑↓ paragraph, Home restart, Ctrl+F find</p>
        </div>
      )}
      {activeTab ? (
        <ControlsBar
          tab={activeTab}
          playing={playing}
          onJumpWord={jumpWord}
          onConfirmFinished={() => openDialog({ kind: 'finished' })}
          audioCtrl={!!activeTab.settings.audioCtrl}
          readAloud={!!activeTab.settings.readAloud}
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
      <div className="app-status">{state.appStatus}</div>

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
        />
      )}
      {dialog?.kind === 'app-settings' && (
        <AppSettingsDialog
          global={state.global}
          onPatch={(p) => updateGlobal(p)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'stats' && (
        <StatisticsDialog tab={activeTab} onClose={closeDialog} />
      )}
      {dialog?.kind === 'history' && <HistoryDialog onClose={closeDialog} />}
      {dialog?.kind === 'proper-names' && activeTab && (
        <ProperNamesDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
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
      {dialog?.kind === 'gamma' && <GammaPrimerDialog onClose={closeDialog} />}
      {dialog?.kind === 'vocab' && <VocabDialog doc={activeTab?.doc} onClose={closeDialog} />}
      {dialog?.kind === 'regressions' && activeTab && (
        <RegressionDialog tab={activeTab} onJumpWord={jumpWord} onClose={closeDialog} />
      )}
      {dialog?.kind === 'attention' && activeTab && (
        <AttentionDialog tab={activeTab} recentScores={probeScoresRef.current} onClose={closeDialog} />
      )}
      {dialog?.kind === 'grab' && <GrabWizard onClose={closeDialog} />}
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
