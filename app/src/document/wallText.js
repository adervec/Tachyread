// "Wall of text" mode: merge the source lines into flowing blocks so the Lines pane reads as solid
// prose instead of one row per source line. Line breaks within a block become spaces; a paragraph
// break (blank source line) becomes a TAB (an inline indent, via white-space: pre-wrap). A new block
// starts only at a heading, at a percent boundary, or every `breakEvery` source lines (0 = off). The
// result is a doc-shaped { lines, wordToLine } fed straight to the existing renderer — each merged
// line spans a contiguous word range, so current-word highlighting and jumps keep working. Pure; see
// wallText.demo.mjs.

// headLevels: Map(sourceLineIndex → tier) for the lines that are ToC headings (each gets its own
// block). breakEvery: 0 = only headings/percent; >0 = also every N source lines. pctEvery: 0 = off;
// >0 = also break when the block's first word crosses another 1/pctEvery slice of the document.
export function buildWallDoc(doc, headLevels, { breakEvery = 0, pctEvery = 0 } = {}) {
  const src = doc.lines || [];
  const totalWords = doc.words?.length || 0;
  const merged = [];
  const wordToLine = new Array(totalWords).fill(0);
  const headingLevels = new Map(); // merged index → tier
  let cur = null, srcSinceBreak = 0, curSlice = -1;

  const flush = () => {
    if (!cur) return;
    if (cur.startWordIndex >= 0) {
      const mi = merged.length;
      merged.push(cur);
      for (let w = cur.startWordIndex; w <= cur.endWordIndex && w < totalWords; w++) wordToLine[w] = mi;
    }
    cur = null; srcSinceBreak = 0;
  };

  for (let i = 0; i < src.length; i++) {
    const ln = src[i];
    if (headLevels && headLevels.has(i)) { // headings stand alone
      flush();
      const mi = merged.length;
      merged.push({ lineNumber: ln.lineNumber, text: ln.text, startWordIndex: ln.startWordIndex, endWordIndex: ln.endWordIndex, isEmpty: !!ln.isEmpty, srcStart: i, srcEnd: i });
      headingLevels.set(mi, headLevels.get(i));
      for (let w = Math.max(0, ln.startWordIndex); w <= ln.endWordIndex && w < totalWords; w++) wordToLine[w] = mi;
      curSlice = pctEvery && totalWords ? Math.floor((Math.max(0, ln.startWordIndex) / totalWords) * pctEvery) : -1;
      continue;
    }
    // Percent boundary: break when a real line's first word enters a new slice.
    if (pctEvery && totalWords && !ln.isEmpty && ln.startWordIndex >= 0) {
      const slice = Math.floor((ln.startWordIndex / totalWords) * pctEvery);
      if (curSlice >= 0 && slice !== curSlice) flush();
      curSlice = slice;
    }
    if (breakEvery > 0 && srcSinceBreak >= breakEvery) flush();
    if (!cur) cur = { lineNumber: ln.lineNumber, text: '', startWordIndex: -1, endWordIndex: -1, isEmpty: false, srcStart: i, srcEnd: i };
    if (ln.isEmpty) {
      if (cur.text) cur.text += '\t'; // paragraph break → an indent tab (only between text)
    } else {
      cur.text += (cur.text && !cur.text.endsWith('\t') ? ' ' : '') + ln.text;
      if (cur.startWordIndex < 0) cur.startWordIndex = ln.startWordIndex;
      cur.endWordIndex = ln.endWordIndex;
    }
    cur.srcEnd = i;
    srcSinceBreak++;
  }
  flush();
  if (!merged.length) merged.push({ lineNumber: 1, text: '', startWordIndex: -1, endWordIndex: -1, isEmpty: true, srcStart: 0, srcEnd: 0 });
  return { ...doc, lines: merged, wordToLine, headingLevels };
}
