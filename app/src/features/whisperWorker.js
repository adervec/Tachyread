// Whisper speech recognition with WORD timestamps (Transformers.js, on-device WASM) for syncing your
// own audiobook to the book's text. The model (tiny ≈ 40 MB, base ≈ 80 MB, q8) downloads once from
// Hugging Face and the browser caches it.
// In:  { id, model, pcm: Float32Array (16 kHz mono), offsetMs }
// Out: { id, ok, words: [{ text, ms }] } | { id, ok:false, error } · { progress: 0–100 } while downloading
import { pipeline } from '@huggingface/transformers';

const pipes = new Map();
const load = (model) => {
  if (!pipes.has(model)) {
    pipes.set(model, pipeline('automatic-speech-recognition', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => { if (p?.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ progress: Math.round(p.progress || 0) }); },
    }).catch((e) => { pipes.delete(model); throw e; }));
  }
  return pipes.get(model);
};

self.onmessage = async (e) => {
  const { id, model, pcm, offsetMs = 0 } = e.data || {};
  try {
    const asr = await load(model);
    const out = await asr(pcm, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
    const words = (out.chunks || [])
      .filter((c) => c.text && Array.isArray(c.timestamp) && c.timestamp[0] != null)
      .map((c) => ({ text: c.text.trim(), ms: Math.round(offsetMs + c.timestamp[0] * 1000) }));
    self.postMessage({ id, ok: true, words });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
