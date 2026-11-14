// Which controls the COLLAPSED dock shows. The minimized dock is the bar you live with while
// reading, and what belongs on it is personal: some readers page with it, some only want play and
// a word count. Catalog + fold, mirroring the STATS_CHIP_ITEMS / focusWidgets idiom.
import { t } from '../i18n.js';

// [id, label, defaultOn] — order here is the order on the bar.
export const DOCK_MINI_ITEMS = [
  ['play', t('▶️ Play / pause'), true],
  ['pageUp', t('⏫ Page up'), true],
  ['prevLine', t('⬆️ Previous line'), true],
  ['nextLine', t('⬇️ Next line'), true],
  ['pageDown', t('⏬ Page down'), true],
  ['prevWord', t('⬅️ Previous word'), false],
  ['nextWord', t('➡️ Next word'), false],
  ['prevPara', t('🔼 Previous paragraph'), false],
  ['nextPara', t('🔽 Next paragraph'), false],
  ['restart', t('⏮️ Restart'), false],
  ['sourcePage', t('📄 Source page back / forward'), true],
  ['jump', t('📍 Jump to current word'), true],
  // Toggles and shortcuts. All off by default — a saved bar shouldn't grow buttons on upgrade.
  ['scroll', t('📜 Scroll-to-read on / off'), false],
  ['readAloud', t('🔊 Read aloud on / off'), false],
  ['focus', t('🖥️ Focus mode on / off'), false],
  ['toc', t('📑 Contents pane on / off'), false],
  ['wpm', t('🐢🐇 Speed down / up'), false],
  ['find', t('🔍 Find'), false],
  // Readouts — these sit at the right end of the bar.
  ['counter', t('🔢 Word counter'), true],
  ['pct', t('📊 Percent complete'), false],
  ['eta', t('⏳ Time left at this speed'), false],
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
