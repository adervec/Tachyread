// You are never in ONE section. Reading a paragraph of "Section 2.1" also puts you inside
// "Chapter 2" and inside "Part I", each a different distance from its end. The heading bar showed
// only the innermost, which is the least informative of the three — it says nothing about how much
// of the chapter or the part is left.
//
// This resolves the whole ancestor chain at a position; the bar's display mode decides how many of
// them to draw. Pure — entries in, chain out.
import { buildHeadingMeta } from './headingMeta.js';

export const SECTION_BAR_MODES = [
  ['single', '▬ Single — innermost section only'],
  ['parallel', '≡ Parallel — one bar per level, stacked'],
  ['nested', '⧉ Nested — outer sections behind the inner one'],
  ['cycle', '🔄 Cycling — one bar, rotating through the levels'],
];
export const DEFAULT_SECTION_BAR_MODE = 'single';

// Every section containing `idx`, OUTERMOST first. A section contains idx when idx is inside
// [start, end) — extents come from headingMeta, so a part spans its whole run of chapters rather
// than stopping at the first one.
export function sectionChain(entries, idx, totalWords) {
  const metas = buildHeadingMeta(entries, totalWords);
  const chain = metas.filter((m) => idx >= m.start && idx < m.end && m.words > 0);
  // Guard against a malformed ToC (overlapping/duplicate levels) producing two "level 1" bars:
  // keep the LAST section seen at each depth, which is the one actually containing the position.
  const byLevel = new Map();
  for (const m of chain) byLevel.set(m.level, m);
  return [...byLevel.values()].sort((a, b) => a.level - b.level).map((m) => ({
    ...m,
    progress: Math.max(0, Math.min(1, (idx - m.start) / Math.max(1, m.words))),
    remaining: Math.max(0, m.end - idx),
  }));
}

// Which bars to draw, for a mode. `tick` drives cycling (any monotonically increasing integer).
// Always returns at least the innermost section when there is one, so the bar never goes blank.
export function barsForMode(chain, mode = DEFAULT_SECTION_BAR_MODE, tick = 0) {
  if (!chain?.length) return [];
  const innermost = chain[chain.length - 1];
  switch (mode) {
    case 'parallel':
    case 'nested':
      return chain;
    case 'cycle': {
      const i = ((Math.floor(tick) % chain.length) + chain.length) % chain.length;
      return [chain[i]];
    }
    case 'single':
    default:
      return [innermost];
  }
}
