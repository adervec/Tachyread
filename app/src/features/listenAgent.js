// Pocket-listening agent: a slow loop (20 s after boot, then every 10 min). On the designated sync
// machine with listenRender on it renders the listen queue's window ahead and mirrors it to the sync
// target; on any device with listenPull on it fetches the window; both then drop heard clips. Status
// lives here (module state + subscribers) so the Audio Settings card can show it and trigger a run
// without App plumbing. Runs never overlap; failures become status text (and never throw).
import { getJourneyAi, getDeviceId } from '../state/storage.js';
import { syncRole } from './coworkActions.js';
import { listenBooks, renderWindow, pushWindow, pullWindow, pruneHeard } from './listenCloud.js';
import { planWindow } from './listenWindow.js';
import { createLocalEngine, blobDurationMs } from './localTts.js';
import { t, fmtNum } from '../i18n.js';

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
    const x = fmtNum(rtf, 1, 1);
    setStatus({ text: rtf < 1 ? t('Kokoro here: {x}× real-time on {dev} — slower than playback; let the sync machine render and pull here', { x, dev })
      : rtf < 3 ? t('Kokoro here: {x}× real-time on {dev} — usable for rendering while charging', { x, dev })
      : t('Kokoro here: {x}× real-time on {dev} — fine for rendering ahead', { x, dev }) });
  } catch (e) { setStatus({ text: t('speed test failed: {error}', { error: e?.message || e }) }); }
  finally { engine.dispose(); setStatus({ busy: false }); }
}

const TICK_MS = 10 * 60_000;
const BATCH = 10; // passages rendered between uploads, so the phone gets the first ones in minutes
// The last run's outcome survives a reload (the Listen window shows it): text, when, and a report
// { books: [{ title, inWindow, rendered, inCloud, ms }], skipped: [{ title, why }], cloudMs, ok }.
const STATUS_KEY = 'tachyread-listen-status';
const loadStatus = () => { try { return JSON.parse(localStorage.getItem(STATUS_KEY)) || null; } catch { return null; } };
let status = { text: t('not run yet on this device'), at: 0, report: null, ...loadStatus(), busy: false };
const subs = new Set();
export const listenStatus = () => status;
export function onListenStatus(cb) { subs.add(cb); return () => subs.delete(cb); }
const setStatus = (patch) => {
  status = { ...status, ...patch, at: Date.now() };
  if (!status.busy) { try { localStorage.setItem(STATUS_KEY, JSON.stringify({ text: status.text, at: status.at, report: status.report })); } catch { /* storage full or blocked */ } }
  for (const cb of subs) cb(status);
};

let getGlobal = () => ({});
let stopFlag = false;
export const stopListenRun = () => { stopFlag = true; };

// Per book: passages in the window, how many have audio here, how many are in the cloud.
function bookReport(books, { hours, capBytes }, perBook = {}) {
  const win = planWindow(books, { hours, capBytes });
  return books.map((b) => {
    const mine = win.filter((e) => e.cs === b.cs);
    return { title: b.title, inWindow: mine.length, rendered: mine.filter((e) => e.hasClip).length, inCloud: perBook[b.cs] ?? null, ms: mine.reduce((s, e) => s + e.ms, 0) };
  }).filter((r) => r.inWindow);
}
const signedOut = () => typeof window !== 'undefined' && !window.appFont?.cloud?.signedIn?.();

export async function runListenNow() {
  if (status.busy) return;
  const g = getGlobal() || {};
  if (!g.listenRender && !g.listenPull) { setStatus({ text: t('off — turn on rendering or pulling below') }); return; }
  const cfg = g.sync || {};
  const hours = g.listenHours || 20, capBytes = (g.listenCapGb || 1) * 1e9;
  stopFlag = false;
  setStatus({ busy: true, text: t('starting…') });
  const notes = [];
  const report = { books: [], skipped: [], cloudMs: null, ok: true };
  try {
    if (g.listenRender) {
      const machine = syncRole(await getJourneyAi().catch(() => null), getDeviceId()).role === 'machine';
      if (!g.kokoroLive) notes.push(t('render skipped — pick a voice'));
      else if (!g.listenQueue) notes.push(t('render skipped — pick a queue'));
      else if (!machine && !(await charging())) notes.push(t('render skipped — not the sync machine, so this device only renders for itself while charging'));
      else {
        const books = await listenBooks(g.listenQueue, report.skipped);
        if (!books.length) notes.push(t('nothing to render — no unfinished book in this queue has its text on this device'));
        const push = async () => pushWindow(books, cfg, { hours, capBytes, voice: g.kokoroLive, device: g.deviceName || '', onProgress: (p) => setStatus({ text: t('uploading {done}/{total}', { done: p.uploaded, total: p.total }) }) });
        // Upload what is already rendered first (a run cut short last time), then render and upload
        // a batch at a time.
        let made = 0, uploaded = 0, r = null;
        if (machine && books.length) { r = await push(); uploaded += r.uploaded; }
        while (books.length && !stopFlag) {
          setStatus({ text: made ? t('rendering — {made} passages so far', { made }) : t('loading the voice (the first time downloads it)…') });
          const n = await renderWindow(books, { voice: g.kokoroLive, hours, capBytes, max: BATCH, shouldStop: () => stopFlag,
            onProgress: (p) => setStatus({ text: t('rendering passage {n} — {title}', { n: made + p.made, title: p.title }) }) });
          made += n;
          if (!n) break;
          if (machine) { r = await push(); uploaded += r.uploaded; }
        }
        report.books = bookReport(books, { hours, capBytes }, r?.perBook);
        report.cloudMs = r ? report.books.reduce((s, b) => s + (b.inCloud ? b.ms * (b.inCloud / b.inWindow) : 0), 0) : null;
        if (!machine) notes.push(t('rendered {made} for this device (not the sync machine — nothing uploaded)', { made }));
        else if (books.length) notes.push(t('rendered {made}, uploaded {uploaded}', { made, uploaded }) + (r ? ` · ${t('cloud: {chunks} passages, {mb} MB', { chunks: r.chunks, mb: fmtNum(r.bytes / 1e6, 0, 0) })}` : ''));
      }
    }
    if (g.listenPull) {
      const r = await pullWindow(cfg, { onProgress: (p) => setStatus({ text: t('downloading {done}/{total}', { done: p.got, total: p.total }) }) });
      notes.push(r.skipped ? t('pull skipped — {reason}', { reason: r.skipped }) : t.n('pulled {n} clip', 'pulled {n} clips', r.got));
    }
    const n = await pruneHeard();
    if (n) notes.push(t('dropped {n} heard', { n }));
  } catch (e) {
    report.ok = false;
    notes.push(signedOut() ? t('not signed in to your cloud on this device — press Sign in') : t('failed: {error}', { error: e?.message || e }));
  }
  setStatus({ busy: false, report, text: notes.join(' · ') || t('nothing to do') });
}

// deps: { getGlobal: () => globalSettingsSnapshot }
export function startListenAgent(deps) {
  getGlobal = deps.getGlobal;
  const id = setInterval(() => { runListenNow().catch(() => {}); }, TICK_MS);
  const boot = setTimeout(() => { runListenNow().catch(() => {}); }, 20_000);
  return () => { clearInterval(id); clearTimeout(boot); stopFlag = true; };
}
