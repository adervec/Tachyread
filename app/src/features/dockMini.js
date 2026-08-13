// Which controls the COLLAPSED dock shows. The minimized dock is the bar you live with while
// reading, and what belongs on it is personal: some readers page with it, some only want play and
// a word count. Catalog + fold, mirroring the STATS_CHIP_ITEMS / focusWidgets idiom.

// [id, label, defaultOn] — order here is the order on the bar.
export const DOCK_MINI_ITEMS = [
  ['play', '▶️ Play / pause', true],
  ['pageUp', '⏫ Page up', true],
  ['prevLine', '⬆️ Previous line', true],
  ['nextLine', '⬇️ Next line', true],
  ['pageDown', '⏬ Page down', true],
  ['prevWord', '⬅️ Previous word', false],
  ['nextWord', '➡️ Next word', false],
  ['prevPara', '🔼 Previous paragraph', false],
  ['nextPara', '🔽 Next paragraph', false],
  ['restart', '⏮️ Restart', false],
  ['sourcePage', '📄 Source page back / forward', true],
  ['jump', '📍 Jump to current word', true],
  ['counter', '🔢 Word counter', true],
];

const DEFAULTS = Object.fromEntries(DOCK_MINI_ITEMS.map(([id, , on]) => [id, on]));

// Stored value is a sparse { id: bool } map, so a newly-added control appears at its own default
// instead of silently staying hidden for anyone with a saved setup.
export function dockMiniShow(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = {};
  for (const [id] of DOCK_MINI_ITEMS) out[id] = typeof s[id] === 'boolean' ? s[id] : DEFAULTS[id];
  return out;
}

// Ordered ids to render. `sourceAvailable` gates the source-page pair — those buttons are
// meaningless without a scanned/PDF source, whatever the preference says.
export function dockMiniIds(stored, { sourceAvailable = false } = {}) {
  const show = dockMiniShow(stored);
  return DOCK_MINI_ITEMS
    .map(([id]) => id)
    .filter((id) => show[id] && (id !== 'sourcePage' || sourceAvailable));
}
