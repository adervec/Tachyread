// Piper synthesis worker. Exists so audiobook generation can RECYCLE the engine between batches:
// onnxruntime-web's WASM heap only ever grows, and after ~50 syntheses in one context allocation
// fails ("Can't create a session … failed to allocate a buffer of size N"). Terminating a worker
// returns every byte to the OS; the voice models live in OPFS (origin-scoped), so a fresh worker
// starts instantly without re-downloading anything.
import * as tts from '@diffusionstudio/vits-web';

self.onmessage = async (e) => {
  const { id, text, voiceId } = e.data || {};
  try {
    const blob = await tts.predict({ text, voiceId });
    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
