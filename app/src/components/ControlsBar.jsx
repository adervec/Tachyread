import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { useIsCompact } from '../state/device.js';
import Trendline from './Trendline.jsx';
import TocBar from './TocBar.jsx';
import { goalFraction, computeGoalStatus } from '../engine/goals.js';
import { MODES } from '../engine/readingMode.js';
import { lastCountableWord } from '../document/toc.js';
import { playButtonView } from '../features/playButtonMode.js';

// Compact gap for the ghost verdict — "1m 30s" reads at a glance where "00:01:30" doesn't.
function fmtGap(secs) {
  if (!isFinite(secs) || secs < 0) return '—';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ControlsBar({ tab, onPeek, peekIdx, onPlayPause, onPrevWord, onNextWord, onPrevLine, onNextLine, onPrevPara, onNextPara, onPageUp, onPageDown, onRestart, playing, readingMode = 'idle', modeIdleFrac = null, onToggleAudioCtrl, onToggleReadAloud, audioCtrl, readAloud, onConfirmFinished, onGoalComplete, goalKills, onTocIcon, onToggleFocus, onJumpToCurrent, onJumpToFrontier, onJumpToGap, onOpenBiometric, ghostRace = null, ghostGoal = null, onResetGhost }) {
  const { patchSettings, state, updateGlobal } = useApp();
  const isCompact = useIsCompact();
  // Mobile: the expanded dock shows the FULL controls immediately (no "more" disclosure) —
  // paginated between Steps / Modes / Goal so it never becomes one tall scrolling stack.
  const moreOpen = true;
  // Persisted (device-local) so the chosen page survives closing the dock, a tab change, and a
  // relaunch — it lives in global settings rather than component state for exactly that reason.
  const morePage = Math.max(0, Math.min(2, Number(state.global.mobilePillPage) || 0));
  const setMorePage = (i) => updateGlobal({ mobilePillPage: i });
  // One BIOMETRIC control unifies the old separate voice-command toggle and the camera "watching"
  // buttons: the button opens a quick popup with every hands-free source in one place.
  const [bioOpen, setBioOpen] = useState(false);
  const bioRef = useRef(null);
  useEffect(() => {
    if (!bioOpen) return undefined;
    const onDoc = (e) => { if (e.target.isConnected && !bioRef.current?.contains(e.target)) setBioOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [bioOpen]);
  // On phones the full playback row (10 nav buttons + speed unit + mode toggles + goal) would wrap
  // into a tall stack that eats the reader — hence the Steps/Modes/Goal pager above.
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const totalWords = doc.words.length;
  const skipRanges = settings.skipRanges || [];
  // Coverage = fraction of the COUNTABLE book actually read — flagged front/back matter is excluded.
  const coverage = tab.tracker ? tab.tracker.coverageExcluding(skipRanges) * 100 : 0;
  // ETA from measured pace (recent → session → set WPM fallback) rather than the setpoint.
  const effWpm = (tab.tracker && (tab.tracker.recentWpm() || tab.tracker.sessionWpm())) || settings.wpm;
  const remainingWords = Math.max(0, totalWords - idx);
  const secs = effWpm > 0 ? (remainingWords / effWpm) * 60 : 0;

  // "Finished" once you reach the end of the countable content (e.g. past the body into a skipped
  // index/notes section), or the countable book is essentially fully read.
  const lastContent = lastCountableWord(totalWords, skipRanges);
  const atEnd = totalWords > 0 && (idx >= lastContent || coverage >= 99.5);

  // One nav button, so the desktop (single interleaved row) and mobile (transport + fine rows)
  // layouts share button definitions instead of duplicating them.
  const navBtn = (title, onClick, label, keyHint) => (
    <button className="ctrl-btn" title={title} onClick={onClick}>
      <span>{label}</span>
      {!isCompact && keyHint && <kbd className="key-hint">{keyHint}</kbd>}
    </button>
  );
  // The play button reflects the active reading modes, not just scroll-to-read: read-aloud swaps the
  // glyph to a speaker (offline voice → headphones, since it survives a screen lock), and the title
  // lists every engaged toggle.
  const pv = playButtonView({
    playing,
    scrollMode: !!state.global.scrollAdvances,
    readAloud,
    offlineVoice: !!state.global.offlineVoice,
    followMode: settings.ttsFollowMode || (settings.firstWordTts ? 'firstWord' : 'off'),
    timerMin: state.global.ttsAutoStopMin || 0,
    adapt: !!settings.adaptivePace,
    voiceCmd: !!settings.audioCtrl,
  });
  const playBtn = (
    <button
      className={`play-btn${pv.cls ? ' ' + pv.cls : ''}`}
      disabled={pv.disabled}
      title={pv.title}
      onClick={pv.disabled ? undefined : onPlayPause}
    >
      {pv.glyph}
      {!isCompact && <kbd className="key-hint play-kbd">Space</kbd>}
    </button>
  );
  const B = {
    // Emoji glyphs over typographic characters: they carry colour and read at a glance on a phone,
    // where bare ‹ › ⇈ ⇊ are thin and near-identical. Grain is encoded by SHAPE — page ⏫⏬,
    // paragraph 🔼🔽, line ⬆️⬇️, word ⬅️➡️ — so the pairs stay distinguishable at a size.
    restart: () => navBtn('Restart (Home)', onRestart, '⏮️', 'Home'),
    pageUp: () => navBtn('Page up — current line jumps to the top visible line (PgUp)', onPageUp, '⏫', 'PgUp'),
    prevPara: () => navBtn('Previous paragraph (Ctrl+Up)', onPrevPara, '🔼', 'Ctrl↑'),
    prevLine: () => navBtn('Previous line (Up)', onPrevLine, '⬆️', '↑'),
    prevWord: () => navBtn('Previous word (Left)', onPrevWord, '⬅️', '←'),
    nextWord: () => navBtn('Next word (Right)', onNextWord, '➡️', '→'),
    nextLine: () => navBtn('Next line (Down)', onNextLine, '⬇️', '↓'),
    nextPara: () => navBtn('Next paragraph (Ctrl+Down)', onNextPara, '🔽', 'Ctrl↓'),
    pageDown: () => navBtn('Page down — current line jumps to the bottom visible line (PgDn)', onPageDown, '⏬', 'PgDn'),
  };

  return (
    <div className={`controls-bar${isCompact ? ' compact' : ''}${moreOpen ? ' more-open' : ''}`}>
      <div className="progress-row">
        <Trendline tab={tab} onPeek={onPeek} peekIdx={peekIdx} />
        <div className="progress-meta">
          {idx + 1} / {totalWords}
        </div>
        {/* The three jump buttons are desktop-only: on a phone this row has to hold the counter,
            coverage, ETA and the reading-mode chip, and the icons pushed it into a crowded wrap.
            Their keyboard shortcuts (J / U / G) and the Lines pane's own affordances still work. */}
        {!isCompact && (
          <>
            <button className="jump-current-btn" title="Jump to the current word — scroll the Lines pane back to where you're reading (J)" aria-label="Jump to current word" onClick={onJumpToCurrent}>📍<kbd className="key-hint">J</kbd></button>
            {onJumpToFrontier && <button className="jump-current-btn" title="Jump to the latest unread word — the first word after everything you've ever read (U)" aria-label="Jump to latest unread" onClick={onJumpToFrontier}>⏭️<kbd className="key-hint">U</kbd></button>}
            {onJumpToGap && <button className="jump-current-btn" title="Jump to the first unread word (skipped sections excluded). Click again from there to hop to the next read/unread boundary — backfill the patchy sections. (G)" aria-label="Jump to first unread gap" onClick={onJumpToGap}>🩹<kbd className="key-hint">G</kbd></button>}
          </>
        )}
        <div className="progress-meta" title={skipRanges.length ? 'Percent of the countable book read (flagged front/back matter excluded)' : 'Percent of the book actually read'}>📖 {coverage.toFixed(1)}%{skipRanges.length ? '*' : ''}</div>
        <div className="progress-meta" title="Estimated time remaining at your measured pace">⏱ {formatTime(secs)}</div>
        {/* Pace-ghost race: how far ahead of (or behind) the auto-speed marker you are, and a
            one-tap restart. The ghost also restarts itself when you go idle or jump. */}
        {ghostRace && (
          <div className={`progress-meta ghost-race ${ghostRace.status}`} title={`You are ${ghostRace.status === 'level' ? 'level with' : `${Math.abs(ghostRace.delta)} words ${ghostRace.status} of`} the pace ghost — it walks at your set WPM. It restarts when you go idle, jump, or press ↺.`}>
            <span aria-hidden="true">👻</span>
            <span className="gr-delta">{ghostRace.status === 'level' ? 'level' : `${ghostRace.delta > 0 ? '+' : ''}${ghostRace.delta}`}</span>
            {/* With a goal set, the goal's target is the finish line — show who reaches it first. */}
            {ghostGoal && (
              ghostGoal.readerDone || ghostGoal.ghostDone ? (
                <span className={`gr-verdict ${ghostGoal.leader}`} title={ghostGoal.leader === 'you' ? 'You reached the goal before the ghost' : ghostGoal.leader === 'ghost' ? 'The ghost reached the goal first' : 'You and the ghost reached the goal together'}>
                  {ghostGoal.leader === 'you' ? '🏁 you win' : ghostGoal.leader === 'ghost' ? '🏁 ghost wins' : '🏁 dead heat'}
                </span>
              ) : ghostGoal.leader ? (
                <span className={`gr-verdict ${ghostGoal.leader}`} title={`To the goal: you ~${fmtGap(ghostGoal.readerEta)} at your measured pace, ghost ~${fmtGap(ghostGoal.ghostEta)} at its set WPM`}>
                  {ghostGoal.leader === 'tie' ? 'neck and neck' : `${ghostGoal.leader === 'you' ? 'you' : 'ghost'} by ${fmtGap(ghostGoal.marginSec)}`}
                </span>
              ) : null
            )}
            <button className="gr-reset" title="Restart the ghost from your current word" aria-label="Restart pace ghost" onClick={onResetGhost}>↺</button>
          </div>
        )}
        <div
          className={`progress-meta reading-mode${readingMode === 'idle' ? ' rm-idle' : ''}`}
          title={`How the app thinks you're reading right now — ${MODES[readingMode]?.hint || ''}${modeIdleFrac != null ? ' (the underline drains as this decays to idle)' : ''}`}
        >
          {MODES[readingMode]?.icon} {MODES[readingMode]?.label}
          {modeIdleFrac != null && <i className="rm-underline" style={{ width: `${modeIdleFrac * 100}%` }} />}
        </div>
        {atEnd && (
          <button
            className={`finish-btn${(settings.completions || []).length ? ' done' : ''}`}
            title={(settings.completions || []).length ? 'Marked finished — click to review or update your rating & notes' : 'Mark this book finished and review your stats'}
            onClick={onConfirmFinished}
          >
            {(settings.completions || []).length ? '✓ Finished' : '✓ Confirm finished'}
          </button>
        )}
      </div>

      <TocBar tab={tab} onIconClick={onTocIcon} />

      <div className="playback-row">
        <div className="wpm-block">
          <label>WPM</label>
          <button
            className="wpm-step"
            title="Slower (−25)"
            aria-label="Slower"
            onClick={() => patchSettings(tab.id, { wpm: Math.max(60, settings.wpm - 25) })}
          >
            ➖
          </button>
          <input
            type="range"
            min={60}
            max={1500}
            step={10}
            value={settings.wpm}
            onChange={(e) => patchSettings(tab.id, { wpm: Number(e.target.value) })}
            style={{ width: 130 }}
          />
          <button
            className="wpm-step"
            title="Faster (+25)"
            aria-label="Faster"
            onClick={() => patchSettings(tab.id, { wpm: Math.min(1500, settings.wpm + 25) })}
          >
            ➕
          </button>
          <span className="wpm-value">{settings.wpm}</span>
          <select
            value={settings.speedUnit || 'Words'}
            onChange={(e) => patchSettings(tab.id, { speedUnit: e.target.value })}
            title="Speed unit"
          >
            <option value="Words">📝 Words</option>
            <option value="Letters">🔤 Letters</option>
            <option value="Syllables">🗣 Syllables</option>
          </select>
        </div>

        {isCompact ? (
          // Mobile: a fixed transport bar (page/line + play, symmetric around play) with a chevron
          // that expands the slide-in; the finer word/paragraph/restart steps appear as their own
          // aligned row when expanded — so nothing spills into a ragged wrap.
          <div className="playback-buttons compact-pb">
            <div className="pb-transport">
              {B.pageUp()}{B.prevLine()}{playBtn}{B.nextLine()}{B.pageDown()}
            </div>
            {moreOpen && (
              <div className="more-pager" role="tablist" aria-label="More controls pages">
                {['⏩ Steps', '🎛 Modes', '🎯 Goal'].map((l, i) => (
                  <button key={l} role="tab" aria-selected={morePage === i} className={`more-page-tab${morePage === i ? ' on' : ''}`} onClick={() => setMorePage(i)}>{l}</button>
                ))}
              </div>
            )}
            {moreOpen && morePage === 0 && (
              <div className="pb-fine">
                {B.restart()}{B.prevPara()}{B.prevWord()}{B.nextWord()}{B.nextPara()}
              </div>
            )}
          </div>
        ) : (
          <div className="playback-buttons">
            {B.restart()}{B.pageUp()}{B.prevPara()}{B.prevLine()}{B.prevWord()}
            {playBtn}
            {B.nextWord()}{B.nextLine()}{B.nextPara()}{B.pageDown()}
          </div>
        )}

        {(!isCompact || (moreOpen && morePage === 1)) && (
        <div className="mode-block">
          <div className="mode-pair">
            <span>TTS{!isCompact && <kbd className="key-hint">A</kbd>}</span>
            <button
              className={readAloud ? 'toggle-on' : ''}
              onClick={onToggleReadAloud}
              title="Read aloud (TTS): speak from the current position and advance in sync (Play to start)"
            >
              {readAloud ? 'On' : 'Off'}
            </button>
          </div>
          {readAloud && (
            <div className="mode-pair">
              <span title="Read-aloud playback speed">SPEED</span>
              <select
                value={state.global.ttsSpeed ?? 1}
                onChange={(e) => updateGlobal({ ttsSpeed: Number(e.target.value) })}
                title="Read-aloud playback speed (applies to the native and offline voices). For finer steps use the slider in Audio → Audio Settings."
              >
                {/* Always include the current value so an off-grid speed set via the Audio Settings
                    slider (e.g. 0.85) shows its real label instead of collapsing to the first option. */}
                {[...new Set([0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2, state.global.ttsSpeed ?? 1])]
                  .sort((a, b) => a - b)
                  .map((v) => (
                    <option key={v} value={v}>{v}×</option>
                  ))}
              </select>
            </div>
          )}
          <div className="mode-pair">
            <span title="Non-driving TTS that speaks as you read: the first word of each sentence (a progress marker), or the whole current line (usually cut off by the next line, since TTS lags fast reading)">FOLLOW</span>
            <select
              value={settings.ttsFollowMode || (settings.firstWordTts ? 'firstWord' : 'off')}
              onChange={(e) => {
                const v = e.target.value;
                // Speak-along FOLLOW is mutually exclusive with full read-aloud TTS.
                patchSettings(tab.id, { ttsFollowMode: v, firstWordTts: false, ...(v !== 'off' && settings.readAloud ? { readAloud: false } : {}) });
              }}
              title="Speak-along TTS while reading (does not drive the pace); off while full read-aloud TTS is on"
            >
              <option value="off">🔇 Off</option>
              <option value="firstWord">🔤 First word</option>
              <option value="line">📃 Line</option>
            </select>
          </div>
          <div className="mode-pair">
            <span title="Focus mode: fullscreen the app, fade the controls, and (Chrome/Edge) black out your other monitors">FOCUS{!isCompact && <kbd className="key-hint">F</kbd>}</span>
            <button
              className={state.global.focusMode ? 'toggle-on' : ''}
              onClick={onToggleFocus}
              title="Block distractions: fullscreen + black out other monitors"
            >
              {state.global.focusMode ? 'On' : 'Off'}
            </button>
            {state.global.focusMode && (
              <input
                type="range"
                min={0.4}
                max={1}
                step={0.05}
                value={state.global.focusDim ?? 0.92}
                onChange={(e) => updateGlobal({ focusDim: Number(e.target.value) })}
                title="Other-monitor dimness (black ↔ light)"
                style={{ width: 70 }}
              />
            )}
          </div>
          <div className="mode-pair">
            <span title="BLB — blue-light blocker: warm the whole app to cut blue light for evening/bedtime reading. Independent of focus mode.">BLB{!isCompact && <kbd className="key-hint">B</kbd>}</span>
            <button
              className={state.global.nightShift ? 'toggle-on' : ''}
              onClick={() => updateGlobal({ nightShift: !state.global.nightShift })}
              title="Reduce blue light (bedtime) — warm the whole app"
            >
              {state.global.nightShift ? 'On' : 'Off'}
            </button>
            {state.global.nightShift && (
              <input
                type="range" min={0.1} max={0.85} step={0.05}
                value={state.global.nightShiftStrength ?? 0.4}
                onChange={(e) => updateGlobal({ nightShiftStrength: Number(e.target.value) })}
                title="How warm — deeper cuts more blue"
                style={{ width: 70 }}
              />
            )}
          </div>
          <div className="mode-pair">
            <span title="Scroll-to-read (Lines pane): scroll the text normally and whatever passes the top edge counts as read — your reading position follows the topmost visible line.">SCROLL{!isCompact && <kbd className="key-hint">S</kbd>}</span>
            <button
              className={state.global.scrollAdvances ? 'toggle-on' : ''}
              onClick={() => {
                const turningOn = !state.global.scrollAdvances;
                updateGlobal({ scrollAdvances: turningOn });
                // Scroll-to-read and read-aloud are mutually exclusive.
                if (turningOn && tab.settings.readAloud) patchSettings(tab.id, { readAloud: false });
              }}
              title="Scroll-to-read: scroll the Lines pane; text that leaves the top counts as read"
            >
              {state.global.scrollAdvances ? 'On' : 'Off'}
            </button>
            {state.global.scrollAdvances && !settings.scrollReadCrosshair && (
              <input
                type="range" min={0} max={100} step={5}
                value={Math.round((settings.scrollReadPoint ?? 0) * 100)}
                onChange={(e) => patchSettings(tab.id, { scrollReadPoint: Number(e.target.value) / 100 })}
                title="Where scrolled text counts as read: 0% = once it leaves the top · 100% = as soon as it enters the clear area"
                style={{ width: 64 }}
              />
            )}
            {state.global.scrollAdvances && (
              <button
                className={settings.scrollReadCrosshair ? 'toggle-on' : ''}
                disabled={!(settings.linesCrosshairs || []).length}
                onClick={() => patchSettings(tab.id, { scrollReadCrosshair: !settings.scrollReadCrosshair })}
                title={(settings.linesCrosshairs || []).length
                  ? 'Tie the read point to your first placed crosshair — drag the crosshair to move where scrolled text counts as read'
                  : 'Place a crosshair first (View → Crosshairs) to tie the read point to it'}
              >
                🎯
              </button>
            )}
          </div>
          {(() => {
            const g = state.global;
            const camGuardOn = !!(g.webcamAttention || g.webcamDoze || g.webcamAwayAlarm || g.webcamDistanceNudge || g.webcamFocusStats);
            const bioCount = [audioCtrl, camGuardOn, !!g.handGestures, !!g.eyeGestures?.on].filter(Boolean).length;
            const row = (icon, label, on, toggle, extra) => (
              <label className="bio-quick-row">
                <input type="checkbox" checked={on} onChange={toggle} />
                <span className="bqr-icon" aria-hidden="true">{icon}</span>
                <span className="bqr-label">{label}</span>
                {extra}
              </label>
            );
            return (
              <div className="mode-pair bio-pair" ref={bioRef}>
                <span title="Biometric controls — voice/clap commands, camera watching (attention & doze) and hand gestures, unified in one popup.">BIOMETRIC</span>
                <button
                  className={bioCount ? 'toggle-on' : ''}
                  onClick={() => setBioOpen((v) => !v)}
                  title="Voice, camera & gesture controls — click for the quick panel"
                  aria-expanded={bioOpen}
                >
                  {bioCount ? `On · ${bioCount}` : 'Off'}
                </button>
                {bioOpen && (
                  <div className="bio-quick-pop">
                    {row('🎤', 'Voice / clap commands', !!audioCtrl, onToggleAudioCtrl, !isCompact && <kbd className="key-hint">V</kbd>)}
                    {row('👀', 'Watching — pause when you look away', !!g.webcamAttention, () => updateGlobal({ webcamAttention: !g.webcamAttention }))}
                    {row('😴', 'Doze detection', !!g.webcamDoze, () => updateGlobal({ webcamDoze: !g.webcamDoze }))}
                    {row('🖐', 'Hand gestures', !!g.handGestures, () => updateGlobal({ handGestures: !g.handGestures }))}
                    <div className="bio-quick-actions">
                      <button onClick={() => { setBioOpen(false); onOpenBiometric?.(); }} title="Every biometric option — mappings, calibration, eye gestures, alarms">⚙ All controls…</button>
                      <button onClick={() => { setBioOpen(false); updateGlobal({ webcamPreview: true }); }} title="Show the Biometric Control Feed popup (self-view + event log)">📡 Live feed</button>
                    </div>
                    <p className="bio-quick-note">Camera &amp; audio are analysed on your device and never leave it.</p>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="mode-pair">
            <span>TIMER</span>
            <select
              value={state.global.ttsAutoStopMin || 0}
              onChange={(e) => updateGlobal({ ttsAutoStopMin: Number(e.target.value) })}
              title="Auto-stop reading / read-aloud after this long — handy for winding down"
            >
              <option value={0}>♾ Off</option>
              <option value={5}>⏱ 5m</option>
              <option value={10}>⏱ 10m</option>
              <option value={15}>⏱ 15m</option>
              <option value={20}>⏱ 20m</option>
              <option value={30}>⏰ 30m</option>
              <option value={45}>⏰ 45m</option>
              <option value={60}>⏰ 60m</option>
            </select>
          </div>
          <div className="mode-pair">
            <span>ADAPT</span>
            <button
              className={tab.settings.adaptivePace ? 'toggle-on' : ''}
              onClick={() => patchSettings(tab.id, { adaptivePace: !tab.settings.adaptivePace })}
              title="Adaptive pace: periodic comprehension checks raise or lower your WPM automatically"
            >
              {tab.settings.adaptivePace ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        )}
      </div>

      {(!isCompact || (moreOpen && morePage === 2)) && <GoalRow tab={tab} onGoalComplete={onGoalComplete} goalKills={goalKills} />}
    </div>
  );
}

function GoalRow({ tab, onGoalComplete, goalKills }) {
  const { patchSettings } = useApp();
  const goal = tab.settings.goal || { type: 'None', value: '' };
  const status = computeGoalStatus(tab, goal);
  const frac = goalFraction(tab, goal);
  const complete = frac != null && frac >= 1;
  const goalKey = goal && goal.type !== 'None' ? `${goal.type}:${goal.value}:${goal.baseline || 0}` : null;
  const loggedKey = useRef(null);

  // Log a completed goal to the session killfeed exactly once per distinct goal.
  useEffect(() => {
    if (complete && goalKey && loggedKey.current !== goalKey) {
      loggedKey.current = goalKey;
      onGoalComplete?.(`${goal.type} ${goal.value}`);
    }
  }, [complete, goalKey, goal.type, goal.value, onGoalComplete]);

  return (
    <>
      <div className="goal-row">
        <span>GOAL</span>
        <select
          value={goal.type}
          onChange={(e) =>
            patchSettings(tab.id, {
              goal: { ...goal, type: e.target.value, baseline: e.target.value.startsWith('Relative') ? tab.settings.wordIndex : 0 },
            })
          }
        >
          <option value="None">🚫 None</option>
          <option value="Section">📑 Section (set via ToC)</option>
          <option value="AbsoluteWords">🔢 Reach word #</option>
          <option value="AbsoluteLines">📏 Reach line #</option>
          <option value="AbsolutePercent">💯 Reach % of book</option>
          <option value="RelativeWords">➕🔢 Read N more words</option>
          <option value="RelativeLines">➕📏 Read N more lines</option>
          <option value="RelativePercent">➕💯 Read N% more</option>
          <option value="ActiveTime">⏱ Read for N minutes</option>
        </select>
        <input
          type="text"
          value={goal.value ?? ''}
          onChange={(e) => patchSettings(tab.id, { goal: { ...goal, value: e.target.value } })}
          placeholder="Goal value"
        />
        <button onClick={() => patchSettings(tab.id, { goal: { ...goal, set: true, baseline: tab.settings.wordIndex } })}>Set</button>
        <button onClick={() => patchSettings(tab.id, { goal: null })}>Clear</button>
        {frac != null && (
          <div className="goal-bar" title={status}>
            <div className={`goal-fill${complete ? ' goal-fill-done' : ''}`} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
          </div>
        )}
        <span className="goal-status">{status}</span>
      </div>
      {goalKills && goalKills.length > 0 && (
        <div className="goal-killfeed" title="Goals completed this session">
          <span className="goal-kf-label">🏁 Completed:</span>
          {goalKills.map((k, i) => (
            <span key={i} className="goal-kf-item">✓ {k.label} <span className="goal-kf-ts">{k.time}</span></span>
          ))}
        </div>
      )}
    </>
  );
}
