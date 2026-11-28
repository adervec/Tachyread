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
import { cloudCoworkDir, NOT_SIGNED_IN } from './coworkCloud.js';
import { COWORK_OPS, opsInstruction, sanitizeOutput, planRows, isReportOnly, queuesForDataset, logRequest, reviewFirst, parkReply } from './coworkOps.js';
import { writeSnapshot, commitRows, snapshotForOps } from './coworkApply.js';
import { liveQueues } from './readingQueues.js';
import { weeklySummaries } from './journeyAnalytics.js';
import { askClaude, anthropicConfigured } from './anthropic.js';
import { syncWithProvider, syncLibraryWithProvider } from './sync/syncManager.js';
import { getSyncProvider } from './sync/syncProviders.js';
import { dueActions, syncRole, recordRun, combineCoworkInstruction } from './coworkActions.js';
import { sessionsForReview } from './sessionReview.js';
import { t } from '../i18n.js';
// The run notes below are shown in the sync history, so they are translated.

const TICK_MS = 60_000;

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
  if ((ai?.ledger || []).includes(hash)) return { ai, note: t('reply already applied') };
  if (reviewFirst(ai, ops)) return { ai: parkReply(ai, { text: reply, ops, source, hash }), note: t('reply waiting for your review on the Cowork page') };
  const [bindMap, queues] = await Promise.all([getBinding().catch(() => ({})), getLibraryRef('queues').catch(() => [])]);
  const booksById = Object.fromEntries(books.map((b) => [b.id, b]));
  const queuedIds = new Set(liveQueues(queues || []).flatMap((q) => q.ids || []));
  const { output, dropped } = sanitizeOutput(parseAiOutput(reply), ops, { booksById, bindMap, queuedIds, queues: queues || [] });
  const rows = planRows(output, { booksById }).filter((r) => ['analysis', 'recommendations', 'brief', 'weekly'].includes(r.kind));
  if (!rows.length) return { ai, note: dropped.length ? t.n('nothing applicable ({n} item outside the operation dropped)', 'nothing applicable ({n} items outside the operation dropped)', dropped.length) : t('nothing applicable') };
  const r = await commitRows(rows, { books, ai: { ...ai, ledger: [...(ai?.ledger || []), hash].slice(-50) }, ops, source: 'scheduled API', auto: true });
  return { ai: r.ai, note: dropped.length ? t.n('applied {summary} · dropped {n} out-of-scope item', 'applied {summary} · dropped {n} out-of-scope items', dropped.length, { summary: r.summary }) : t('applied {summary}', { summary: r.summary }) };
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
    let note; let ok = true; let target = '';
    try {
      const dir = await cloudCoworkDir(); // silent: null when not signed in on this device
      if (!dir) { ok = false; note = NOT_SIGNED_IN(); }
      else {
        target = dir.label;
        // One request file: if the last request hasn't been answered yet, fold its operations in
        // rather than overwriting it (the agent would never see the earlier, often bigger, request).
        const pending = ai?.requestLog?.[0] && ai.requestLog[0].at > (ai?.lastReplyAt || 0) ? ai.requestLog[0].ops : [];
        const instr = combineCoworkInstruction([...new Set([...pending, ...coworkIds])], { question: ai?.question || '' });
        if (!instr) throw new Error(t('nothing to send ("Ask a question" needs a question)'));
        const books = await getLibraryBooks();
        const dataset = await datasetWithProgress(instr.mode === 'light', books, instr.ops);
        const snap = await writeSnapshot(dir, now);
        const req = buildCoworkRequest(dataset, instr);
        req.snapshot = snapshotForOps(snap, instr.text || instr.ops?.map((id) => COWORK_OPS[id]?.instruction).join(' ')); // the snapshot/ files the instructions name
        await dir.write('journey-cowork-request.json', JSON.stringify(req, null, 2));
        await dir.write('journey-instructions.md', buildDigest(dataset, instr));
        ai = logRequest({ ...ai, instruction: { ...instr, updatedAt: now } }, { hash: req.requestHash, ops: instr.ops, at: now, auto: true }); // replies are matched back by hash
        note = t('auto-wrote cowork request ({mode})', { mode: instr.mode });
      }
    } catch (e) { ok = false; note = t('auto cowork write failed: {error}', { error: e?.message || e }); }
    ai = recordRun(ai, coworkIds, { at: now, kind: 'cowork', target, ok, note, auto: true });
  }

  // ── Activity snapshot (read-only files) ──
  if (due.includes('cw-snapshot')) {
    let ok = true; let note;
    try {
      const dir = await cloudCoworkDir();
      if (!dir) { ok = false; note = NOT_SIGNED_IN(); }
      else note = t('auto snapshot ({n} files)', { n: Object.keys(await writeSnapshot(dir, now)).length });
    } catch (e) { ok = false; note = t('snapshot failed: {error}', { error: e?.message || e }); }
    ai = recordRun(ai, ['cw-snapshot'], { at: now, kind: 'cowork', target: t('cowork folder'), ok, note, auto: true });
  }

  // ── Direct API action ──
  if (due.includes('api-light')) {
    let note; let ok = true;
    try {
      if (!anthropicConfigured(g?.anthropicKey)) { ok = false; note = t('skipped — no Anthropic API key'); }
      else {
        const books = await getLibraryBooks();
        const dataset = await datasetWithProgress(true, books);
        const instr = opsInstruction(['cw-light']); // report-only operation
        const { system, messages } = buildApiMessages(dataset, instr);
        const reply = await askClaude(messages, {
          key: g.anthropicKey, model: g.anthropicModel || 'claude-sonnet-5', system, maxTokens: 2048, source: 'trackyread-auto',
        });
        if (!isReportOnly(instr.ops)) throw new Error(t('scheduled API runs are report-only'));
        const r = await applyReportOnly(ai, reply, instr.ops, books);
        ai = r.ai; note = t('auto API refresh — {note}', { note: r.note });
      }
    } catch (e) { ok = false; note = t('auto API refresh failed: {error}', { error: e?.message || e }); }
    ai = recordRun(ai, ['api-light'], { at: now, kind: 'api', target: g?.anthropicModel || 'claude-sonnet-5', ok, note, auto: true });
  }

  // ── Cloud sync actions ──
  for (const id of due.filter((d) => d.startsWith('cloud-'))) {
    let note; let ok = true;
    const cfg = g?.sync || {};
    const p = getSyncProvider(cfg.provider);
    const target = p?.label || cfg.provider || t('no provider');
    try {
      if (!p || !p.supported() || p.available(cfg) !== true) { ok = false; note = t('skipped — sync provider not connected on this device'); }
      else if (id === 'cloud-progress') { const r = await syncWithProvider(cfg.provider, cfg, { silent: true }); note = t('auto progress sync ({n} KB)', { n: Math.round((r.bytes || 0) / 1024) }); }
      else { const r = await syncLibraryWithProvider(cfg.provider, cfg, { silent: true }); note = r.skipped ? t('auto library sync — already in sync') : t('auto library sync ({n} books)', { n: r.books ?? '?' }); }
    } catch (e) { ok = false; note = id === 'cloud-progress' ? t('auto progress sync failed: {error}', { error: e?.message || e }) : t('auto library sync failed: {error}', { error: e?.message || e }); }
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
