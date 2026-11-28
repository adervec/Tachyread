// Speaking done here, for SpeechImprover to analyse (house standard 27). Tachyread owns
// `shared-speech.json` in the reader's cloud folder and is the ONLY app that writes it;
// SpeechImprover only reads it. It carries the same logs the speech/ folder gets:
//   { schema: 1, owner: 'tachyread', updated, logs: [{ id: <log file name>, log }] }
// (`tachyread-speaking` v1 and `tachyread-narration` v1, see speakingBridge.js and
// narrationQuality.js). Unlike the folder it reaches a phone, and needs no folder picked.
// A log waits on this device until the reader is signed in, then joins the cloud copy.
import { speakingLog, speakingLogName } from './speakingBridge.js';

export const SHARED_SPEECH = 'shared-speech.json';
const PENDING = 'tachyread-shared-speech-pending';
const BACKFILLED = 'tachyread-shared-speech-backfilled';
const CAP = 500; // newest logs kept in the cloud file
const PENDING_CAP = 40;

const door = () => (typeof window !== 'undefined' ? window.appFont?.cloud || null : null);
const store = () => (typeof localStorage !== 'undefined' ? localStorage : null);
const readPending = () => { try { return JSON.parse(store()?.getItem(PENDING) || '[]'); } catch { return []; } };
const writePending = (list) => { try { store()?.setItem(PENDING, JSON.stringify(list.slice(-PENDING_CAP))); } catch { /* quota: the next log still tries */ } };

// Pure: two copies of the file combined, one entry per log id, newest CAP kept, oldest first.
export function mergeShared(a, b) {
  const byId = new Map();
  for (const e of [...(b?.logs || []), ...(a?.logs || [])]) {
    if (e && typeof e.id === 'string' && e.log && typeof e.log === 'object') byId.set(e.id, e);
  }
  const logs = [...byId.values()]
    .sort((x, y) => String(x.log.createdAt || '').localeCompare(String(y.log.createdAt || '')) || x.id.localeCompare(y.id))
    .slice(-CAP);
  // `updated` is the newest log's time, not "now", so an unchanged file compares equal and is not rewritten
  return { schema: 1, owner: 'tachyread', updated: logs.length ? logs[logs.length - 1].log.createdAt || null : null, logs };
}

// Puts what waits on this device into the cloud file. Never shows a sign-in window.
export async function flushSharedSpeech({ cloud = door(), getSpeechLog } = {}) {
  if (!cloud?.syncDoc || !cloud.signedIn?.()) return false;
  let pending = readPending();
  const backfill = !store()?.getItem(BACKFILLED);
  if (backfill) { // once: the reading-aloud sessions this device already kept
    const past = await (getSpeechLog || (await import('../state/storage.js')).getSpeechLog)();
    pending = [...past.map((rec) => ({ id: speakingLogName(rec), log: speakingLog(rec) })), ...pending];
  }
  if (!pending.length) return true;
  const parse = (t) => (t ? (globalThis.window?.appFont?.parseJSON ? window.appFont.parseJSON(t, 30e6) : JSON.parse(t)) : null);
  await cloud.syncDoc(SHARED_SPEECH, {
    // the cloud copy is read here too, because this device keeps only what is waiting, not the whole file
    load: async () => mergeShared({ logs: pending }, parse(await cloud.read(SHARED_SPEECH))),
    merge: mergeShared,
    save: () => {},
  });
  const sent = new Set(pending.map((e) => e.id));
  writePending(readPending().filter((e) => !sent.has(e.id)));
  if (backfill) try { store()?.setItem(BACKFILLED, '1'); } catch { /* tries again next time */ }
  return true;
}

// A finished session: queue it, and send it now if signed in.
export function shareSpeechLog(id, log) {
  if (!id || !log) return;
  writePending([...readPending().filter((e) => e.id !== id), { id, log }]);
  flushSharedSpeech().catch(() => { /* stays queued for the next session or start */ });
}
