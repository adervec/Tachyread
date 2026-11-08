// Pocket listening — the pure planning behind it: which chunks of which queued books come next from
// the current reading positions (a rolling window of N hours of audio under a byte cap), which
// stored clips are behind the position (heard, so they can go), and what the cloud copy must gain
// or lose. Tested in listenWindow.test.mjs; the I/O (rendering, Drive / folder files) is listenCloud.js.

const NARRATION_WPM = 150; // for chunks that have no clip yet
export const estMs = (words, wpm = NARRATION_WPM) => Math.round((words / wpm) * 60000);
export const estBytes = (ms) => Math.round(ms * 3); // 24 kbps Opus ≈ 3 bytes per millisecond

// books: ordered [{ cs, fileName, wordIndex, chunks: [{ startLine, endLine, startWordIndex, endWordIndex }],
//   clips: { [startLine]: { ms, bytes } } }]
// → entries [{ cs, fileName, startLine, endLine, startWordIndex, endWordIndex, ms, bytes, hasClip }]
//   from each book's current chunk onward, book after book, until `hours` of audio or `capBytes`.
export function planWindow(books, { hours = 20, capBytes = Infinity } = {}) {
  const out = [];
  const limit = hours * 3600e3;
  let ms = 0, bytes = 0;
  for (const b of books || []) {
    for (const c of b.chunks || []) {
      if (c.endWordIndex < (b.wordIndex || 0)) continue; // heard
      const clip = b.clips?.[c.startLine];
      const cms = clip?.ms || estMs(c.endWordIndex - c.startWordIndex + 1);
      const cb = clip?.bytes || estBytes(cms);
      if (ms >= limit || bytes + cb > capBytes) return out;
      out.push({ cs: b.cs, fileName: b.fileName, startLine: c.startLine, endLine: c.endLine, startWordIndex: c.startWordIndex, endWordIndex: c.endWordIndex, ms: cms, bytes: cb, hasClip: !!clip });
      ms += cms; bytes += cb;
    }
  }
  return out;
}

// Start lines of the chunks entirely behind the reading position.
export const behind = (chunks, wordIndex) => (chunks || []).filter((c) => c.endWordIndex < wordIndex).map((c) => c.startLine);

// Cloud reconciliation. cloud: { [cs]: { chunks: { [startLine]: { id, … } } } }
// → upload: window entries that have a clip but no cloud copy; remove: cloud chunks outside the window.
export function cloudDiff(entries, cloud) {
  const want = new Set(entries.map((e) => `${e.cs}/${e.startLine}`));
  const upload = entries.filter((e) => e.hasClip && !cloud?.[e.cs]?.chunks?.[e.startLine]);
  const remove = [];
  for (const [cs, b] of Object.entries(cloud || {})) {
    for (const [line, c] of Object.entries(b.chunks || {})) if (!want.has(`${cs}/${line}`)) remove.push({ cs, startLine: +line, ...c });
  }
  return { upload, remove };
}
