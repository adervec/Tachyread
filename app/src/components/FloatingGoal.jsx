import FloatingChip from './FloatingChip.jsx';
import { goalFraction, computeGoalStatus } from '../engine/goals.js';

// The active goal as a floating transparent chip (mobile always; desktop when chip mode is on) —
// its status line + a progress bar. Renders nothing when no goal is set.
export default function FloatingGoal({ tab, pos, onMove, onDrop }) {
  const goal = tab.settings.goal;
  if (!goal || !goal.type || goal.type === 'None') return null;
  const status = computeGoalStatus(tab, goal);
  const frac = goalFraction(tab, goal);
  const complete = frac != null && frac >= 1;
  const opacity = tab.settings.statsOpacity ?? 0.92;
  // Default to the right side (clear of the top-left stats chip), stacked above the timer.
  const defaultPos = { x: typeof window !== 'undefined' ? window.innerWidth - 210 : 300, y: 150 };

  return (
    <FloatingChip
      pos={pos}
      onMove={onMove}
      onDrop={onDrop}
      opacity={opacity}
      className="floating-goal"
      defaultPos={defaultPos}
      title="Active goal · drag to move · transparency in Tab Settings"
    >
      <div className="chip-label">🏁 {goal.type.replace(/^(Absolute|Relative)/, '$1 ')}</div>
      <div className="chip-status">{status}</div>
      {frac != null && (
        <div className="goal-bar" style={{ marginTop: 4 }}>
          <div className={`goal-fill${complete ? ' goal-fill-done' : ''}`} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
        </div>
      )}
    </FloatingChip>
  );
}
