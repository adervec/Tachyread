// WPM sparkline data for the floating stats chip: cumulative new-words samples (recorded once a
// second by ReadingStats, which is mounted whenever stats are visible) → 15-second-averaged WPM
// buckets over the trailing 8 minutes, on a FIXED 0–1400 WPM scale so the shape is comparable
// across sessions. Stores live at module level keyed by tab id, so the history survives the chip
// being toggled / re-mounted. Pure math beyond the store — see wpmSpark.demo.mjs.

export const SPARK_SPAN_MS = 8 * 60000;
export const SPARK_BUCKET_MS = 15000;
export const SPARK_MAX_WPM = 1400;
export const SPARK_BUCKETS = SPARK_SPAN_MS / SPARK_BUCKET_MS; // 32

const stores = new Map(); // tabId → [{ t, words }] cumulative samples, pruned to the span

export function recordSpark(tabId, words, t = Date.now()) {
  let arr = stores.get(tabId);
  if (!arr) { arr = []; stores.set(tabId, arr); }
  const last = arr[arr.length - 1];
  if (last && words < last.words) arr.length = 0; // counter went backwards (new tracker) → restart
  arr.push({ t, words: words || 0 });
  const cutoff = t - SPARK_SPAN_MS - SPARK_BUCKET_MS;
  while (arr.length && arr[0].t < cutoff) arr.shift();
  return arr;
}

export function getSpark(tabId) {
  return stores.get(tabId) || [];
}

// The cumulative word count at time `t`, stepped from the samples (words before the first sample
// are unknown → treated as the first sample's value, i.e. zero delta).
function wordsAt(samples, t) {
  let w = samples[0].words;
  for (const s of samples) { if (s.t <= t) w = s.words; else break; }
  return w;
}

// 32 bucket values (oldest → newest), each the average WPM of one 15s window, clamped 0..1400.
export function sparkBuckets(samples, now = Date.now()) {
  const out = new Array(SPARK_BUCKETS).fill(0);
  if (!samples || !samples.length) return out;
  const perMin = 60000 / SPARK_BUCKET_MS; // 15s of words → per-minute rate (×4)
  for (let i = 0; i < SPARK_BUCKETS; i++) {
    const start = now - SPARK_SPAN_MS + i * SPARK_BUCKET_MS;
    const dw = wordsAt(samples, start + SPARK_BUCKET_MS) - wordsAt(samples, start);
    out[i] = Math.max(0, Math.min(SPARK_MAX_WPM, Math.round(dw * perMin)));
  }
  return out;
}

// SVG polyline points for the buckets in a W×H box (y = 0 at 1400 WPM, H at 0 WPM).
export function sparkPoints(buckets, W = 128, H = 28) {
  const n = buckets.length;
  return buckets.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - (v / SPARK_MAX_WPM) * H).toFixed(1)}`).join(' ');
}
