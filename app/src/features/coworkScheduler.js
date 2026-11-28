// Cowork SCHEDULER: writes due runner requests to the cloud, ONLY on the designated sync machine
// (ai.syncMachine). Nothing runs while the role is 'open' (no machine designated) or 'viewer';
// schedules are stored per operation on the ai record (see coworkActions.js) so every device can SEE
// them, but exactly one device sends them. The AI runner answers in the cloud. Runs are silent:
// failures are recorded into the sync history (never thrown).

import {
  getJourneyAi, saveJourneyAi, getLibraryBooks, allFiles, getDeviceId, getBinding, getLibraryRef, loadGlobal, allTypingRuns, getSpeechLog,
} from '../state/storage.js';
import {
  buildDataset, buildProgress, buildDigest, buildCoworkRequest,
} from './journeyAi.js';
import { cloudCoworkDir, NOT_SIGNED_IN } from './coworkCloud.js';
import { COWORK_OPS, queuesForDataset, logRequest } from './coworkOps.js';
import { writeSnapshot, snapshotForOps } from './coworkApply.js';
import { weeklySummaries } from './journeyAnalytics.js';
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

// One scheduler pass. Exported for direct invocation; startCoworkScheduler wires the timer.
export async function coworkSchedulerTick(deps, now = Date.now()) {
  let ai;
  try { ai = await getJourneyAi(); } catch { return; }
  if (syncRole(ai, getDeviceId()).role !== 'machine') return;
  // dueActions only knows runner operations: old snapshot / API / cloud-sync schedules are ignored.
  const due = dueActions(ai?.schedules, ai?.actionRuns, now);
  if (!due.length) return;

  // ── Runner operations: one combined request in the cloud ──
  const coworkIds = due;
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

  try { await saveJourneyAi(ai); deps.onRan?.(due); } catch { /* storage closed mid-shutdown */ }
}

// deps: { getGlobal: () => globalSettingsSnapshot, onRan?: (ids) => void }
export function startCoworkScheduler(deps) {
  const id = setInterval(() => { coworkSchedulerTick(deps).catch(() => {}); }, TICK_MS);
  const boot = setTimeout(() => { coworkSchedulerTick(deps).catch(() => {}); }, 15_000);
  return () => { clearInterval(id); clearTimeout(boot); };
}
