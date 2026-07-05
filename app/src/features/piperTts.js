// Offline neural text-to-speech via Piper (VITS) running in-browser through @diffusionstudio/
// vits-web (ONNX Runtime WASM). Unlike the native Web Speech engine — which Android suspends the
// instant the screen locks — Piper produces a real WAV Blob we play through an <audio> element,
// which keeps playing with the screen off and drives the lock-screen media controls.
//
// The engine + phonemizer WASM load from a CDN; each voice model (~15-30 MB) downloads once from
// HuggingFace and is cached in the browser's OPFS. So: needs network the first time per voice,
// fully offline after. The whole module (and the heavy ORT dependency) is lazy-imported — nothing
// loads until the user turns on offline voice.

let libPromise = null;
function lib() {
  libPromise = libPromise || import('@diffusionstudio/vits-web');
  return libPromise;
}

// A curated English picker; every other language auto-maps to a good Piper voice below.
export const ENGLISH_VOICES = [
  { id: 'en_US-hfc_female-medium', label: 'English (US) — female' },
  { id: 'en_US-hfc_male-medium', label: 'English (US) — male' },
  { id: 'en_US-amy-medium', label: 'English (US) — Amy' },
  { id: 'en_GB-alba-medium', label: 'English (UK) — female' },
  { id: 'en_GB-northern_english_male-medium', label: 'English (UK) — male' },
];

// App document-language code → a Piper voice. Languages Piper lacks (hi/ja/ko/hr) fall back to
// English so the feature still works (the words are just spoken with an English model).
const VOICE_BY_LANG = {
  en: 'en_US-hfc_female-medium', ar: 'ar_JO-kareem-medium', cs: 'cs_CZ-jirka-medium',
  nl: 'nl_BE-nathalie-medium', fr: 'fr_FR-mls-medium', de: 'de_DE-mls-medium',
  hu: 'hu_HU-anna-medium', it: 'it_IT-riccardo-x_low', pl: 'pl_PL-darkman-medium',
  pt: 'pt_BR-faber-medium', ro: 'ro_RO-mihai-medium', ru: 'ru_RU-denis-medium',
  sl: 'sl_SI-artur-medium', es: 'es_ES-davefx-medium', tr: 'tr_TR-dfki-medium',
  uk: 'uk_UA-ukrainian_tts-medium', zh: 'zh_CN-huayan-medium', hr: 'sr_RS-serbski_institut-medium',
};
export function defaultVoiceForLang(langCode) {
  return VOICE_BY_LANG[langCode] || 'en_US-hfc_female-medium';
}

export function piperSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && typeof WebAssembly !== 'undefined';
}

// Synthesize text → a WAV Blob (for saving into the audiobook store).
export async function synthToBlob(text, voiceId) {
  const tts = await lib();
  return tts.predict({ text: text.trim(), voiceId });
}

// Worker-backed synth engine for BATCH generation (the audiobook manager). synth() one chunk at a
// time; recycle() terminates the worker — freeing the whole ONNX WASM heap, which otherwise only
// grows until "Can't create a session / failed to allocate a buffer" — and the next synth spawns a
// fresh one. Falls back to main-thread predict if the worker can't run vits-web in this browser.
export function createPiperEngine() {
  let worker = null;
  let seq = 0;
  let fallback = false;
  const pending = new Map();
  function spawn() {
    worker = new Worker(new URL('./piperWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data?.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.blob); else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      fallback = true; // worker path unusable here → subsequent synths run on the main thread
      for (const p of pending.values()) p.reject(new Error('Piper worker failed to start.'));
      pending.clear();
      try { worker.terminate(); } catch { /* already dead */ }
      worker = null;
    };
  }
  async function synth(text, voiceId) {
    if (fallback) return synthToBlob(text, voiceId);
    if (!worker) spawn();
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, text, voiceId });
    });
  }
  function recycle() {
    if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
    for (const p of pending.values()) p.reject(new Error('Piper engine recycled.'));
    pending.clear();
  }
  return { synth, recycle, dispose: recycle };
}

// Synthesize text → a WAV object URL (caller revokes it). Downloads the model on first use.
export async function synthToUrl(text, voiceId) {
  return URL.createObjectURL(await synthToBlob(text, voiceId));
}

// Pre-download a voice model into OPFS. onProgress(fraction 0..1) reports the download.
export async function downloadVoice(voiceId, onProgress) {
  const tts = await lib();
  const stored = await tts.stored();
  if (stored.includes(voiceId)) { onProgress?.(1); return; }
  await tts.download(voiceId, (p) => onProgress?.(p.total ? p.loaded / p.total : 0));
}

export async function isVoiceDownloaded(voiceId) {
  try { const tts = await lib(); return (await tts.stored()).includes(voiceId); } catch { return false; }
}

// Voice ids already downloaded to this device (for the audiobook manager's voice picker).
export async function installedVoices() {
  try { const tts = await lib(); return await tts.stored(); } catch { return []; }
}

// A friendly label for a Piper voice id (curated English names, else a prettified id).
export function voiceLabel(id) {
  if (!id) return 'unknown voice';
  const e = ENGLISH_VOICES.find((v) => v.id === id);
  return e ? e.label : id.replace(/_/g, ' ').replace(/-/g, ' · ');
}
