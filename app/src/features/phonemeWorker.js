// Pronunciation check worker: a wav2vec2 phoneme recogniser (espeak IPA, 8-bit, ~320 MB, downloaded
// once from Hugging Face and cached) hears the sounds you made; phonemizer (espeak-ng) gives the
// sounds the text expects, word by word; pronounce.js aligns and scores them.
// The model repo ships vocab.json but no tokenizer.json, so instead of the ASR pipeline we run the CTC
// model directly and greedy-decode its frames (best token per frame, repeats collapsed, blanks dropped).
// In: { id, pcm: Float32Array 16 kHz mono, words: [string], lang } → Out: { id, ok, result, heard }
import { AutoModelForCTC, AutoFeatureExtractor } from '@huggingface/transformers';
import { phonemize } from 'phonemizer';
import { tokenizeIpa, scorePronunciation } from './pronounce.js';

const ID = 'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX';
let readyP = null;
const load = () => (readyP ||= (async () => {
  const progress_callback = (p) => { if (p?.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ progress: Math.round(p.progress || 0) }); };
  const [model, fe, vocab] = await Promise.all([
    AutoModelForCTC.from_pretrained(ID, { dtype: 'q8', device: 'wasm', progress_callback }),
    AutoFeatureExtractor.from_pretrained(ID),
    fetch(`https://huggingface.co/${ID}/resolve/main/vocab.json`).then((r) => r.json()),
  ]);
  const byId = Object.fromEntries(Object.entries(vocab).map(([tok, i]) => [i, tok]));
  return { model, fe, byId, vocab: new Set(Object.keys(vocab).filter((t) => !/^[<[]/.test(t))) };
})().catch((e) => { readyP = null; throw e; }));

async function hear({ model, fe, byId }, pcm) {
  const { logits } = await model(await fe(pcm));
  const [, T, V] = logits.dims;
  const d = logits.data;
  const out = [];
  let prev = -1;
  for (let f = 0; f < T; f++) {
    let best = 0, bv = -Infinity;
    for (let v = 0; v < V; v++) { const x = d[f * V + v]; if (x > bv) { bv = x; best = v; } }
    const tok = byId[best];
    if (best !== prev && tok && !/^[<[]/.test(tok)) out.push(tok);
    prev = best;
  }
  return out;
}

self.onmessage = async (e) => {
  const { id, pcm, words, lang = 'en-us' } = e.data || {};
  try {
    const m = await load();
    const heard = await hear(m, pcm);
    const expected = [];
    for (const w of words) expected.push(tokenizeIpa((await phonemize(w, lang)).join(''), m.vocab));
    self.postMessage({ id, ok: true, result: scorePronunciation(expected, heard), heard: heard.join(' ') });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
