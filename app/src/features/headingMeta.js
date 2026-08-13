// Rich section headers for the Lines pane. A ToC entry on its own says only "a section starts
// here"; what a reader actually wants to know at that moment is how long it is, where it sits in
// the structure, and how much of it they've already done. This derives all of that from the ToC
// entry list, so it works for auto-detected and hand-edited contents alike.
//
// Pure: entries in, facts out. The renderer picks which facts to show.

// [id, label] — the chooser's order is the order details render in.
export const HEADING_DETAIL_ITEMS = [
  ['words', '🔢 Word count'],
  ['time', '⏱ Reading time'],
  ['pct', '💯 Share of book'],
  ['progress', '✅ Your progress'],
  ['parent', '⬆️ Parent section'],
  ['children', '🌿 Sub-sections'],
  ['position', '📍 Position among siblings'],
  ['depth', '🪜 Depth'],
];

const clampLevel = (n) => Math.max(0, Number.isFinite(n) ? n : 0);

// One record per ToC entry, with structure resolved. `entries` must be sorted by wordIndex —
// getTocEntries already guarantees that.
export function buildHeadingMeta(entries, totalWords = 0) {
  const list = (entries || []).map((e) => ({ ...e, level: clampLevel(e.level) }));
  const total = Math.max(0, totalWords);
  return list.map((e, i) => {
    // A section runs until the next heading at the SAME level or shallower — a deeper heading is
    // inside it, not after it. (Using "the next heading" outright would make every parent section
    // look one subsection long.)
    let end = total;
    for (let j = i + 1; j < list.length; j++) {
      if (list[j].level <= e.level) { end = list[j].wordIndex; break; }
      if (j === list.length - 1) end = total;
    }
    const start = e.wordIndex;
    // Nearest preceding heading that is strictly shallower.
    let parent = null;
    for (let j = i - 1; j >= 0; j--) {
      if (list[j].level < e.level) { parent = list[j]; break; }
    }
    // Direct children only: one level deeper, inside this section.
    const children = list.filter((c, j) => j > i && c.wordIndex < end && c.level === e.level + 1);
    // Siblings share this parent and level.
    const siblings = list.filter((s) => {
      if (s.level !== e.level) return false;
      const idx = list.indexOf(s);
      let p = null;
      for (let j = idx - 1; j >= 0; j--) if (list[j].level < s.level) { p = list[j]; break; }
      return p === parent;
    });
    return {
      title: e.title || '',
      level: e.level,
      start,
      end: Math.max(start, end),
      words: Math.max(0, Math.max(start, end) - start),
      pctOfBook: total > 0 ? ((Math.max(start, end) - start) / total) * 100 : 0,
      parentTitle: parent?.title || null,
      childCount: children.length,
      siblingIndex: Math.max(0, siblings.indexOf(e)) + 1,
      siblingCount: siblings.length || 1,
      depth: e.level + 1,
    };
  });
}

const fmtMin = (mins) => {
  if (!(mins > 0)) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${Math.round(mins % 60)}m`;
};
const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// The chips to render under a heading, in catalog order. `readerIdx` drives the progress chip.
export function headingDetailChips(meta, ids, { wpm = 250, readerIdx = 0 } = {}) {
  if (!meta || !ids?.length) return [];
  const want = new Set(ids);
  const out = [];
  for (const [id] of HEADING_DETAIL_ITEMS) {
    if (!want.has(id)) continue;
    switch (id) {
      case 'words':
        if (meta.words > 0) out.push({ id, text: `🔢 ${compact(meta.words)} words` });
        break;
      case 'time':
        if (meta.words > 0 && wpm > 0) out.push({ id, text: `⏱ ${fmtMin(meta.words / wpm)}` });
        break;
      case 'pct':
        if (meta.pctOfBook > 0) out.push({ id, text: `💯 ${meta.pctOfBook.toFixed(1)}% of book` });
        break;
      case 'progress': {
        if (meta.words <= 0) break;
        const done = Math.max(0, Math.min(meta.words, readerIdx - meta.start));
        const pct = Math.round((done / meta.words) * 100);
        // Only worth saying once you're in or past it — "0%" on every section ahead is noise.
        if (readerIdx >= meta.start) out.push({ id, text: pct >= 100 ? '✅ read' : `✅ ${pct}% read` });
        break;
      }
      case 'parent':
        if (meta.parentTitle) out.push({ id, text: `⬆️ ${meta.parentTitle}` });
        break;
      case 'children':
        if (meta.childCount > 0) out.push({ id, text: `🌿 ${meta.childCount} sub-section${meta.childCount === 1 ? '' : 's'}` });
        break;
      case 'position':
        if (meta.siblingCount > 1) out.push({ id, text: `📍 ${meta.siblingIndex} of ${meta.siblingCount}` });
        break;
      case 'depth':
        out.push({ id, text: `🪜 level ${meta.depth}` });
        break;
      default: break;
    }
  }
  return out;
}
