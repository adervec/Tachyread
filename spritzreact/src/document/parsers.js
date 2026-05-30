// Document format parsers: TXT, DOCX (mammoth), PDF (pdf.js), EPUB (epub.js).
import { readerDocFromText, attachChecksum } from './readerDocument.js';

async function parseTxt(file) {
  const text = await file.text();
  return readerDocFromText(text, file.name);
}

async function parseDocx(file) {
  const mammoth = await import('mammoth/mammoth.browser.js');
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  const text = value || '';
  return readerDocFromText(text, file.name);
}

// Approximate token count matching readerDocFromText's tokenization (whitespace runs).
function tokenCount(text) {
  return (text.match(/\S+/g) || []).length;
}

// Build a word→segment map so the source-page view can sync to the reading position.
function attachSegments(doc, segmentTexts, source) {
  const map = new Uint32Array(doc.words.length);
  let wi = 0;
  for (let s = 0; s < segmentTexts.length; s++) {
    const n = tokenCount(segmentTexts[s]);
    for (let k = 0; k < n && wi < doc.words.length; k++) map[wi++] = s;
  }
  while (wi < doc.words.length) map[wi++] = Math.max(0, segmentTexts.length - 1);
  doc.wordToSegment = map;
  doc.segmentCount = segmentTexts.length;
  doc.source = source;
}

async function parsePdf(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  // Configure worker — Vite worker URL trick
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdfData = new Uint8Array(buf.slice(0)); // retained for side-by-side page rendering
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  const pageTexts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let lastY = null;
    let line = '';
    const lines = [];
    for (const item of tc.items) {
      const y = item.transform ? item.transform[5] : 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (line.trim()) lines.push(line.trim());
        line = '';
      }
      line += item.str + (item.hasEOL ? '\n' : ' ');
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    pageTexts.push(lines.join('\n'));
  }
  const doc = readerDocFromText(pageTexts.join('\n\n'), file.name);
  attachSegments(doc, pageTexts, { kind: 'pdf', pdfData, pageCount: pdf.numPages });
  return doc;
}

// Strip scripts and inline event handlers so retained EPUB HTML can be rendered safely.
function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

async function parseEpub(file) {
  const ePubModule = await import('epubjs');
  const ePub = ePubModule.default || ePubModule;
  const buf = await file.arrayBuffer();
  const book = ePub(buf);
  await book.ready;
  const out = [];
  const sections = []; // retained sanitized HTML per spine item for the source view
  const spine = book.spine.spineItems || [];
  for (const item of spine) {
    try {
      const sdoc = await item.load(book.load.bind(book));
      const html = sdoc?.body?.innerHTML || sdoc?.documentElement?.innerHTML || '';
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const text = tmp.innerText || tmp.textContent || '';
      out.push(text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim());
      sections.push(sanitizeHtml(html));
      item.unload();
    } catch {
      out.push('');
      sections.push('');
    }
  }
  const doc = readerDocFromText(out.join('\n\n'), file.name);
  attachSegments(doc, out, { kind: 'epub', sections });
  return doc;
}

export async function parseFile(file) {
  const name = (file.name || '').toLowerCase();
  let doc;
  if (name.endsWith('.docx')) doc = await parseDocx(file);
  else if (name.endsWith('.pdf')) doc = await parsePdf(file);
  else if (name.endsWith('.epub')) doc = await parseEpub(file);
  else doc = await parseTxt(file);
  await attachChecksum(doc);
  return doc;
}

export async function parseClipboardText() {
  const text = await navigator.clipboard.readText();
  const doc = readerDocFromText(text || '', 'Clipboard');
  await attachChecksum(doc);
  return doc;
}
