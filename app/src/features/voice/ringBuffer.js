// Rolling "last few minutes" audio for reading aloud: a fixed Float32 ring that overwrites its oldest
// samples, so memory stays flat however long you read. Memory only — gone on reload.

export function createRing(seconds, rate) {
  const buf = new Float32Array(Math.round(seconds * rate));
  let w = 0, filled = 0;
  return {
    rate,
    push(x) {
      for (let i = 0; i < x.length; i++) { buf[w] = x[i]; w = (w + 1) % buf.length; }
      filled = Math.min(buf.length, filled + x.length);
    },
    read() { // oldest → newest
      const out = new Float32Array(filled);
      const start = (w - filled + buf.length) % buf.length;
      for (let i = 0; i < filled; i++) out[i] = buf[(start + i) % buf.length];
      return out;
    },
    seconds: () => filled / rate,
  };
}

// Block-average by k (a crude low-pass) — speech at ~16 kHz is plenty to hear how you sound.
export function downsample(x, k) {
  if (k <= 1) return Float32Array.from(x);
  const out = new Float32Array(Math.floor(x.length / k));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += x[i * k + j];
    out[i] = s / k;
  }
  return out;
}
