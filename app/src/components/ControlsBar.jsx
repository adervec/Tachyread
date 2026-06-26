import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { useIsCompact } from '../state/device.js';
import Trendline from './Trendline.jsx';
import TocBar from './TocBar.jsx';
import { goalFraction, computeGoalStatus } from '../engine/goals.js';
import { lastCountableWord } from '../document/toc.js';

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ControlsBar({ tab, onPeek, peekIdx, onPlayPause, onPrevWord, onNextWord, onPrevLine, onNextLine, onPrevPara, onNextPara, onPageUp, onPageDown, onRestart, playing, onToggleAudioCtrl, onToggleReadAloud, audioCtrl, readAloud, onConfirmFinished, onGoalComplete, goalKills, onTocIcon }) {
  const { patchSettings, state, updateGlobal } = useApp();
  const isCompact = useIsCompact();
  // On phones the full playback row (10 nav buttons + speed unit + 4 mode toggles + goal) wraps into
  // a tall stack that eats the reader. Collapse the secondary controls behind a "More" disclosure so
  // the default bar is just the essentials (WPM, page/line stepping, play). Desktop is unchanged.
  const [moreOpen, setMoreOpen] = useState(false);
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

  return (
    <div className={`controls-bar${isCompact ? ' compact' : ''}${moreOpen ? ' more-open' : ''}`}>
      <div className="progress-row">
        <Trendline tab={tab} onPeek={onPeek} peekIdx={peekIdx} />
        <div className="progress-meta">
          {idx + 1} / {totalWords}
        </div>
        <div className="progress-meta" title={skipRanges.length ? 'Percent of the countable book read (flagged front/back matter excluded)' : 'Percent of the book actually read'}>📖 {coverage.toFixed(1)}%{skipRanges.length ? '*' : ''}</div>
        <div className="progress-meta" title="Estimated time remaining at your measured pace">⏱ {formatTime(secs)}</div>
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

        <div className="playback-buttons">
          <button className="ctrl-btn pb-2nd" title="Restart (Home)" onClick={onRestart}>|&lt;</button>
          <button className="ctrl-btn" title="Page up — current line jumps to the top visible line (PgUp)" onClick={onPageUp}>⇞</button>
          <button className="ctrl-btn pb-2nd" title="Previous paragraph (Ctrl+Up)" onClick={onPrevPara}>⇈</button>
          <button className="ctrl-btn" title="Previous line (Up)" onClick={onPrevLine}>↑</button>
          <button className="ctrl-btn pb-2nd" title="Previous word (Left)" onClick={onPrevWord}>&lt;</button>
          <button className="play-btn" title="Play / Pause (Space)" onClick={onPlayPause}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="ctrl-btn pb-2nd" title="Next word (Right)" onClick={onNextWord}>&gt;</button>
          <button className="ctrl-btn" title="Next line (Down)" onClick={onNextLine}>↓</button>
          <button className="ctrl-btn pb-2nd" title="Next paragraph (Ctrl+Down)" onClick={onNextPara}>⇊</button>
          <button className="ctrl-btn" title="Page down — current line jumps to the bottom visible line (PgDn)" onClick={onPageDown}>⇟</button>
        </div>

        {isCompact && (
          <button
            className="ctrl-more"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            title="Show / hide word & paragraph steps, mode toggles, and goal"
          >
            {moreOpen ? '⋯ Less' : '⋯ More'}
          </button>
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
            <span title="Mouse-wheel / trackpad scrolling over the reader moves your reading position forward and back">SCROLL</span>
            <button
              className={state.global.scrollAdvances ? 'toggle-on' : ''}
              onClick={() => updateGlobal({ scrollAdvances: !state.global.scrollAdvances })}
              title="Scroll to advance reading (instead of just scrolling the pane)"
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
