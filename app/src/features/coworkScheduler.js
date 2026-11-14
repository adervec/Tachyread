// Cowork Sync SCHEDULER — auto-runs due sync actions, and ONLY on the designated sync machine
// (ai.syncMachine). Nothing runs while the role is 'open' (no machine designated) or 'viewer';
// schedules are stored per action on the ai record (see coworkActions.js) so every device can SEE
// them, but exactly one device executes them. Runs are silent: failures are recorded into the
// sync history (never thrown), and folder writes only happen when the browser still remembers the
// readwrite grant — otherwise the run is logged as skipped so the user knows to re-grant.

import {
  getJourneyAi, saveJourneyAi, getLibraryBooks, allFiles, getDeviceId, getBinding, getLibraryRef, loadGlobal, allTypingRuns, getSpeechLog,
} from '../state/storage.js';
import {
  buildDataset, buildProgress, buildDigest, buildCoworkRequest,
  buildApiMessages, parseAiOutput, contentHash,
} from './journeyAi.js';
import { subDir, subDirLabel } from './tachyFolder.js';
import { opsInstruction, sanitizeOutput, planRows, isReportOnly, queuesForDataset, logRequest, reviewFirst, parkReply } from './coworkOps.js';
import { writeSnapshot, commitRows } from './coworkApply.js';
import { liveQueues } from './readingQueues.js';
import { weeklySummaries } from './journeyAnalytics.js';
import { askClaude, anthropicConfigured } from './anthropic.js';
import { syncWithProvider, syncLibraryWithProvider } from './sync/syncManager.js';
import { getSyncProvider } from './sync/syncProviders.js';
import { dueActions, syncRole, recordRun, combineCoworkInstruction } from './coworkActions.js';
import { sessionsForReview } from './sessionReview.js';

const TICK_MS = 60_000;

async function writeToDir(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
}

async function datasetWithProgress(light, books, ops = []) {
  const bindMap = await getBinding().catch(() => ({})); // real links — "link files" must see which are linked
  const progress = buildProgress(await allFiles().catch(() => []), { books, bindMap, days: 63 });
  progress.weeklySummaries = weeklySummaries(progress.days, books, { weeks: 8 });
  const ds = buildDataset(books, { light, progress });
  ds.queues = queuesForDataset(await getLibraryRef('queues').catch(() => []), books);
  ds.vocabWords = ((await loadGlobal().catch(() => null))?.vocabDeck || []).map((c) => c.word);
  const ai = await getJourneyAi().catch(() => null);
  ds.requeueSkip = (ai?.requeueSkip || []).map(({ bookId, toQueueId }) => ({ bookId, toQueueId }));
  if (ops.includes('cw-session-review')) ds.sessions = sessionsForReview(await allTypingRuns().catch(() => []), await getSpeechLog().catch(() => []), ai?.sessionReviews);
  return ds;
}

