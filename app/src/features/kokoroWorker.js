// Kokoro TTS worker (kokoro-js on Transformers.js, WASM). The ~90 MB quantised model downloads once
// from Hugging Face and the browser caches it; synthesis runs off the main thread so the app stays
// responsive. Messages: { id, text, voice } → { id, ok, blob } | { id, ok:false, error } and
// { progress: 0–100 } while the model downloads.
import { KokoroTTS } from 'kokoro-js';

let ttsP = null;
const load = () => (ttsP ||= KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8',
  device: 'wasm',
  progress_callback: (p) => { if (p?.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ progress: Math.round(p.progress || 0) }); },
}).catch((e) => { ttsP = null; throw e; }));

self.onmessage = async (e) => {
  const { id, text, voice } = e.data || {};
  try {
    const tts = await load();
    const audio = await tts.generate(text, { voice });
    self.postMessage({ id, ok: true, blob: audio.toBlob() });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
