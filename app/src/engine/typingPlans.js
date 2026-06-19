// Typing plans — a saved, ordered workout of typing steps. Each step is one drill/passage config
// repeated for a number of SETS, with an optional spoken description. A plan runs step by step, set
// by set (see App's plan runner); the editor lives in dialogs/TypingPlanDialog.jsx.
//
//   plan = { id, name, steps: [step] }
//   step = { id, mode, runMode, runLimit, sets, description }
//
// Pure: model factories + operations only.

const uid = () => Math.random().toString(36).slice(2);

export function makeStep(partial = {}) {
  return {
    id: uid(),
    mode: 'commonWords',   // a typing-mode id (see engine/typingModes.js)
    runMode: 'seconds',    // seconds | words | endless
    runLimit: 60,
    sets: 1,
    description: '',
    ...partial,
  };
}

export function makePlan(name, steps) {
  return { id: uid(), name: (name || '').trim() || 'New plan', steps: steps && steps.length ? steps : [makeStep()] };
}

// A fresh plan copied from an existing one (new ids), so the creator can start from a template.
export function duplicatePlan(plan, name) {
  return {
    id: uid(),
    name: name || `${plan?.name || 'Plan'} (copy)`,
    steps: (plan?.steps || []).map((s) => ({ ...s, id: uid() })),
  };
}

const SET_OPS = {
  double: (n) => n * 2,
  halve: (n) => Math.round(n / 2),
  inc: (n) => n + 1,
  dec: (n) => n - 1,
};

// Bulk-adjust the set count of every step. Never drops a step below 1 set.
export function applySetOp(plan, op) {
  const fn = SET_OPS[op];
  if (!fn || !plan) return plan;
  return { ...plan, steps: (plan.steps || []).map((s) => ({ ...s, sets: Math.max(1, fn(s.sets || 1)) })) };
}

// Total sets across the plan — for progress display.
export function totalSets(plan) {
  return (plan?.steps || []).reduce((a, s) => a + Math.max(1, s.sets || 1), 0);
}
