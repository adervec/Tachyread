// Cowork I/O shared by the Cowork page and the scheduler: write the read-only activity snapshot into
// the folder, commit an approved set of review rows (with an undo snapshot + log entry), and undo
// the last commit. The decisions are pure (coworkOps.js / coworkSnapshot.js); this only does I/O.
import {
  allFiles, getLibraryBooks, getBinding, getLibraryRef, allTypingRuns, getSpeechLog, allFocusSessions,
  allAudiobookManifests, getLibraryBook, saveLibraryBook, saveLibraryRef, deleteLibraryBook, addCrossNotes, getCrossNotes, deleteCrossNote, setBinding, saveJourneyAi,
} from '../state/storage.js';
import { buildSnapshot, diffSnapshots, changesMarkdown } from './coworkSnapshot.js';
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
  // What changed since the previous snapshot — read it back BEFORE overwriting.
  const prevText = async (n) => { try { return await (await (await sub.getFileHandle(n)).getFile()).text(); } catch { return null; } };
  const [pb, pq, pm] = await Promise.all([prevText('books.json'), prevText('queues.json'), prevText('meta.json')]);
  let prev = null;
  try { if (pb) prev = { books: JSON.parse(pb), queues: pq ? JSON.parse(pq) : [], at: pm ? JSON.parse(pm).generatedAt : null }; } catch { prev = null; }
  const changes = prev ? diffSnapshots(prev, { books: JSON.parse(out['books.json']), queues: JSON.parse(out['queues.json']) }) : [];
  const nowIso = new Date(now).toISOString();
  out['changes.json'] = JSON.stringify({ since: prev?.at || null, until: nowIso, changes }, null, 1);
  out['changes.md'] = changesMarkdown(changes, prev?.at || null, nowIso);
  for (const [name, text] of Object.entries(out)) await writeFile(sub, name, text);
  await writeFile(await dir.getDirectoryHandle('inbox', { create: true }), 'README.md', INBOX_README);
  return Object.keys(out).length;
}

