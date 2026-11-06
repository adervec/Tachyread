// On-device narration engines behind one interface: voice ids starting "kokoro:" go to Kokoro (a
// worker, loaded only when first used), everything else to Piper. { synth(text, voiceId) → Blob,
// recycle(), dispose() } — what the audiobook generator already expects from the Piper engine.
import { createPiperEngine } from './piperTts.js';

// Kokoro v1.0 English voices (a = American, b = British; f/m = female/male).
export const KOKORO_VOICES = [
  ['af_heart', 'Heart (US, female)'], ['af_bella', 'Bella (US, female)'], ['af_nicole', 'Nicole (US, female)'], ['af_sarah', 'Sarah (US, female)'],
  ['am_michael', 'Michael (US, male)'], ['am_fenrir', 'Fenrir (US, male)'], ['am_puck', 'Puck (US, male)'],
  ['bf_emma', 'Emma (UK, female)'], ['bf_isabella', 'Isabella (UK, female)'], ['bm_george', 'George (UK, male)'], ['bm_fable', 'Fable (UK, male)'],
].map(([id, label]) => ({ id: `kokoro:${id}`, label: `Kokoro — ${label}` }));

export const isKokoro = (voiceId) => String(voiceId || '').startsWith('kokoro:');
export const kokoroLabel = (voiceId) => KOKORO_VOICES.find((v) => v.id === voiceId)?.label || `Kokoro — ${String(voiceId).slice(7)}`;

function createKokoroEngine(onProgress) {
  let worker = null, seq = 0;
  const pending = new Map();
  const spawn = () => {
    worker = new Worker(new URL('./kokoroWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data?.progress != null) { onProgress?.(e.data.progress); return; }
      const p = pending.get(e.data?.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.blob); else p.reject(new Error(e.data.error));
    };
    worker.onerror = (ev) => { for (const p of pending.values()) p.reject(new Error(`Kokoro failed to start: ${ev.message || 'worker error'}`)); pending.clear(); worker = null; };
  };
  return {
    synth(text, voiceId) {
      if (!worker) spawn();
      return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, text, voice: String(voiceId).slice(7) }); });
    },
    // The model stays loaded across a run (no heap growth issue like Piper's) — recycle is a no-op.
    recycle() {},
    dispose() { if (worker) { try { worker.terminate(); } catch { /* gone */ } worker = null; } pending.clear(); },
  };
}

export function createLocalEngine({ onKokoroProgress } = {}) {
  let piper = null, kokoro = null;
  return {
    synth: (text, voiceId) => (isKokoro(voiceId)
      ? (kokoro ||= createKokoroEngine(onKokoroProgress)).synth(text, voiceId)
      : (piper ||= createPiperEngine()).synth(text, voiceId)),
    recycle: () => piper?.recycle(),
    dispose: () => { piper?.dispose(); kokoro?.dispose(); },
  };
}
