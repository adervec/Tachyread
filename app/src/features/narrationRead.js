// Narrating a chunk aloud means you read it: a saved take credits the chunk's words as read (tagged
// "speaking", with active time at the take's pace) in the book's normal reading tracker — so % read,
// history, Trackyread coverage and stats all count it. And the reverse: which chunks you had already
// read as text (familiar enough to narrate well), for a subtle mark in the Audiobook Manager.
import { createReadingTracker, READ_SRC } from '../engine/readingTracker.js';
import { loadReadState, saveReadState, loadFile, saveFile } from '../state/storage.js';

// A chunk's word span [from, to) in the document.
export function chunkRange(doc, chunk) {
  let from = -1, to = -1;
  for (let li = chunk.startLine; li <= chunk.endLine; li++) {
    const l = doc.lines[li];
    if (!l || l.startWordIndex < 0) continue;
    if (from < 0) from = l.startWordIndex;
    to = l.endWordIndex + 1;
  }
  return from < 0 ? [0, 0] : [from, to];
}

// Share of a chunk's words read as TEXT (any way but speaking it aloud) — 0..1.
export function textReadShare(tracker, [from, to]) {
  if (!tracker || to <= from) return 0;
  let n = 0;
  for (let i = from; i < to; i++) if (tracker.isRead(i) && tracker.srcAt(i) !== READ_SRC.speak) n++;
  return n / (to - from);
}

// The book's tracker: the open tab's live one, else rebuilt from saved reading state.
export async function bookTracker(doc, tabs = []) {
  const cs = doc.contentChecksum;
  const open = tabs.find((t) => !t.lazy && t.doc?.contentChecksum === cs && t.tracker);
  if (open) return { tracker: open.tracker, live: true };
  const st = await loadReadState(cs).catch(() => null);
  return { tracker: createReadingTracker({ wordCount: doc.words.length, ...(st || {}) }), live: false };
}

// Credit one saved narration take as reading. Open tab: its tracker is marked and the app's save
// loop persists it. Closed book: the reading state and the file's counters are written here.
export async function creditNarration({ doc, chunk, wpm, tabs = [], incognito = false }) {
  if (incognito || !doc) return 0;
  const [from, to] = chunkRange(doc, chunk);
  const { tracker, live } = await bookTracker(doc, tabs);
  const { added } = tracker.markRangeReadAtPace(from, to, wpm || 150, 'speak');
  if (live || !added) return added;
  const cs = doc.contentChecksum;
  await saveReadState(cs, {
    maskB64: tracker.serializeMask(), wpmB64: tracker.serializeWpm(), srcB64: tracker.serializeSrc(),
    lifetimeActiveMs: tracker.lifetimeActiveMs, daily: tracker.dailyArray(), paraTsB64: tracker.serializeParaTs(),
  });
  const rec = await loadFile(cs).catch(() => null);
  if (rec) {
    await saveFile({
      ...rec,
      persistentWordsRead: tracker.readCount,
      persistentPacedWords: tracker.pacedCount,
      persistentActiveTimeSecs: Math.round(tracker.lifetimeActiveMs / 1000),
      dailyHistory: tracker.dailyHistory(),
    });
  }
  return added;
}
