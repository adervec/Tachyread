// Table-of-contents helpers shared by the TOC pane and the current-chapter heading.

const HEAD_RX = /^\s*(chapter|part|book|volume|section|prologue|epilogue|appendix|introduction)\b/i;

// Heuristic auto-detection: short lines that look like headings → [{ wordIndex, title }].
export function autoDetectToc(doc) {
  const entries = [];
  for (let li = 0; li < doc.lines.length; li++) {
    const line = doc.lines[li];
    if (line.isEmpty || line.startWordIndex < 0) continue;
    const text = line.text.trim();
    if (!text || text.length > 80) continue;
    const wc = text.split(/\s+/).length;
    if (wc > 8) continue;
    const looksHead = HEAD_RX.test(text) || /^[A-Z0-9][A-Za-z0-9 ,'’\-:&]{1,60}$/.test(text);
    if (!looksHead) continue;
    entries.push({ wordIndex: line.startWordIndex, title: text });
  }
  return entries.slice(0, 400);
}

// Stored custom entries take precedence over auto-detection; always returned sorted.
export function getTocEntries(tab) {
  const stored = tab.settings.tocEntries;
  const list = stored && stored.length ? stored : autoDetectToc(tab.doc);
  return [...list].sort((a, b) => a.wordIndex - b.wordIndex);
}

// Which chapter the current word falls in + progress within it.
export function currentChapter(entries, wordIndex, totalWords) {
  if (!entries.length) return null;
  let i = -1;
  for (let k = 0; k < entries.length; k++) {
    if (entries[k].wordIndex <= wordIndex) i = k;
    else break;
  }
  if (i < 0) {
    // before the first heading
    const end = entries[0].wordIndex || totalWords;
    return { index: -1, title: '(front matter)', start: 0, end, progress: end ? wordIndex / end : 0, count: entries.length };
  }
  const start = entries[i].wordIndex;
  const end = i + 1 < entries.length ? entries[i + 1].wordIndex : totalWords;
  const span = Math.max(1, end - start);
  return {
    index: i,
    title: entries[i].title,
    start,
    end,
    progress: Math.max(0, Math.min(1, (wordIndex - start) / span)),
    count: entries.length,
  };
}
