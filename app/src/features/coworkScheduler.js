// Cowork Sync SCHEDULER — auto-runs due sync actions, and ONLY on the designated sync machine
// (ai.syncMachine). Nothing runs while the role is 'open' (no machine designated) or 'viewer';
// schedules are stored per action on the ai record (see coworkActions.js) so every device can SEE
// them, but exactly one device executes them. Runs are silent: failures are recorded into the
// sync history (never thrown), and folder writes only happen when the browser still remembers the
// readwrite grant — otherwise the run is logged as skipped so the user knows to re-grant.

import {
  getJourneyAi, saveJourneyAi, getLibraryBooks, allFiles, getFsHandle, getDeviceId,
  saveLibraryBook, addCrossNotes, setBinding,
} from '../state/storage.js';
import {
  buildDataset, buildProgress, buildDigest, buildCoworkRequest, buildCoworkManifest,
  buildApiMessages, parseAiOutput, applyAiOutput, contentHash, getInstruction, LIGHT_INSTRUCTION,
} from './journeyAi.js';
import { weeklySummaries } from './journeyAnalytics.js';
import { askClaude, anthropicConfigured } from './anthropic.js';
import { syncWithProvider, syncLibraryWithProvider } from './sync/syncManager.js';
import { getSyncProvider } from './sync/syncProviders.js';
import { dueActions, syncRole, recordRun, combineCoworkInstruction } from './coworkActions.js';

const TICK_MS = 60_000;

async function writeToDir(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
}

async function datasetWithProgress(light, books) {
  const progress = buildProgress(await allFiles().catch(() => []), { books, bindMap: {}, days: 63 });
  progress.weeklySummaries = weeklySummaries(progress.days, books, { weeks: 8 });
  return buildDataset(books, { light, progress });
}

// Headless twin of the dialog's applyOutput: ledger dedupe, whitelisted book patches, notes,
// bindings, weeklies, analysis archiving, heavy→light reset. Returns the summary line.
async function applyOutputHeadless(ai, output, sourceText, booksById) {
  const hash = contentHash(sourceText || JSON.stringify(output));
  const ledger = ai?.ledger || [];
  if (ledger.includes(hash)) return { ai, note: 'output already applied' };
  const { bookUpdates, aiPatch, crossNoteAdds, bindingAdds, weeklyAdds } = applyAiOutput(output, booksById);
  for (const b of bookUpdates) await saveLibraryBook(b);
  if (crossNoteAdds?.length) await addCrossNotes(crossNoteAdds);
  for (const bd of bindingAdds || []) await setBinding(bd.checksum, bd.bookId);
  const wasHeavy = getInstruction(ai).mode === 'heavy';
  const next = { ...(ai || {}), ...aiPatch, ledger: [...ledger, hash].slice(-50) };
  if (aiPatch.analysis && ai?.analysis && ai.analysis !== aiPatch.analysis) {
    next.analysisHistory = [{ text: ai.analysis, at: ai.updatedAt || Date.now() }, ...(ai.analysisHistory || [])].slice(0, 20);
  }
  if (aiPatch.analysis) next.updatedAt = Date.now();
  if (weeklyAdds?.length) {
    next.weeklies = { ...(ai?.weeklies || {}) };
    for (const w of weeklyAdds) next.weeklies[w.week] = { text: w.text, at: Date.now() };
  }
  if (wasHeavy) next.instruction = { mode: 'light', text: LIGHT_INSTRUCTION, updatedAt: Date.now() };
  return { ai: next, note: `applied ${bookUpdates.length} patch(es)${aiPatch.analysis ? ' + analysis' : ''}` };
}

