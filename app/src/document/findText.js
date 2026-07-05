// Text search over a reader document, with the per-hit metadata the Find dialog (and the ToC wizard's
// locate-in-text tool) show as columns: line #, word #, % through the book, containing ToC section,
// and whether it's already been read. Pure — see findText.demo.mjs.

export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a section lookup from ToC entries: the innermost entry whose start word is at or before a hit.
function sectionLookup(tocEntries) {
  const secs = [...(tocEntries || [])].filter((e) => Number.isFinite(e.wordIndex)).sort((a, b) => a.wordIndex - b.wordIndex);
  return (wi) => {
    let title = '';
    for (const e of secs) { if (e.wordIndex <= wi) title = e.title || title; else break; }
    return title;
  };
}

// Find every line whose text matches `query`. `readFrontier` is the furthest-read word index (a hit
// before it is "already read"). `tocEntries` gives the containing-section column. Capped at `max`.
export function findInDoc(doc, query, { caseSensitive = false, tocEntries = [], readFrontier = 0, max = 1000 } = {}) {
  const q = (query || '').trim();
  if (!q || !doc?.lines) return [];
  let re;
  try { re = new RegExp(escapeRe(q), caseSensitive ? 'g' : 'gi'); } catch { return []; }
  const total = doc.words.length || 1;
  const sectionFor = sectionLookup(tocEntries);
  const out = [];
  for (let li = 0; li < doc.lines.length; li++) {
    const ln = doc.lines[li];
    const txt = ln?.text || '';
    re.lastIndex = 0;
    if (!re.test(txt)) continue;
    const wi = ln.startWordIndex;
    out.push({
      seq: out.length + 1,
      lineIndex: li,
      wordIndex: wi,
      pct: wi >= 0 ? (wi / total) * 100 : 0,
      section: wi >= 0 ? sectionFor(wi) : '',
      read: wi >= 0 && wi < readFrontier,
      text: txt,
    });
    if (out.length >= max) break;
  }
  return out;
}

// A window of lines around `lineIndex` (for the inline context peek). `match` flags the hit line.
export function contextLines(doc, lineIndex, radius = 3) {
  const out = [];
  const lo = Math.max(0, lineIndex - radius);
  const hi = Math.min(doc.lines.length - 1, lineIndex + radius);
  for (let li = lo; li <= hi; li++) {
    out.push({ lineIndex: li, text: doc.lines[li]?.text || '', match: li === lineIndex });
  }
  return out;
}
