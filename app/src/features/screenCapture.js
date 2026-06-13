// Screen Capture API helpers for the Grab wizard — the browser analog of TextGrabber's
// screen-region capture. getDisplayMedia lets the user pick a screen/window/tab; we grab
// still frames (optionally cropped to a selection) and de-duplicate identical pages.

export function displayCaptureSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

export async function startDisplayCapture() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  return { stream, video };
}

export function stopCapture(stream) {
  if (stream) for (const t of stream.getTracks()) t.stop();
}

// Capture a frame to a canvas. crop is in *video pixel* coords ({x,y,w,h}) or null for full.
export function captureFrame(video, crop) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const c = crop && crop.w > 4 && crop.h > 4 ? crop : { x: 0, y: 0, w: vw, h: vh };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(c.w);
  canvas.height = Math.round(c.h);
  canvas.getContext('2d').drawImage(video, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  return canvas;
}

export function canvasToDataUrl(canvas, quality = 0.85) {
  return canvas.toDataURL('image/jpeg', quality);
}

// Tiny 16×16 grayscale signature for duplicate detection between consecutive grabs.
export function frameSignature(canvas) {
  const t = document.createElement('canvas');
  t.width = 16;
  t.height = 16;
  const ctx = t.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const sig = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const p = i * 4;
    sig[i] = (d[p] + d[p + 1] + d[p + 2]) / 3;
  }
  return sig;
}

// Mean absolute per-cell difference; < ~6 means effectively the same page.
export function signatureDiff(a, b) {
  if (!a || !b) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// Std-dev of a frame signature's cells — near 0 for a blank / uniform page (one flat colour),
// high for a dense text page. Lets the watch mode skip blank/near-empty frames.
export function signatureVariance(sig) {
  if (!sig || !sig.length) return 0;
  let mean = 0;
  for (let i = 0; i < sig.length; i++) mean += sig[i];
  mean /= sig.length;
  let v = 0;
  for (let i = 0; i < sig.length; i++) { const d = sig[i] - mean; v += d * d; }
  return Math.sqrt(v / sig.length);
}

const SIG_DIM = 16; // frameSignature is SIG_DIM×SIG_DIM, row-major

// Strongest single horizontal-row-band difference between two signatures. signatureDiff() averages
// over all 256 cells, so a change confined to the top or bottom edge of the region — one of 16 row
// bands — is diluted ~16× and can slip under the "still"/"duplicate" thresholds. This scores each
// row band on its own and returns the max, so edge-localised text changes are not missed.
export function signatureBandDiff(a, b) {
  if (!a || !b) return Infinity;
  let max = 0;
  for (let r = 0; r < SIG_DIM; r++) {
    let s = 0;
    for (let c = 0; c < SIG_DIM; c++) { const i = r * SIG_DIM + c; s += Math.abs(a[i] - b[i]); }
    const band = s / SIG_DIM;
    if (band > max) max = band;
  }
  return max;
}

// Max horizontal-contrast (std-dev) over the row bands. signatureVariance() takes the std over the
// whole frame, so a page with text only along the top or bottom edge reads as near-uniform and is
// wrongly skipped as blank; this stays high if ANY band holds text.
export function signatureBandVariance(sig) {
  if (!sig || !sig.length) return 0;
  let max = 0;
  for (let r = 0; r < SIG_DIM; r++) {
    let mean = 0;
    for (let c = 0; c < SIG_DIM; c++) mean += sig[r * SIG_DIM + c];
    mean /= SIG_DIM;
    let v = 0;
    for (let c = 0; c < SIG_DIM; c++) { const d = sig[r * SIG_DIM + c] - mean; v += d * d; }
    const std = Math.sqrt(v / SIG_DIM);
    if (std > max) max = std;
  }
  return max;
}
