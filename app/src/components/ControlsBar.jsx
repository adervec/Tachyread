import { useEffect, useRef } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { useIsCompact } from '../state/device.js';
import Trendline from './Trendline.jsx';
import TocBar from './TocBar.jsx';
import { goalFraction, computeGoalStatus } from '../engine/goals.js';
import { MODES } from '../engine/readingMode.js';
import { lastCountableWord } from '../document/toc.js';
import { playButtonView } from '../features/playButtonMode.js';

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ControlsBar({ tab, onPeek, peekIdx, onPlayPause, onPrevWord, onNextWord, onPrevLine, onNextLine, onPrevPara, onNextPara, onPageUp, onPageDown, onRestart, playing, readingMode = 'idle', onToggleAudioCtrl, onToggleReadAloud, audioCtrl, readAloud, onConfirmFinished, onGoalComplete, goalKills, onTocIcon, onToggleFocus, onJumpToCurrent, moreOpen = false }) {
  const { patchSettings, state, updateGlobal } = useApp();
  const isCompact = useIsCompact();
  // On phones the full playback row (10 nav buttons + speed unit + 4 mode toggles + goal) wraps into a
  // tall stack that eats the reader. The finer steps are behind a "More" disclosure whose toggle lives
  // in the dock's grip bar (App.jsx) — this component just renders the extra row when `moreOpen`.
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
  const navBtn = (title, onClick, label) => (
    <button className="ctrl-btn" title={title} onClick={onClick}>{label}</button>
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
    </button>
  );
  const B = {
    restart: () => navBtn('Restart (Home)', onRestart, '|<'),
    pageUp: () => navBtn('Page up — current line jumps to the top visible line (PgUp)', onPageUp, '⇞'),
    prevPara: () => navBtn('Previous paragraph (Ctrl+Up)', onPrevPara, '⇈'),
    prevLine: () => navBtn('Previous line (Up)', onPrevLine, '↑'),
    prevWord: () => navBtn('Previous word (Left)', onPrevWord, '‹'),
    nextWord: () => navBtn('Next word (Right)', onNextWord, '›'),
    nextLine: () => navBtn('Next line (Down)', onNextLine, '↓'),
    nextPara: () => navBtn('Next paragraph (Ctrl+Down)', onNextPara, '⇊'),
    pageDown: () => navBtn('Page down — current line jumps to the bottom visible line (PgDn)', onPageDown, '⇟'),
  };

  return (
    <div className={`controls-bar${isCompact ? ' compact' : ''}${moreOpen ? ' more-open' : ''}`}>
      <div className="progress-row">
        <Trendline tab={tab} onPeek={onPeek} peekIdx={peekIdx} />
        <div className="progress-meta">
          {idx + 1} / {totalWords}
        </div>
        <button className="jump-current-btn" title="Jump to the current word — scroll the Lines pane back to where you're reading" aria-label="Jump to current word" onClick={onJumpToCurrent}>⌖</button>
        <div className="progress-meta" title={skipRanges.length ? 'Percent of the countable book read (flagged front/back matter excluded)' : 'Percent of the book actually read'}>📖 {coverage.toFixed(1)}%{skipRanges.length ? '*' : ''}</div>
        <div className="progress-meta" title="Estimated time remaining at your measured pace">⏱ {formatTime(secs)}</div>
        <div
          className={`progress-meta reading-mode${readingMode === 'idle' ? ' rm-idle' : ''}`}
          title={`How the app thinks you're reading right now — ${MODES[readingMode]?.hint || ''}`}
        >
          {MODES[readingMode]?.icon} {MODES[readingMode]?.label}
        </div>
        {atEnd && (
          <button className="finish-btn" title="Mark this book finished and review your stats" onClick={onConfirmFinished}>
            ✓ Confirm finished
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
            −
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
            +
          </button>
          <span className="wpm-value">{settings.wpm}</span>
          <select
            value={settings.speedUnit || 'Words'}
            onChange={(e) => patchSettings(tab.id, { speedUnit: e.target.value })}
            title="Speed unit"
          >
            <option>Words</option>
            <option>Letters</option>
            <option>Syllables</option>
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

        <div className="mode-block">
          <div className="mode-pair">
            <span>TTS</span>
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
              onChange={(e) => patchSettings(tab.id, { ttsFollowMode: e.target.value })}
              title="Speak-along TTS while reading (does not drive the pace)"
            >
              <option value="off">Off</option>
              <option value="firstWord">First word</option>
              <option value="line">Line</option>
            </select>
          </div>
          <div className="mode-pair">
            <span title="Focus mode: fullscreen the app, fade the controls, and (Chrome/Edge) black out your other monitors">FOCUS</span>
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
            <span title="Scroll-to-read (Lines pane): scroll the text normally and whatever passes the top edge counts as read — your reading position follows the topmost visible line.">SCROLL</span>
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
          </div>
          <div className="mode-pair">
            <span>VOICE COMMAND</span>
            <button className={audioCtrl ? 'toggle-on' : ''} onClick={onToggleAudioCtrl} title="Voice / clap commands">{audioCtrl ? 'On' : 'Off'}</button>
          </div>
          <div className="mode-pair">
            <span>TIMER</span>
            <select
              value={state.global.ttsAutoStopMin || 0}
              onChange={(e) => updateGlobal({ ttsAutoStopMin: Number(e.target.value) })}
              title="Auto-stop reading / read-aloud after this long — handy for winding down"
            >
              <option value={0}>Off</option>
              <option value={5}>5m</option>
              <option value={10}>10m</option>
              <option value={15}>15m</option>
              <option value={20}>20m</option>
              <option value={30}>30m</option>
              <option value={45}>45m</option>
              <option value={60}>60m</option>
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
      </div>

      <GoalRow tab={tab} onGoalComplete={onGoalComplete} goalKills={goalKills} />
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
          <option>None</option>
          <option value="Section">Section (set via ToC)</option>
          <option>AbsoluteWords</option>
          <option>AbsoluteLines</option>
          <option>AbsolutePercent</option>
          <option>RelativeWords</option>
          <option>RelativeLines</option>
          <option>RelativePercent</option>
          <option>ActiveTime</option>
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
