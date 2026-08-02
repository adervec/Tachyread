// Cowork Sync action catalog + pure helpers for the AI/Cowork page's request builder,
// per-action schedules, the sync-machine device role, and the run history (list + calendar).
// Everything here is pure and node-testable — I/O (folder writes, API calls, cloud sync) stays
// in the dialog and in coworkScheduler.js. Persisted state lives on the library `ai` record:
//   ai.actionRuns   { [actionId]: { at, ok, target, note, auto } }   — last run per action
//   ai.syncHistory  [ { at, ids, kind, target, ok, note, auto } ]    — full log (capped)
//   ai.schedules    { [actionId]: scheduleId }                       — 'off' | '30m' | … | 'weekly'
//   ai.syncMachine  { deviceId, name, at } | null                    — the designated sync device
//   ai.coworkDirPath  string                                         — user-annotated full folder path

import {
  LIGHT_INSTRUCTION, HEAVY_PLACEHOLDER, KNOWLEDGE_GRAPH_INSTRUCTION, CLASSIFY_INSTRUCTION,
} from './journeyAi.js';

// ── The action tree ─────────────────────────────────────────────────────────
// Three groups = the three transports. `needsKey` gates the whole group on an Anthropic key —
// when absent the group renders NOTHING (no wasted "add a key" note). `mode`/`text` describe the
// instruction a cowork/API action contributes; cloud actions have neither.
export const SYNC_ACTION_GROUPS = [
  {
    id: 'cowork', icon: '🤝', label: 'Cowork folder', kind: 'cowork',
    actions: [
      { id: 'cw-light', icon: '🔄', label: 'Refresh recs + analysis', desc: 'Light — compact dataset, updates recommendations, analysis and weekly summaries', mode: 'light', text: LIGHT_INSTRUCTION },
      { id: 'cw-tree', icon: '🌳', label: 'Rebuild tech tree', desc: 'Heavy — full library travels; repositions the reading tech tree', mode: 'heavy', text: HEAVY_PLACEHOLDER },
      { id: 'cw-graph', icon: '🕸', label: 'Rebuild knowledge graph', desc: 'Heavy — full library; regenerates cross-book concept edges', mode: 'heavy', text: KNOWLEDGE_GRAPH_INSTRUCTION },
      { id: 'cw-classify', icon: '🗂', label: 'Audit content types', desc: 'Heavy — fixes wrong or missing long-form/article/poetry/… classifications', mode: 'heavy', text: CLASSIFY_INSTRUCTION },
      { id: 'cw-custom', icon: '✏️', label: 'Custom instruction', desc: 'Heavy — your own task text, appended to whatever else is checked', mode: 'heavy', text: '' },
    ],
  },
  {
    id: 'api', icon: '🤖', label: 'Direct API (Anthropic)', kind: 'api', needsKey: true,
    actions: [
      { id: 'api-light', icon: '⚡', label: 'Light refresh via API', desc: 'Asks Claude directly with the compact dataset — no folder round-trip', mode: 'light', text: LIGHT_INSTRUCTION },
    ],
  },
  {
    id: 'cloud', icon: '☁️', label: 'Cloud sync', kind: 'cloud',
    actions: [
      { id: 'cloud-progress', icon: '📈', label: 'Reading progress (two-way)', desc: 'Read-merge-write of reading history, positions and markers' },
      { id: 'cloud-library', icon: '📚', label: 'Tracker library (two-way)', desc: 'Diff-aware sync of the whole Trackyread library' },
    ],
  },
];

export const SYNC_ACTIONS = SYNC_ACTION_GROUPS.flatMap((g) =>
  g.actions.map((a) => ({ ...a, group: g.id, kind: g.kind, needsKey: !!g.needsKey })));
const BY_ID = Object.fromEntries(SYNC_ACTIONS.map((a) => [a.id, a]));
export const actionById = (id) => BY_ID[id] || null;

