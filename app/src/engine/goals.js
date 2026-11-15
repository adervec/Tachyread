// Reading-goal math, shared by the controls bar (progress + status) and the TOC minimap bar
// (target marker). A goal is { type, value, baseline?, start?, end?, label?, set? }.
//
//   Section            finish a TOC section (start→end words). Created from the TOC pane.
//   AbsoluteWords/…    reach an absolute word / line / percent position.
//   RelativeWords/…    advance N words / lines / percent from where the goal was set.
//   ActiveTime         spend N active minutes reading (no fixed document position).
import { t } from '../i18n.js';

// The goal type as the reader sees it (the type values themselves stay as stored).
export const GOAL_TYPE_LABELS = {
  Section: t('Section'),
  AbsoluteWords: t('Absolute words'),
  AbsoluteLines: t('Absolute lines'),
  AbsolutePercent: t('Absolute percent'),
  RelativeWords: t('Relative words'),
  RelativeLines: t('Relative lines'),
  RelativePercent: t('Relative percent'),
  ActiveTime: t('Active time'),
};

function effWpm(tab) {
  const tr = tab.tracker;
  return (tr && (tr.recentWpm() || tr.sessionWpm())) || tab.settings.wpm || 250;
}

// Fraction (0..1+) of the goal achieved, or null when there's no measurable goal.
export function goalFraction(tab, goal) {
  if (!goal || goal.type === 'None') return null;
  const idx = tab.settings.wordIndex;
  const total = tab.doc.words.length || 1;
  if (goal.type === 'Section') {
    if (!(goal.end > goal.start)) return null;
    return (idx - goal.start) / (goal.end - goal.start);
  }
  const value = Number(goal.value);
  if (!isFinite(value) || value <= 0) return null;
  switch (goal.type) {
    case 'AbsoluteWords': return idx / value;
    case 'AbsoluteLines': return ((tab.doc.wordToLine[idx] || 0) + 1) / value;
    case 'AbsolutePercent': return ((idx / total) * 100) / value;
    case 'RelativeWords': return (idx - (goal.baseline || 0)) / value;
    case 'RelativeLines': return ((tab.doc.wordToLine[idx] || 0) - (tab.doc.wordToLine[goal.baseline || 0] || 0)) / value;
    case 'RelativePercent': return (((idx - (goal.baseline || 0)) / total) * 100) / value;
    case 'ActiveTime': return ((tab.tracker?.sessionActiveMs || 0) / 60000) / value;
    default: return null;
  }
}

// The word index a goal targets. { index, projected } — projected=true when the position is
// estimated from pace (time-based goals) rather than fixed by the goal itself. null = no target.
export function goalTargetIndex(tab, goal) {
  if (!goal || goal.type === 'None') return null;
  const idx = tab.settings.wordIndex;
  const total = tab.doc.words.length || 1;
  const clamp = (i) => Math.max(0, Math.min(total - 1, Math.round(i)));
  const lineWord = (lineNum) => {
    const li = Math.max(0, Math.min(tab.doc.lines.length - 1, lineNum - 1));
    const w = tab.doc.lines[li]?.startWordIndex;
    return w >= 0 ? w : idx;
  };
  if (goal.type === 'Section') return goal.end > goal.start ? { index: clamp(goal.end), projected: false } : null;
  const value = Number(goal.value);
  if (!isFinite(value) || value <= 0) return null;
  switch (goal.type) {
    case 'AbsoluteWords': return { index: clamp(value - 1), projected: false };
    case 'AbsoluteLines': return { index: clamp(lineWord(value)), projected: false };
    case 'AbsolutePercent': return { index: clamp((value / 100) * total), projected: false };
    case 'RelativeWords': return { index: clamp((goal.baseline || 0) + value), projected: false };
    case 'RelativeLines': {
      const baseLine = tab.doc.wordToLine[goal.baseline || 0] || 0;
      return { index: clamp(lineWord(baseLine + value + 1)), projected: false };
    }
    case 'RelativePercent': return { index: clamp((goal.baseline || 0) + (value / 100) * total), projected: false };
    case 'ActiveTime': {
      const remainingMin = Math.max(0, value - (tab.tracker?.sessionActiveMs || 0) / 60000);
      return { index: clamp(idx + remainingMin * effWpm(tab)), projected: true };
    }
    default: return null;
  }
}

export function computeGoalStatus(tab, goal) {
  if (!goal || goal.type === 'None') return t('No active goal');
  const idx = tab.settings.wordIndex;
  // Guard against a 0-word doc (empty/unparsed) — matches goalFraction/goalTargetIndex, and keeps the
  // percent goals from rendering "NaN%"/"Infinity%" (the focus-panel goal widget shows this string).
  const total = tab.doc.words.length || 1;
  if (goal.type === 'Section') {
    if (!(goal.end > goal.start)) return t('Set a section goal from the TOC');
    const pct = Math.max(0, Math.min(100, ((idx - goal.start) / (goal.end - goal.start)) * 100));
    return t('{section} — {pct}% (finish)', { section: goal.label || t('Section'), pct: pct.toFixed(1) });
  }
  const value = Number(goal.value);
  if (!isFinite(value) || value <= 0) return t('Set a value to begin');
  switch (goal.type) {
    case 'AbsoluteWords':
      return t('{done} / {value} words ({pct}%)', { done: idx, value, pct: ((idx / value) * 100).toFixed(1) });
    case 'AbsoluteLines': {
      const cl = tab.doc.wordToLine[idx] + 1 || 0;
      return t('{done} / {value} lines', { done: cl, value });
    }
    case 'AbsolutePercent':
      return t('{pct}% / {value}%', { pct: ((idx / total) * 100).toFixed(1), value });
    case 'RelativeWords':
      return t('{done} / {value} words (from start)', { done: idx - (goal.baseline || 0), value });
    case 'RelativeLines': {
      const cl = (tab.doc.wordToLine[idx] || 0) - (tab.doc.wordToLine[goal.baseline || 0] || 0);
      return t('{done} / {value} lines (from start)', { done: cl, value });
    }
    case 'RelativePercent': {
      const delta = ((idx - (goal.baseline || 0)) / total) * 100;
      return t('{pct}% / {value}%', { pct: delta.toFixed(1), value });
    }
    case 'ActiveTime':
      return t('{done} / {value} min', { done: Math.round((tab.tracker?.sessionActiveMs || 0) / 60000), value });
    default:
      return '';
  }
}
