// Pocket-listening agent: a slow loop (20 s after boot, then every 10 min). On the designated sync
// machine with listenRender on it renders the listen queue's window ahead and mirrors it to the sync
// target; on any device with listenPull on it fetches the window; both then drop heard clips. Status
// lives here (module state + subscribers) so the Audio Settings card can show it and trigger a run
// without App plumbing. Runs never overlap; failures become status text (and never throw).
import { getJourneyAi, getDeviceId } from '../state/storage.js';
import { syncRole } from './coworkActions.js';
import { listenBooks, renderWindow, pushWindow, pullWindow, pruneHeard } from './listenCloud.js';
import { createLocalEngine, blobDurationMs } from './localTts.js';
import { t } from '../i18n.js';

// A device that isn't the sync machine may still render its own window locally (nothing uploaded)
// — only while charging, since WASM Kokoro can take hours. No Battery API → allowed.
const charging = async () => { try { return navigator.getBattery ? (await navigator.getBattery()).charging : true; } catch { return true; } };

// How fast is Kokoro on THIS device? Two synths of a fixed paragraph (the first also loads the
// model); the second's audio-seconds per wall-second is the answer, with the backend it ran on.
const SPEED_TEXT = 'The morning light crept slowly across the valley, touching first the tops of the pines and then the quiet roofs of the village below. Nobody stirred yet. A dog barked once, far off, and fell silent again.';
export async function runSpeedTest() {
  if (status.busy) return;
  const voice = getGlobal()?.kokoroLive || 'kokoro:af_heart';
  setStatus({ busy: true, text: t('speed test: loading Kokoro (first time downloads the model)…') });
  const engine = createLocalEngine();
  try {
    await engine.synth(SPEED_TEXT, voice);
    setStatus({ text: t('speed test: timing…') });
    const t0 = performance.now();
    const ms = await blobDurationMs(await engine.synth(SPEED_TEXT, voice));
    const rtf = ms / (performance.now() - t0);
    const dev = engine.kokoroDevice() || 'wasm';
    const x = rtf.toFixed(1);
    setStatus({ text: rtf < 1 ? t('Kokoro here: {x}× real-time on {dev} — slower than playback; let the sync machine render and pull here', { x, dev })
      : rtf < 3 ? t('Kokoro here: {x}× real-time on {dev} — usable for rendering while charging', { x, dev })
      : t('Kokoro here: {x}× real-time on {dev} — fine for rendering ahead', { x, dev }) });
  } catch (e) { setStatus({ text: t('speed test failed: {error}', { error: e?.message || e }) }); }
  finally { engine.dispose(); setStatus({ busy: false }); }
}

const TICK_MS = 10 * 60_000;
let status = { busy: false, text: t('idle'), at: 0 };
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
  if (!g.listenRender && !g.listenPull) { setStatus({ text: t('off — turn on rendering or pulling below') }); return; }
  const cfg = g.sync || {};
  const hours = g.listenHours || 20, capBytes = (g.listenCapGb || 1) * 1e9;
  stopFlag = false;
  setStatus({ busy: true, text: t('starting…') });
  const notes = [];
  try {
    if (g.listenRender) {
      const machine = syncRole(await getJourneyAi().catch(() => null), getDeviceId()).role === 'machine';
      if (!g.kokoroLive) notes.push(t('render skipped — pick a Kokoro voice under “Fill gaps with Kokoro”'));
      else if (!g.listenQueue) notes.push(t('render skipped — pick a queue in the TTS controls (QUEUE)'));
      else if (!machine && !(await charging())) notes.push(t('render skipped — not the sync machine, so this device only renders for itself while charging'));
      else {
        const made = await renderWindow(await listenBooks(g.listenQueue), { voice: g.kokoroLive, hours, capBytes, shouldStop: () => stopFlag, onProgress: (p) => setStatus({ text: t('rendering {made}/{todo} — {title}', { made: p.made, todo: p.todo, title: p.title }) }) });
        if (!machine) notes.push(t('rendered {made} for this device (not the sync machine — nothing uploaded)', { made }));
        else {
          const r = await pushWindow(await listenBooks(g.listenQueue), cfg, { hours, capBytes, voice: g.kokoroLive, device: g.deviceName || '', onProgress: (p) => setStatus({ text: t('uploading {done}/{total}', { done: p.uploaded, total: p.total }) }) });
          notes.push(t('rendered {made}, uploaded {uploaded}, removed {removed} · cloud window {chunks} chunks, {mb} MB', { made, uploaded: r.uploaded, removed: r.removed, chunks: r.chunks, mb: (r.bytes / 1e6).toFixed(0) }));
        }
      }
    }
    if (g.listenPull) {
      const r = await pullWindow(cfg, { onProgress: (p) => setStatus({ text: t('downloading {done}/{total}', { done: p.got, total: p.total }) }) });
      notes.push(r.skipped ? t('pull skipped — {reason}', { reason: r.skipped }) : t.n('pulled {n} clip', 'pulled {n} clips', r.got));
    }
    const n = await pruneHeard();
    if (n) notes.push(t('dropped {n} heard', { n }));
  } catch (e) { notes.push(t('failed: {error}', { error: e?.message || e })); }
  setStatus({ busy: false, text: notes.join(' · ') || t('nothing to do') });
}

// deps: { getGlobal: () => globalSettingsSnapshot }
export function startListenAgent(deps) {
  getGlobal = deps.getGlobal;
  const id = setInterval(() => { runListenNow().catch(() => {}); }, TICK_MS);
  const boot = setTimeout(() => { runListenNow().catch(() => {}); }, 20_000);
  return () => { clearInterval(id); clearTimeout(boot); stopFlag = true; };
}
