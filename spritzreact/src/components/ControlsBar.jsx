import { useApp } from '../state/AppContext.jsx';
import Trendline from './Trendline.jsx';

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ControlsBar({ tab, onJumpWord, onPlayPause, onPrevWord, onNextWord, onPrevLine, onNextLine, onPrevPara, onNextPara, onRestart, playing, onToggleTyping, onToggleSpeaking, onToggleAudiobook, onToggleAudioCtrl, onToggleReadAloud, onCycleHide, hideMode, typing, speaking, audiobook, audioCtrl, readAloud, onConfirmFinished }) {
  const { patchSettings } = useApp();
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const totalWords = doc.words.length;
  const pct = totalWords ? (idx / totalWords) * 100 : 0;
  // Coverage = fraction of the book actually read (not just the furthest position reached).
  const coverage = tab.tracker ? tab.tracker.coverage() * 100 : 0;
  // ETA from measured pace (recent → session → set WPM fallback) rather than the setpoint.
  const effWpm = (tab.tracker && (tab.tracker.recentWpm() || tab.tracker.sessionWpm())) || settings.wpm;
  const remainingWords = Math.max(0, totalWords - idx);
  const secs = effWpm > 0 ? (remainingWords / effWpm) * 60 : 0;

  const atEnd = totalWords > 0 && idx >= totalWords - 1;

  return (
    <div className="controls-bar">
      <div className="progress-row">
        <Trendline tab={tab} onJumpWord={onJumpWord} />
        <div className="progress-meta">
          {idx + 1} / {totalWords}
        </div>
        <div className="progress-meta" title="Percent of the book actually read">📖 {coverage.toFixed(0)}%</div>
        <div className="progress-meta" title="Estimated time remaining at your measured pace">⏱ {formatTime(secs)}</div>
        {atEnd && (
          <button className="finish-btn" title="Mark this book finished and review your stats" onClick={onConfirmFinished}>
            ✓ Confirm finished
          </button>
        )}
      </div>

      <div className="playback-row">
        <div className="wpm-block">
          <label>WPM</label>
          <input
            type="range"
            min={60}
            max={1500}
            step={10}
            value={settings.wpm}
            onChange={(e) => patchSettings(tab.id, { wpm: Number(e.target.value) })}
            style={{ width: 130 }}
          />
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
          <button className="ctrl-btn" title="Restart (Home)" onClick={onRestart}>|&lt;</button>
          <button className="ctrl-btn" title="Previous paragraph (Ctrl+Up)" onClick={onPrevPara}>⇈</button>
          <button className="ctrl-btn" title="Previous line (Up)" onClick={onPrevLine}>↑</button>
          <button className="ctrl-btn" title="Previous word (Left)" onClick={onPrevWord}>&lt;</button>
          <button className="play-btn" title="Play / Pause (Space)" onClick={onPlayPause}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="ctrl-btn" title="Next word (Right)" onClick={onNextWord}>&gt;</button>
          <button className="ctrl-btn" title="Next line (Down)" onClick={onNextLine}>↓</button>
          <button className="ctrl-btn" title="Next paragraph (Ctrl+Down)" onClick={onNextPara}>⇊</button>
        </div>

        <div className="mode-block">
          <div className="mode-pair">
            <span>SHOW</span>
            <button onClick={onCycleHide} title="Cycle hide mode">{hideMode}</button>
          </div>
          <div className="mode-pair">
            <span>READ</span>
            <button
              className={readAloud ? 'toggle-on' : ''}
              onClick={onToggleReadAloud}
              title="Read aloud: speak from the current position and advance in sync (Play to start)"
            >
              {readAloud ? 'On' : 'Off'}
            </button>
          </div>
          <div className="mode-pair">
            <span>TYPE</span>
            <button className={typing ? 'toggle-on' : ''} onClick={onToggleTyping}>{typing ? 'On' : 'Off'}</button>
          </div>
          <div className="mode-pair">
            <span>SPEAK</span>
            <button className={speaking ? 'toggle-on' : ''} onClick={onToggleSpeaking}>{speaking ? 'On' : 'Off'}</button>
          </div>
          <div className="mode-pair">
            <span>REC</span>
            <button className={audiobook ? 'toggle-on' : ''} onClick={onToggleAudiobook}>{audiobook ? 'On' : 'Off'}</button>
          </div>
          <div className="mode-pair">
            <span>AUDIO</span>
            <button className={audioCtrl ? 'toggle-on' : ''} onClick={onToggleAudioCtrl}>{audioCtrl ? 'On' : 'Off'}</button>
          </div>
        </div>
      </div>

      <GoalRow tab={tab} />
    </div>
  );
}

function GoalRow({ tab }) {
  const { patchSettings } = useApp();
  const goal = tab.settings.goal || { type: 'None', value: '' };
  const status = computeGoalStatus(tab, goal);
  return (
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
        value={goal.value}
        onChange={(e) => patchSettings(tab.id, { goal: { ...goal, value: e.target.value } })}
        placeholder="Goal value"
      />
      <button onClick={() => patchSettings(tab.id, { goal: { ...goal, set: true, baseline: tab.settings.wordIndex } })}>Set</button>
      <button onClick={() => patchSettings(tab.id, { goal: null })}>Clear</button>
      <span style={{ marginLeft: 10, fontFamily: 'Consolas, monospace' }}>{status}</span>
    </div>
  );
}

function computeGoalStatus(tab, goal) {
  if (!goal || goal.type === 'None') return 'No active goal';
  const idx = tab.settings.wordIndex;
  const total = tab.doc.words.length;
  const value = Number(goal.value);
  if (!isFinite(value) || value <= 0) return 'Set a value to begin';
  switch (goal.type) {
    case 'AbsoluteWords':
      return `${idx} / ${value} words (${((idx / value) * 100).toFixed(1)}%)`;
    case 'AbsoluteLines': {
      const cl = tab.doc.wordToLine[idx] + 1 || 0;
      return `${cl} / ${value} lines`;
    }
    case 'AbsolutePercent':
      return `${((idx / total) * 100).toFixed(1)}% / ${value}%`;
    case 'RelativeWords':
      return `${idx - (goal.baseline || 0)} / ${value} words (from start)`;
    case 'RelativeLines': {
      const cl = (tab.doc.wordToLine[idx] || 0) - (tab.doc.wordToLine[goal.baseline || 0] || 0);
      return `${cl} / ${value} lines (from start)`;
    }
    case 'RelativePercent': {
      const delta = ((idx - (goal.baseline || 0)) / total) * 100;
      return `${delta.toFixed(1)}% / ${value}%`;
    }
    case 'ActiveTime':
      return `${Math.round(((tab.tracker?.sessionActiveMs || 0)) / 60000)} / ${value} min`;
    default:
      return '';
  }
}
