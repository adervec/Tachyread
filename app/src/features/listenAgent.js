// Pocket-listening agent: a slow loop (20 s after boot, then every 10 min). On the designated sync
// machine with listenRender on it renders the listen queue's window ahead and mirrors it to the sync
// target; on any device with listenPull on it fetches the window; both then drop heard clips. Status
// lives here (module state + subscribers) so the Audio Settings card can show it and trigger a run
// without App plumbing. Runs never overlap; failures become status text (and never throw).
import { getJourneyAi, getDeviceId } from '../state/storage.js';
import { syncRole } from './coworkActions.js';
import { listenBooks, renderWindow, pushWindow, pullWindow, pruneHeard } from './listenCloud.js';
import { createLocalEngine, blobDurationMs } from './localTts.js';

// A device that isn't the sync machine may still render its own window locally (nothing uploaded)
// — only while charging, since WASM Kokoro can take hours. No Battery API → allowed.
const charging = async () => { try { return navigator.getBattery ? (await navigator.getBattery()).charging : true; } catch { return true; } };

// How fast is Kokoro on THIS device? Two synths of a fixed paragraph (the first also loads the
// model); the second's audio-seconds per wall-second is the answer, with the backend it ran on.
const SPEED_TEXT = 'The morning light crept slowly across the valley, touching first the tops of the pines and then the quiet roofs of the village below. Nobody stirred yet. A dog barked once, far off, and fell silent again.';
export async function runSpeedTest() {
  if (status.busy) return;
  const voice = getGlobal()?.kokoroLive || 'kokoro:af_heart';
  setStatus({ busy: true, text: 'speed test: loading Kokoro (first time downloads the model)…' });
  const engine = createLocalEngine();
  try {
    await engine.synth(SPEED_TEXT, voice);
    setStatus({ text: 'speed test: timing…' });
    const t0 = performance.now();
    const ms = await blobDurationMs(await engine.synth(SPEED_TEXT, voice));
    const rtf = ms / (performance.now() - t0);
    const dev = engine.kokoroDevice() || 'wasm';
    setStatus({ text: `Kokoro here: ${rtf.toFixed(1)}× real-time on ${dev}${rtf < 1 ? ' — slower than playback; let the sync machine render and pull here' : rtf < 3 ? ' — usable for rendering while charging' : ' — fine for rendering ahead'}` });
  } catch (e) { setStatus({ text: `speed test failed: ${e?.message || e}` }); }
  finally { engine.dispose(); setStatus({ busy: false }); }
}

const TICK_MS = 10 * 60_000;
let status = { busy: false, text: 'idle', at: 0 };
const subs = new Set();
export const listenStatus = () => status;
export function onListenStatus(cb) { subs.add(cb); return () => subs.delete(cb); }
const setStatus = (patch) => { status = { ...status, ...patch, at: Date.now() }; for (const cb of subs) cb(status); };

let getGlobal = () => ({});
let stopFlag = false;
export const stopListenRun = () => { stopFlag = true; };

export async function runListenNow() {
  if (status.busy) return;
  const g = getGlobal() || {};
  if (!g.listenRender && !g.listenPull) { setStatus({ text: 'off — turn on rendering or pulling below' }); return; }
  const cfg = g.sync || {};
  const hours = g.listenHours || 20, capBytes = (g.listenCapGb || 1) * 1e9;
  stopFlag = false;
  setStatus({ busy: true, text: 'starting…' });
  const notes = [];
  try {
    if (g.listenRender) {
      const machine = syncRole(await getJourneyAi().catch(() => null), getDeviceId()).role === 'machine';
      if (!g.kokoroLive) notes.push('render skipped — pick a Kokoro voice under “Fill gaps with Kokoro”');
      else if (!g.listenQueue) notes.push('render skipped — pick a queue in the TTS controls (QUEUE)');
      else if (!machine && !(await charging())) notes.push('render skipped — not the sync machine, so this device only renders for itself while charging');
      else {
        const made = await renderWindow(await listenBooks(g.listenQueue), { voice: g.kokoroLive, hours, capBytes, shouldStop: () => stopFlag, onProgress: (p) => setStatus({ text: `rendering ${p.made}/${p.todo} — ${p.title}` }) });
        if (!machine) notes.push(`rendered ${made} for this device (not the sync machine — nothing uploaded)`);
        else {
          const r = await pushWindow(await listenBooks(g.listenQueue), cfg, { hours, capBytes, voice: g.kokoroLive, device: g.deviceName || '', onProgress: (p) => setStatus({ text: `uploading ${p.uploaded}/${p.total}` }) });
          notes.push(`rendered ${made}, uploaded ${r.uploaded}, removed ${r.removed} · cloud window ${r.chunks} chunks, ${(r.bytes / 1e6).toFixed(0)} MB`);
        }
      }
    }
    if (g.listenPull) {
      const r = await pullWindow(cfg, { onProgress: (p) => setStatus({ text: `downloading ${p.got}/${p.total}` }) });
      notes.push(r.skipped ? `pull skipped — ${r.skipped}` : `pulled ${r.got} clip(s)`);
    }
    const n = await pruneHeard();
    if (n) notes.push(`dropped ${n} heard`);
  } catch (e) { notes.push(`failed: ${e?.message || e}`); }
  setStatus({ busy: false, text: notes.join(' · ') || 'nothing to do' });
}

// deps: { getGlobal: () => globalSettingsSnapshot }
export function startListenAgent(deps) {
  getGlobal = deps.getGlobal;
  const id = setInterval(() => { runListenNow().catch(() => {}); }, TICK_MS);
  const boot = setTimeout(() => { runListenNow().catch(() => {}); }, 20_000);
  return () => { clearInterval(id); clearTimeout(boot); stopFlag = true; };
}
