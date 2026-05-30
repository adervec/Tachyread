// OCR via tesseract.js (lazy-loaded WASM). The reader's "Grab Text" wizard uses this to
// turn captured screen regions or uploaded images into readable text — the browser analog of
// TextGrabber's Windows.Media.Ocr. Dark-mode-aware contrast preprocessing is ported from
// TextGrabber's EnhanceForOcr / ComputeAverageBrightness.

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

// Returns a NEW canvas with contrast boosted (and inverted for dark-on-light source), plus
// the detected isDark flag. Mirrors TextGrabber's EnhanceForOcr (contrast 1.6, invert if dark).
export function preprocessForOcr(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const id = sctx.getImageData(0, 0, w, h);
  const d = id.data;
  const isDark = averageBrightness(d, w, h) < 0.5;
  const contrast = 1.6;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = d[i + c];
      if (isDark) v = 255 - v; // invert light-on-dark to dark-on-light for the recognizer
      v = (v - 128) * contrast + 128;
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(id, 0, 0);
  return { canvas: out, isDark };
}

// OCR an image source (canvas / dataURL / HTMLImageElement). Applies preprocessing first.
export async function recognizeImage(src) {
  let canvas = src;
  if (!(src instanceof HTMLCanvasElement)) {
    const img = src instanceof HTMLImageElement ? src : await loadImage(src);
    canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
  }
  const { canvas: prepped, isDark } = preprocessForOcr(canvas);
  const worker = await getWorker();
  const { data } = await worker.recognize(prepped);
  return { text: (data.text || '').trim(), lineCount: (data.lines || []).length, isDark };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
