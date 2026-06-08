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
