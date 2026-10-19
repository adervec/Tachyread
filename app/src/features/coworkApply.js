// Cowork I/O shared by the Cowork page and the scheduler: write the read-only activity snapshot into
// the folder, commit an approved set of review rows (with an undo snapshot + log entry), and undo
// the last commit. The decisions are pure (coworkOps.js / coworkSnapshot.js); this only does I/O.
import {
  allFiles, getLibraryBooks, getBinding, getLibraryRef, allTypingRuns, getSpeechLog, allFocusSessions,
  allAudiobookManifests, getLibraryBook, saveLibraryBook, saveLibraryRef, addCrossNotes, getCrossNotes, deleteCrossNote, setBinding, saveJourneyAi,
} from '../state/storage.js';
import { buildSnapshot } from './coworkSnapshot.js';
import { buildApply, applySummary } from './coworkOps.js';
import { setQueueIds } from './readingQueues.js';

async function writeFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
}

// Gather everything and write snapshot/* into the cowork folder. Returns the file count.
export async function writeSnapshot(dir, now = Date.now()) {
  const [files, books, bindMap, queues, goals, typingRuns, speechLog, focusSessions, manifests] = await Promise.all([
    allFiles().catch(() => []), getLibraryBooks().catch(() => []), getBinding().catch(() => ({})),
    getLibraryRef('queues').catch(() => []), getLibraryRef('goals').catch(() => ({})),
    allTypingRuns().catch(() => []), getSpeechLog().catch(() => []), allFocusSessions().catch(() => []), allAudiobookManifests().catch(() => []),
  ]);
  const out = buildSnapshot({ files, books, bindMap, queues: queues || [], goals: goals || {}, typingRuns, speechLog, focusSessions, manifests, now });
  const sub = await dir.getDirectoryHandle('snapshot', { create: true });
  for (const [name, text] of Object.entries(out)) await writeFile(sub, name, text);
  return Object.keys(out).length;
}

// Apply the ticked rows. `ai` is the current AI record; returns the next one (already saved).
// The undo snapshot (books as they were, new links, added shared notes, AI fields as they were) is
// kept as ai.lastApply; every commit is logged in ai.applyLog.
export async function commitRows(rows, { books, ai, ops = [], source = '', auto = false, now = Date.now() }) {
  const booksById = Object.fromEntries((books || []).map((b) => [b.id, b]));
  const { bookUpdates, crossNoteAdds, bindingAdds, queueOrders, aiNext, undo } = buildApply(rows, { booksById, ai, now });
  if (queueOrders.length) {
    const before = (await getLibraryRef('queues').catch(() => null)) || [];
    undo.queues = before; // the whole array as it was — undo puts it back
    await saveLibraryRef('queues', queueOrders.reduce((qs, qo) => setQueueIds(qs, qo.queueId, qo.ids), before));
  }
  for (const b of bookUpdates) await saveLibraryBook(b);
  if (crossNoteAdds.length) await addCrossNotes(crossNoteAdds);
  for (const l of bindingAdds) await setBinding(l.checksum, l.bookId);
  const summary = applySummary(rows);
  const next = {
    ...aiNext,
    lastApply: { ...undo, ops, source, summary },
    applyLog: [{ at: now, ops, source, summary, auto, n: rows.length }, ...(ai?.applyLog || [])].slice(0, 100),
  };
  await saveJourneyAi(next);
  return { ai: next, summary };
}

// Put back everything the last commit changed. A book edited AFTER the commit is left alone (undoing
// it would throw your later edit away) and counted in the summary.
export async function undoLastApply(ai) {
  const u = ai?.lastApply;
  if (!u) return { ai, summary: 'nothing to undo' };
  let kept = 0;
  for (const b of u.books || []) {
    const cur = await getLibraryBook(b.id).catch(() => null);
    if (cur && (cur.updatedAt || 0) > (u.at || 0) + 60000) { kept++; continue; }
    await saveLibraryBook(b);
  }
  for (const cs of u.links || []) await setBinding(cs, null);
  if (u.queues) await saveLibraryRef('queues', u.queues);
  if (u.crossTexts?.length) {
    const texts = new Set(u.crossTexts);
    for (const n of await getCrossNotes()) if (n.source === 'ai' && texts.has(n.text)) await deleteCrossNote(n.id);
  }
  const next = { ...ai };
  for (const [k, v] of Object.entries(u.ai || {})) { if (v === null) delete next[k]; else next[k] = v; }
  delete next.lastApply;
  next.applyLog = [{ at: Date.now(), ops: u.ops, source: 'undo', summary: `undid: ${u.summary}`, n: 0 }, ...(ai.applyLog || [])].slice(0, 100);
  await saveJourneyAi(next);
  return { ai: next, summary: `Undone — ${u.summary}${kept ? ` (${kept} book${kept === 1 ? '' : 's'} you edited since were left as they are)` : ''}` };
}