// Scheduled runs NEVER apply book changes on their own: an API reply goes through the same
// permission filter as everything else. By default (review first) it waits in the Cowork page's
// review list; only when review is switched off for every operation are its REPORT rows
// (analysis, read-next, briefs, weeklies) committed automatically — logged and undoable.
async function applyReportOnly(ai, reply, ops, books, source = 'scheduled API') {
  const hash = contentHash(reply);
  if ((ai?.ledger || []).includes(hash)) return { ai, note: 'reply already applied' };
  if (reviewFirst(ai, ops)) return { ai: parkReply(ai, { text: reply, ops, source, hash }), note: 'reply waiting for your review on the Cowork page' };
  const [bindMap, queues] = await Promise.all([getBinding().catch(() => ({})), getLibraryRef('queues').catch(() => [])]);
  const booksById = Object.fromEntries(books.map((b) => [b.id, b]));
  const queuedIds = new Set(liveQueues(queues || []).flatMap((q) => q.ids || []));
  const { output, dropped } = sanitizeOutput(parseAiOutput(reply), ops, { booksById, bindMap, queuedIds, queues: queues || [] });
  const rows = planRows(output, { booksById }).filter((r) => ['analysis', 'recommendations', 'brief', 'weekly'].includes(r.kind));
  if (!rows.length) return { ai, note: `nothing applicable${dropped.length ? ` (${dropped.length} item(s) outside the operation dropped)` : ''}` };
  const r = await commitRows(rows, { books, ai: { ...ai, ledger: [...(ai?.ledger || []), hash].slice(-50) }, ops, source: 'scheduled API', auto: true });
  return { ai: r.ai, note: `applied ${r.summary}${dropped.length ? ` · dropped ${dropped.length} out-of-scope item(s)` : ''}` };
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
  const coworkIds = due.filter((id) => id.startsWith('cw-') && id !== 'cw-snapshot');
  if (coworkIds.length) {
    let note; let ok = true; let target = ai?.coworkDirPath || '';
    try {
      const dir = await subDir('cowork'); // silent: null when not chosen or permission lapsed
      if (!dir) { ok = false; note = 'skipped — Tachyread folder not connected (open the Cowork page once to re-grant)'; }
      else {
        target = target || (await subDirLabel('cowork'));
        // One request file: if the last request hasn't been answered yet, fold its operations in
        // rather than overwriting it (the agent would never see the earlier, often bigger, request).
        const pending = ai?.requestLog?.[0] && ai.requestLog[0].at > (ai?.lastReplyAt || 0) ? ai.requestLog[0].ops : [];
        const instr = combineCoworkInstruction([...new Set([...pending, ...coworkIds])], { question: ai?.question || '' });
        if (!instr) throw new Error('nothing to send ("Ask a question" needs a question)');
        const books = await getLibraryBooks();
        const dataset = await datasetWithProgress(instr.mode === 'light', books, instr.ops);
        await writeSnapshot(dir, now); // the request's agent reads snapshot/ too
        const req = buildCoworkRequest(dataset, instr);
        await writeToDir(dir, 'journey-cowork-request.json', JSON.stringify(req, null, 2));
        await writeToDir(dir, 'journey-instructions.md', buildDigest(dataset, instr));
        ai = logRequest({ ...ai, instruction: { ...instr, updatedAt: now } }, { hash: req.requestHash, ops: instr.ops, at: now, auto: true }); // replies are matched back by hash
        note = `auto-wrote cowork request (${instr.mode})`;
      }
    } catch (e) { ok = false; note = `auto cowork write failed: ${e?.message || e}`; }
    ai = recordRun(ai, coworkIds, { at: now, kind: 'cowork', target, ok, note, auto: true });
  }

  // ── Activity snapshot (read-only files) ──
  if (due.includes('cw-snapshot')) {
    let ok = true; let note;
    try {
      const dir = await subDir('cowork');
      if (!dir) { ok = false; note = 'skipped — Tachyread folder not connected (open the Cowork page once to re-grant)'; }
      else note = `auto snapshot (${await writeSnapshot(dir, now)} files)`;
    } catch (e) { ok = false; note = `snapshot failed: ${e?.message || e}`; }
    ai = recordRun(ai, ['cw-snapshot'], { at: now, kind: 'cowork', target: ai?.coworkDirPath || 'cowork folder', ok, note, auto: true });
  }

  // ── Direct API action ──
  if (due.includes('api-light')) {
    let note; let ok = true;
    try {
      if (!anthropicConfigured(g?.anthropicKey)) { ok = false; note = 'skipped — no Anthropic API key'; }
      else {
        const books = await getLibraryBooks();
        const dataset = await datasetWithProgress(true, books);
        const instr = opsInstruction(['cw-light']); // report-only operation
        const { system, messages } = buildApiMessages(dataset, instr);
        const reply = await askClaude(messages, {
          key: g.anthropicKey, model: g.anthropicModel || 'claude-sonnet-5', system, maxTokens: 2048, source: 'trackyread-auto',
        });
        if (!isReportOnly(instr.ops)) throw new Error('scheduled API runs are report-only');
        const r = await applyReportOnly(ai, reply, instr.ops, books);
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
