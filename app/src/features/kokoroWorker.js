// Kokoro TTS worker (kokoro-js on Transformers.js, WASM). The ~90 MB quantised model downloads once
// from Hugging Face and the browser caches it; synthesis runs off the main thread so the app stays
// responsive. Messages: { id, text, voice } → { id, ok, blob } | { id, ok:false, error } and
// { progress: 0–100 } while the model downloads.
import { KokoroTTS } from 'kokoro-js';

const ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const progress_callback = (p) => { if (p?.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ progress: Math.round(p.progress || 0) }); };
let ttsP = null, dev = 'wasm';
const make = (device) => KokoroTTS.from_pretrained(ID, device === 'webgpu' ? { dtype: 'fp32', device, progress_callback } : { dtype: 'q8', device: 'wasm', progress_callback });
// WebGPU (fp32, ~330 MB once) renders ~15× real-time here vs ~1–2× on WASM — what makes rendering a
// listening window ahead practical. Only tried when an adapter exists; a GPU failure can still
// surface at FIRST synthesis (onnxruntime creates the session lazily), so onmessage falls back too.
const load = () => (ttsP ||= (async () => {
  const gpu = typeof navigator !== 'undefined' && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  if (gpu) { try { dev = 'webgpu'; return await make('webgpu'); } catch { /* fall back */ } }
  dev = 'wasm';
  return make('wasm');
})().catch((e) => { ttsP = null; throw e; }));

self.onmessage = async (e) => {
  const { id, text, voice } = e.data || {};
  try {
    let tts = await load();
    let audio;
    try { audio = await tts.generate(text, { voice }); }
    catch (err) {
      if (dev !== 'webgpu') throw err;
      dev = 'wasm'; ttsP = make('wasm'); tts = await ttsP; // the GPU path failed at first use → WASM for good
      audio = await tts.generate(text, { voice });
    }
    self.postMessage({ id, ok: true, blob: audio.toBlob() });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