// One scheduler pass. Exported for direct invocation; startCoworkScheduler wires the timer.
export async function coworkSchedulerTick(deps, now = Date.now()) {
  let ai;
  try { ai = await getJourneyAi(); } catch { return; }
  if (syncRole(ai, getDeviceId()).role !== 'machine') return;
  const due = dueActions(ai?.schedules, ai?.actionRuns, now);
  if (!due.length) return;
  const g = deps.getGlobal();

  // ── Cowork folder actions: one combined request write ──
  const coworkIds = due.filter((id) => id.startsWith('cw-'));
  if (coworkIds.length) {
    let note; let ok = true; let target = ai?.coworkDirPath || '';
    try {
      const dir = await getFsHandle('journeyCoworkDir');
      const perm = dir && (await (dir.queryPermission?.({ mode: 'readwrite' }) ?? 'granted'));
      if (!dir) { ok = false; note = 'skipped — no cowork folder chosen'; }
      else if (perm !== 'granted') { ok = false; note = 'skipped — folder permission needs re-granting (open the Cowork page once)'; }
      else {
        target = target || dir.name;
        const instr = combineCoworkInstruction(coworkIds, ai?.customText || '');
        const books = await getLibraryBooks();
        const dataset = await datasetWithProgress(instr.mode === 'light', books);
        await writeToDir(dir, 'journey-cowork-request.json', JSON.stringify(buildCoworkRequest(dataset, instr), null, 2));
        await writeToDir(dir, 'journey-instructions.md', buildDigest(dataset, instr));
        await writeToDir(dir, 'cowork.json', JSON.stringify(buildCoworkManifest(), null, 2));
        ai.instruction = { ...instr, updatedAt: now }; // response-apply resets heavy → light as usual
        note = `auto-wrote cowork request (${instr.mode})`;
      }
    } catch (e) { ok = false; note = `auto cowork write failed: ${e?.message || e}`; }
    ai = recordRun(ai, coworkIds, { at: now, kind: 'cowork', target, ok, note, auto: true });
  }

  // ── Direct API action ──
  if (due.includes('api-light')) {
    let note; let ok = true;
    try {
      if (!anthropicConfigured(g?.anthropicKey)) { ok = false; note = 'skipped — no Anthropic API key'; }
      else {
        const books = await getLibraryBooks();
        const dataset = await datasetWithProgress(true, books);
        const instr = { mode: 'light', text: LIGHT_INSTRUCTION };
        const { system, messages } = buildApiMessages(dataset, instr);
        const reply = await askClaude(messages, {
          key: g.anthropicKey, model: g.anthropicModel || 'claude-sonnet-5', system, maxTokens: 2048, source: 'trackyread-auto',
        });
        const booksById = Object.fromEntries(books.map((b) => [b.id, b]));
        const r = await applyOutputHeadless(ai, parseAiOutput(reply), reply, booksById);
        ai = r.ai; note = `auto API refresh — ${r.note}`;
      }
    } catch (e) { ok = false; note = `auto API refresh failed: ${e?.message || e}`; }
    ai = recordRun(ai, ['api-light'], { at: now, kind: 'api', target: g?.anthropicModel || 'claude-sonnet-5', ok, note, auto: true });
  }

  // ── Cloud sync actions ──
  for (const id of due.filter((d) => d.startsWith('cloud-'))) {
    let note; let ok = true;
    const cfg = g?.sync || {};
    const p = getSyncProvider(cfg.provider);
    const target = p?.label || cfg.provider || 'no provider';
    try {
      if (!p || !p.supported() || p.available(cfg) !== true) { ok = false; note = 'skipped — sync provider not connected on this device'; }
      else if (id === 'cloud-progress') { const r = await syncWithProvider(cfg.provider, cfg, { silent: true }); note = `auto progress sync (${Math.round((r.bytes || 0) / 1024)} KB)`; }
      else { const r = await syncLibraryWithProvider(cfg.provider, cfg, { silent: true }); note = r.skipped ? 'auto library sync — already in sync' : `auto library sync (${r.books ?? '?'} books)`; }
    } catch (e) { ok = false; note = `auto ${id === 'cloud-progress' ? 'progress' : 'library'} sync failed: ${e?.message || e}`; }
    ai = recordRun(ai, [id], { at: now, kind: 'cloud', target, ok, note, auto: true });
  }

  try { await saveJourneyAi(ai); deps.onRan?.(due); } catch { /* storage closed mid-shutdown */ }
}

// deps: { getGlobal: () => globalSettingsSnapshot, onRan?: (ids) => void }
export function startCoworkScheduler(deps) {
  const id = setInterval(() => { coworkSchedulerTick(deps).catch(() => {}); }, TICK_MS);
  const boot = setTimeout(() => { coworkSchedulerTick(deps).catch(() => {}); }, 15_000);
  return () => { clearInterval(id); clearTimeout(boot); };
}
