// Focus panels: the catalog of reading widgets that can be shown on the OTHER-monitor cover windows
// during Focus mode, and the ordered-list helpers that drive both the config UI (labels + order) and
// the cover renderer (the ordered ids to render). Kept free of JSX so it runs under `node` for tests.
//
// Unlike the stats-chip picker (a keyed object, no order), this is an ordered array so the user can
// REORDER widgets. Stored in global.focusPanels as [{id, on}]; [] means "use the catalog defaults".

// [id, label, defaultOn]. Order here is the initial/default order.
export const FOCUS_WIDGET_ITEMS = [
  ['faces', 'Reader faces', true],
  ['nowWpm', 'Reading now (WPM)', true],
  ['coverage', 'Book read % + active time', true],
  ['eta', 'Time to finish (measured pace)', true],
  ['goal', 'Goal progress', true],
  ['position', 'Word / line position', false],
  ['sessionWpm', 'Session efficiency (WPM)', false],
  ['lifetimeWpm', 'Lifetime WPM', false],
  ['spark', 'WPM sparkline', false],
  ['trendline', 'Pace trendline', false],
  ['mode', 'Reading-mode indicator', false],
  ['clock', 'Clock', false],
  ['pct', 'Position %', false],
];

const CATALOG_IDS = FOCUS_WIDGET_ITEMS.map((w) => w[0]);
const DEFAULT_ON = Object.fromEntries(FOCUS_WIDGET_ITEMS.map((w) => [w[0], w[2]]));
export const FOCUS_WIDGET_LABEL = Object.fromEntries(FOCUS_WIDGET_ITEMS.map((w) => [w[0], w[1]]));

// Fold the catalog into a stored list → an ordered [{id, on}] covering exactly the known widgets:
// keep the user's known entries in their saved order (respecting their on-flags), append any
// catalog ids the user hasn't seen yet (at the end, with their default), and drop unknown/stale ids.
export function focusPanelList(stored) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(stored) ? stored : []) {
    const id = e && e.id;
    if (!id || seen.has(id) || !CATALOG_IDS.includes(id)) continue;
    seen.add(id);
    out.push({ id, on: !!e.on });
  }
  for (const id of CATALOG_IDS) if (!seen.has(id)) out.push({ id, on: DEFAULT_ON[id] });
  return out;
}

// Move the entry with id `fromId` to sit where `toId` is (array-move by id — same semantics as the
// REORDER_TABS splice). Returns a new [{id, on}] list; a no-op if either id is missing or equal.
export function reorderPanels(stored, fromId, toId) {
  const list = focusPanelList(stored);
  if (!fromId || !toId || fromId === toId) return list;
  const from = list.findIndex((e) => e.id === fromId);
  const to = list.findIndex((e) => e.id === toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// The ordered ids the cover should render right now: enabled widgets in saved order, or [] when the
// master toggle is off (plain blackout).
export function focusPanelsToShow(stored, showWidgets) {
  if (!showWidgets) return [];
  return focusPanelList(stored).filter((e) => e.on).map((e) => e.id);
}