// Combine the checked cowork actions into ONE request instruction (the protocol carries a single
// instruction). Heavy wins the mode; texts concatenate in catalog order; the custom action
// contributes the user's saved text.
export function combineCoworkInstruction(ids, customText = '') {
  const acts = SYNC_ACTIONS.filter((a) => a.kind === 'cowork' && ids.includes(a.id));
  if (!acts.length) return null;
  const mode = acts.some((a) => a.mode === 'heavy') ? 'heavy' : 'light';
  const text = acts.map((a) => (a.id === 'cw-custom' ? (customText || '').trim() : a.text))
    .filter(Boolean).join('\n\n');
  return { mode, text: text || LIGHT_INSTRUCTION };
}

// ── Schedules ───────────────────────────────────────────────────────────────
export const SCHEDULE_OPTS = [
  { id: 'off', label: 'manual', ms: 0 },
  { id: '30m', label: 'every 30 min', ms: 30 * 60e3 },
  { id: 'hourly', label: 'hourly', ms: 3600e3 },
  { id: '6h', label: 'every 6 h', ms: 6 * 3600e3 },
  { id: 'daily', label: 'daily', ms: 24 * 3600e3 },
  { id: 'weekly', label: 'weekly', ms: 7 * 24 * 3600e3 },
];
const SCHED_MS = Object.fromEntries(SCHEDULE_OPTS.map((o) => [o.id, o.ms]));

// When is an action next due? null = never (manual). A never-run scheduled action is due at once.
export function nextDueAt(scheduleId, lastAt = 0) {
  const ms = SCHED_MS[scheduleId] || 0;
  if (!ms) return null;
  return (lastAt || 0) + ms;
}

// Ids due now, in catalog order (stable execution order for the scheduler).
export function dueActions(schedules = {}, actionRuns = {}, now = 0) {
  return SYNC_ACTIONS.filter((a) => {
    const due = nextDueAt(schedules[a.id], actionRuns[a.id]?.at || 0);
    return due != null && now >= due;
  }).map((a) => a.id);
}

// ── Device role ─────────────────────────────────────────────────────────────
// 'open'   — nobody designated: every device gets full controls (legacy behaviour)
// 'machine'— this device is the designated sync machine (runs requests + schedules)
// 'viewer' — another device is: this one only views status/history
export function syncRole(ai, deviceId) {
  const m = ai?.syncMachine;
  if (!m?.deviceId) return { role: 'open', machine: null };
  return { role: m.deviceId === deviceId ? 'machine' : 'viewer', machine: m };
}

// ── Run recording + history shaping ─────────────────────────────────────────
export const HISTORY_CAP = 300;

export function recordRun(ai, ids, { at, kind, target = '', ok = true, note = '', auto = false }) {
  const actionRuns = { ...(ai?.actionRuns || {}) };
  for (const id of ids) actionRuns[id] = { at, ok, target, note, auto };
  const entry = { at, ids: [...ids], kind, target, ok, note, auto };
  return {
    ...(ai || {}),
    actionRuns,
    syncHistory: [...(ai?.syncHistory || []), entry].slice(-HISTORY_CAP),
  };
}

// Rich history + the legacy activity feed folded into one newest-first list.
export function mergedHistory(ai) {
  const rich = ai?.syncHistory || [];
  const legacy = (ai?.activity || []).map((a) => ({
    at: a.at, ids: [], kind: a.kind || 'other', target: '', ok: true, note: a.text, auto: false, legacy: true,
  }));
  return [...rich, ...legacy].sort((a, b) => b.at - a.at);
}

const pad2 = (n) => String(n).padStart(2, '0');
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Calendar month grid (Monday-first). Cells: { key, day, inMonth, count, errs }.
export function calendarCells(year, month /* 0-based */, history = []) {
  const counts = new Map();
  for (const h of history) {
    const k = dayKey(h.at);
    const c = counts.get(k) || { count: 0, errs: 0 };
    c.count += 1; if (!h.ok) c.errs += 1;
    counts.set(k, c);
  }
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first offset
  const start = new Date(year, month, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(d.getTime());
    const c = counts.get(key) || { count: 0, errs: 0 };
    cells.push({ key, day: d.getDate(), inMonth: d.getMonth() === month, count: c.count, errs: c.errs });
  }
  return cells;
}

// Compact "3h ago" formatting for the per-action last-run captions.
export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
