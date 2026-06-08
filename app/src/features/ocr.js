// OCR via tesseract.js (lazy-loaded WASM). The reader's "Grab Text" wizard uses this to
// turn captured screen regions or uploaded images into readable text — the browser analog of
// TextGrabber's Windows.Media.Ocr.
//
// Two assists layer on top of plain recognition:
//  • Layout templates — OCR a list of ordered regions (e.g. left/right columns) separately and
//    concatenate, so multi-column pages don't interleave into "DON'T DEAD OPEN INSIDE".
//  • Colour/contrast preprocessing — auto dark/light inversion + contrast (ported from
//    TextGrabber's EnhanceForOcr), or an explicit background/text colour binarization.

let _workerPromise = null;

async function getWorker() {
  if (!_workerPromise) {
    _workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng'); // downloads core+lang on first use
    })();
  }
  return _workerPromise;
}

export async function terminateOcr() {
  if (_workerPromise) {
    try {
      (await _workerPromise).terminate();
    } catch {
      /* noop */
    }
    _workerPromise = null;
  }
}

export function ocrSupported() {
  return typeof WebAssembly !== 'undefined';
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Average luma (sampled) → returns 0..1.
function averageBrightness(data, width, height) {
  const stepPx = Math.max(1, Math.floor(Math.min(width, height) / 64));
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += stepPx) {
    for (let x = 0; x < width; x += stepPx) {
      const p = (y * width + x) * 4;
      total += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      count++;
    }
  }
  return count ? total / count / 255 : 0.5;
}

// Returns a NEW canvas prepared for the recognizer, per `config`:
//   invert:   'auto' (detect dark-on-light) | 'on' | 'off'
//   contrast: multiplier around mid-grey (default 1.6; 1 = identity)
//   bgColor / textColor: optional hex. When BOTH are given, the image is binarized by nearest
//     colour (text → black, background → white) — best when you know the palette.
export function preprocessForOcr(srcCanvas, config = {}) {
  const { invert = 'auto', contrast = 1.6 } = config;
  const text = hexToRgb(config.textColor);
  const bg = hexToRgb(config.bgColor);
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const id = sctx.getImageData(0, 0, w, h);
  const d = id.data;
  let isDark = false;

  if (text && bg) {
    // Colour binarization: each pixel becomes black or white by which reference it's closer to.
    for (let i = 0; i < d.length; i += 4) {
      const dt = (d[i] - text[0]) ** 2 + (d[i + 1] - text[1]) ** 2 + (d[i + 2] - text[2]) ** 2;
      const db = (d[i] - bg[0]) ** 2 + (d[i + 1] - bg[1]) ** 2 + (d[i + 2] - bg[2]) ** 2;
      const v = dt <= db ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else {
    isDark = invert === 'on' ? true : invert === 'off' ? false : averageBrightness(d, w, h) < 0.5;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = d[i + c];
        if (isDark) v = 255 - v; // invert light-on-dark to dark-on-light for the recognizer
        v = (v - 128) * contrast + 128;
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(id, 0, 0);
  return { canvas: out, isDark };
}

// Normalize any image source to a full-resolution canvas.
async function toCanvas(src) {
  if (src instanceof HTMLCanvasElement) return src;
  const img = src instanceof HTMLImageElement ? src : await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

// Crop a fractional region ({fx,fy,fw,fh}) of a canvas into a new canvas (null = whole image).
function cropRegion(canvas, region) {
  if (!region) return canvas;
  const w = canvas.width;
  const h = canvas.height;
  const rx = Math.round(region.fx * w);
  const ry = Math.round(region.fy * h);
  const rw = Math.max(1, Math.round(region.fw * w));
  const rh = Math.max(1, Math.round(region.fh * h));
  const out = document.createElement('canvas');
  out.width = rw;
  out.height = rh;
  out.getContext('2d').drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
  return out;
}

// OCR an image with optional layout regions and preprocessing config.
//   regions: array of {fx,fy,fw,fh} (OCR'd separately, in order, joined by blank lines), or null
//   config:  preprocessForOcr config (see above)
export async function recognizeImageEx(src, { regions = null, config = {} } = {}) {
  const full = await toCanvas(src);
  const worker = await getWorker();
  const list = regions && regions.length ? regions : [null];
  const parts = [];
  for (const region of list) {
    const crop = cropRegion(full, region);
    const { canvas } = preprocessForOcr(crop, config);
    const { data } = await worker.recognize(canvas);
    parts.push((data.text || '').trim());
  }
  return { text: parts.filter(Boolean).join('\n\n') };
}

// Back-compat: OCR a whole image with auto preprocessing.
export async function recognizeImage(src) {
  return recognizeImageEx(src, {});
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
