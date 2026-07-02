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
let _workerLang = null;

// One cached worker; switching language tears it down and spins up a new one (a tesseract
// worker is bound to its traineddata, which downloads on first use per language).
async function getWorker(lang = 'eng') {
  if (_workerPromise && _workerLang !== lang) await terminateOcr();
  if (!_workerPromise) {
    _workerLang = lang;
    _workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker(lang); // downloads core+lang on first use
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

// ── OCR profiles ──────────────────────────────────────────────────────────────────────────────
// A profile is a set of user-supplied character samples. They aid recognition two ways:
//  1. Whitelist — constrain tesseract's output alphabet to exactly the characters you provided.
//  2. Template match — for any glyph tesseract is unsure about, compare its shape against your
//     samples and substitute the best match. Categories are prioritised alphabetic > numeric >
//     punctuation > symbol on a tie, so common letters win ambiguous cases.
const TPL = 24; // normalized glyph template size (px square)
const CAT_ORDER = { alpha: 0, num: 1, punct: 2, symbol: 3 };

export function glyphCategory(ch) {
  if (/[A-Za-z]/.test(ch)) return 'alpha';
  if (/[0-9]/.test(ch)) return 'num';
  if (/[.,;:!?'"`()[\]{}<>/\\|@#%^&*_=+~$£€-]/.test(ch)) return 'punct';
  return 'symbol';
}

// Normalize a glyph (a crop rect of a canvas, or a whole sample image) to a TPL×TPL ink mask,
// centred on its ink bounds so size/position don't matter. Returns null for a blank crop.
async function normalizeGlyph(src, rect) {
  const canvas = src instanceof HTMLCanvasElement ? src : await toCanvas(src);
  const sx = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const sy = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const sw = Math.max(1, (rect ? Math.min(canvas.width, Math.ceil(rect.x1)) : canvas.width) - sx);
  const sh = Math.max(1, (rect ? Math.min(canvas.height, Math.ceil(rect.y1)) : canvas.height) - sy);
  const WS = 48;
  const work = document.createElement('canvas');
  work.width = WS; work.height = WS;
  const wc = work.getContext('2d', { willReadFrequently: true });
  wc.fillStyle = '#fff'; wc.fillRect(0, 0, WS, WS);
  wc.drawImage(canvas, sx, sy, sw, sh, 0, 0, WS, WS);
  const d = wc.getImageData(0, 0, WS, WS).data;
  const g = new Float32Array(WS * WS);
  let mean = 0;
  for (let i = 0; i < WS * WS; i++) { const p = i * 4; const v = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; g[i] = v; mean += v; }
  mean /= WS * WS;
  const thr = mean * 0.92; // darker than ~mean = ink (works on the already-binarized/preprocessed canvas too)
  const mask = new Uint8Array(WS * WS);
  let minX = WS, minY = WS, maxX = -1, maxY = -1, ink = 0;
  for (let y = 0; y < WS; y++) for (let x = 0; x < WS; x++) {
    if (g[y * WS + x] < thr) { mask[y * WS + x] = 1; ink++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (ink < 2 || maxX < minX) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const scale = (TPL - 4) / Math.max(bw, bh);
  const offX = Math.floor((TPL - bw * scale) / 2), offY = Math.floor((TPL - bh * scale) / 2);
  const out = new Uint8Array(TPL * TPL);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!mask[y * WS + x]) continue;
    const tx = offX + Math.round((x - minX) * scale), ty = offY + Math.round((y - minY) * scale);
    if (tx >= 0 && tx < TPL && ty >= 0 && ty < TPL) out[ty * TPL + tx] = 1;
  }
  return out;
}

function jaccard(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { const u = a[i] | b[i]; if (u) { uni++; if (a[i] & b[i]) inter++; } }
  return uni ? inter / uni : 0;
}

// Compile a stored profile ({ glyphs:[{ch,cat,samples:[dataURL]}], whitelist, templates, ... }) into
// a whitelist string + per-character ink templates. Returns null if there's nothing usable.
export async function compileOcrProfile(profile) {
  if (!profile || !Array.isArray(profile.glyphs) || !profile.glyphs.length) return null;
  const byChar = [];
  let whitelist = '';
  for (const gph of profile.glyphs) {
    const ch = (gph.ch || '').slice(0, 1);
    if (!ch) continue;
    if (!whitelist.includes(ch)) whitelist += ch;
    const templates = [];
    for (const sample of (gph.samples || [])) {
      try { const t = await normalizeGlyph(sample, null); if (t) templates.push(t); } catch { /* skip bad sample */ }
    }
    byChar.push({ ch, cat: gph.cat || glyphCategory(ch), templates });
  }
  return {
    whitelist,
    byChar: byChar.filter((c) => c.templates.length),
    useWhitelist: profile.whitelist !== false && !!whitelist,
    useTemplates: profile.templates !== false,
    conf: Number(profile.confThreshold) || 70,
    match: Number(profile.matchThreshold) || 0.6,
  };
}

function bestProfileChar(glyph, compiled) {
  let best = null, bestScore = 0;
  for (const c of compiled.byChar) {
    let s = 0;
    for (const t of c.templates) { const j = jaccard(glyph, t); if (j > s) s = j; }
    if (s > bestScore + 1e-6 || (best && Math.abs(s - bestScore) <= 0.04 && CAT_ORDER[c.cat] < CAT_ORDER[best.cat])) { best = c; bestScore = s; }
  }
  return best ? { ch: best.ch, score: bestScore } : null;
}

// Walk tesseract's symbol hierarchy; substitute the profile's best-matching character for any glyph
// below the confidence threshold. Rebuilds text only if something actually changed (else keep tesseract's).
async function correctWithTemplates(canvas, data, compiled) {
  let changed = false;
  const lines = [];
  for (const block of (data.blocks || [])) {
    for (const para of (block.paragraphs || [])) {
      for (const line of (para.lines || [])) {
        const words = [];
        for (const word of (line.words || [])) {
          let wtext = '';
          for (const sym of (word.symbols || [])) {
            let ch = sym.text || '';
            const bb = sym.bbox;
            if (ch.length === 1 && bb && (sym.confidence ?? 100) < compiled.conf) {
              const glyph = await normalizeGlyph(canvas, { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 });
              const m = glyph && bestProfileChar(glyph, compiled);
              if (m && m.score >= compiled.match && m.ch !== ch) { ch = m.ch; changed = true; }
            }
            wtext += ch;
          }
          words.push(wtext || (word.text || ''));
        }
        lines.push(words.join(' '));
      }
    }
  }
  const rebuilt = lines.join('\n').trim();
  return changed && rebuilt ? rebuilt : (data.text || '').trim();
}

// OCR an image with optional layout regions, preprocessing config, and an OCR profile.
//   regions: array of {fx,fy,fw,fh} (OCR'd separately, in order, joined by blank lines), or null
//   config:  preprocessForOcr config (see above)
//   profile: optional OCR profile (whitelist + template-match assist)
//   lang:    tesseract language code (state/languages.js `tess`), default English
export async function recognizeImageEx(src, { regions = null, config = {}, profile = null, lang = 'eng' } = {}) {
  const full = await toCanvas(src);
  const worker = await getWorker(lang);
  const compiled = profile ? await compileOcrProfile(profile) : null;
  const wantBlocks = !!(compiled && compiled.useTemplates && compiled.byChar.length);
  if (compiled && compiled.useWhitelist) {
    try { await worker.setParameters({ tessedit_char_whitelist: compiled.whitelist }); } catch { /* engine may not accept it */ }
  }
  const list = regions && regions.length ? regions : [null];
  const parts = [];
  try {
    for (const region of list) {
      const crop = cropRegion(full, region);
      const { canvas } = preprocessForOcr(crop, config);
      let data;
      try {
        ({ data } = await worker.recognize(canvas, {}, wantBlocks ? { blocks: true } : undefined));
      } catch {
        ({ data } = await worker.recognize(canvas)); // fall back if this build rejects the output option
      }
      let text = (data.text || '').trim();
      if (wantBlocks && data.blocks) {
        try { text = await correctWithTemplates(canvas, data, compiled); } catch { /* keep plain text */ }
      }
      parts.push(text);
    }
  } finally {
    if (compiled && compiled.useWhitelist) {
      try { await worker.setParameters({ tessedit_char_whitelist: '' }); } catch { /* ignore */ }
    }
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