// ── Agent inbox ──────────────────────────────────────────────────────────────────────────────────
// An agent may drop a suggestion file into inbox/ at any time (no request needed). The app lists
// them on the Cowork page; reviewing one runs it through the SAME permission filter (the ops it
// declares) and review table — nothing is applied without you. Afterwards the file moves to
// inbox/processed/ (or inbox/rejected/ when unusable).
export const INBOX_README = `# Tachyread agent inbox

Drop a JSON file here (any name ending in .json) to suggest changes without waiting for a request.
Nothing is applied automatically: the user reviews every file on the Cowork page, row by row.

Format: { "ops": ["<operation id>", …], …reply fields for those operations… }
The reply fields are exactly those of a normal cowork reply (see journey-instructions.md / the
operation's reply schema). Anything the declared operations may not change is discarded.
Operation ids: cw-brief, cw-weeklies, cw-light, cw-retro, cw-typing-coach, cw-speak-coach, cw-ask,
cw-fill-genre, cw-fill-desc, cw-fill-type, cw-fill-diff, cw-rescore, cw-links, cw-notes, cw-classify,
cw-queue-advice, cw-dupes, cw-add-recs, cw-tree, cw-graph.
Reviewed files move to inbox/processed/ (or inbox/rejected/ if unreadable).
`;
export async function listInbox(dir) {
  try {
    const box = await dir.getDirectoryHandle('inbox', { create: true });
    const names = [];
    for await (const [n, h] of box.entries()) if (h.kind === 'file' && /\.json$/i.test(n)) names.push(n);
    return names.sort();
  } catch { return []; }
}
export async function readInbox(dir, name) {
  const box = await dir.getDirectoryHandle('inbox');
  return (await (await box.getFileHandle(name)).getFile()).text();
}
export async function moveInbox(dir, name, to = 'processed') {
  const box = await dir.getDirectoryHandle('inbox');
  const text = await (await (await box.getFileHandle(name)).getFile()).text();
  const dest = await box.getDirectoryHandle(to, { create: true });
  await writeFile(dest, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`, text);
  await box.removeEntry(name);
}

// Apply the ticked rows. `ai` is the current AI record; returns the next one (already saved).
// The undo snapshot (books as they were, new links, added shared notes, AI fields as they were) is
// kept as ai.lastApply; every commit is logged in ai.applyLog.
export async function commitRows(rows, { books, ai, ops = [], source = '', auto = false, now = Date.now() }) {
  const booksById = Object.fromEntries((books || []).map((b) => [b.id, b]));
  const { bookUpdates, crossNoteAdds, bindingAdds, queueOrders, aiNext, undo } = buildApply(rows, { booksById, ai, now, source: ops.join(',') || source });
  if (queueOrders.length) {
    const before = (await getLibraryRef('queues').catch(() => null)) || [];
    undo.queues = before; // the whole array as it was — undo puts it back
    await saveLibraryRef('queues', queueOrders.reduce((qs, qo) => setQueueIds(qs, qo.queueId, qo.ids), before));
  }
  // Remember each book's save stamp: undo only restores a book that is still EXACTLY as this apply
  // left it (any later edit — yours or a later apply — wins).
  undo.savedAt = {};
  for (const b of bookUpdates) { const rec = await saveLibraryBook(b); if (rec) undo.savedAt[b.id] = rec.updatedAt; }
  if (crossNoteAdds.length) await addCrossNotes(crossNoteAdds);
  for (const l of bindingAdds) await setBinding(l.checksum, l.bookId);
  const summary = applySummary(rows);
  const entry = { ...undo, ops, source, summary };
  const next = {
    ...aiNext,
    lastApply: entry,
    // The last 10 applies stay undoable (newest first) — not only the most recent one.
    undoStack: [entry, ...(ai?.undoStack || []).filter((u) => u.at !== entry.at)].slice(0, 10),
    applyLog: [{ at: now, ops, source, summary, auto, n: rows.length }, ...(ai?.applyLog || [])].slice(0, 100),
  };
  await saveJourneyAi(next);
  return { ai: next, summary };
}

// Put back everything a commit changed (the latest by default, or the one stamped `at`). A book changed
// AFTER that commit — by you or by a later apply — is left alone and counted in the summary.
export async function undoLastApply(ai, at = null) {
  const stack = ai?.undoStack?.length ? ai.undoStack : (ai?.lastApply ? [ai.lastApply] : []);
  const u = at == null ? stack[0] : stack.find((x) => x.at === at);
  if (!u) return { ai, summary: 'nothing to undo' };
  let kept = 0;
  for (const b of u.books || []) {
    const cur = await getLibraryBook(b.id).catch(() => null);
    const stamp = u.savedAt?.[b.id];
    if (cur && (stamp != null ? cur.updatedAt !== stamp : (cur.updatedAt || 0) > (u.at || 0) + 60000)) { kept++; continue; }
    await saveLibraryBook(b);
  }
  for (const cs of u.links || []) await setBinding(cs, null);
  for (const id of u.created || []) {
    const cur = await getLibraryBook(id).catch(() => null);
    if (cur && u.savedAt?.[id] != null && cur.updatedAt !== u.savedAt[id]) { kept++; continue; } // you've since edited it — keep
    await deleteLibraryBook(id); // books the apply created (tombstoned)
  }
  if (u.queues) await saveLibraryRef('queues', u.queues);
  if (u.crossTexts?.length) {
    const texts = new Set(u.crossTexts);
    for (const n of await getCrossNotes()) if (n.source === 'ai' && texts.has(n.text)) await deleteCrossNote(n.id);
  }
  const next = { ...ai };
  for (const [k, v] of Object.entries(u.ai || {})) { if (v === null) delete next[k]; else next[k] = v; }
  next.undoStack = stack.filter((x) => x !== u);
  if (next.undoStack.length) next.lastApply = next.undoStack[0]; else delete next.lastApply;
  next.applyLog = [{ at: Date.now(), ops: u.ops, source: 'undo', summary: `undid: ${u.summary}`, n: 0 }, ...(ai.applyLog || [])].slice(0, 100);
  await saveJourneyAi(next);
  return { ai: next, summary: `Undone — ${u.summary}${kept ? ` (${kept === 1 ? '1 book was' : `${kept} books were`} changed since — by you or a later apply — and left as ${kept === 1 ? 'it is' : 'they are'})` : ''}` };
}
