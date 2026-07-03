// Document format parsers: TXT, DOCX (mammoth), PDF (pdf.js), EPUB (epub.js), HTML, Markdown.
import { readerDocFromText, attachChecksum } from './readerDocument.js';
import { mdToHtml } from './markdown.js';

async function parseTxt(file, onProgress) {
  onProgress?.({ phase: 'Reading file' });
  const text = await file.text();
  onProgress?.({ phase: 'Building document' });
  return readerDocFromText(text, file.name);
}

async function parseDocx(file, onProgress) {
  onProgress?.({ phase: 'Loading DOCX engine' });
  const mammoth = await import('mammoth/mammoth.browser.js');
  const arrayBuffer = await file.arrayBuffer();
  onProgress?.({ phase: 'Extracting text' });
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  const text = value || '';
  onProgress?.({ phase: 'Building document' });
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

async function parsePdf(file, onProgress) {
  onProgress?.({ phase: 'Loading PDF engine' });
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
    onProgress?.({ phase: 'Extracting pages', done: p, total: pdf.numPages });
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
  onProgress?.({ phase: 'Building document' });
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

async function parseEpub(file, onProgress) {
  onProgress?.({ phase: 'Loading EPUB engine' });
  const ePubModule = await import('epubjs');
  const ePub = ePubModule.default || ePubModule;
  const buf = await file.arrayBuffer();
  const book = ePub(buf);
  await book.ready;
  const out = [];
  const sections = []; // retained sanitized HTML per spine item for the source view
  const spine = book.spine.spineItems || [];
  let si = 0;
  for (const item of spine) {
    onProgress?.({ phase: 'Extracting sections', done: ++si, total: spine.length });
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

// ── HTML & Markdown ───────────────────────────────────────────────────────────────────────────
// Both funnel through one structure-aware pipeline: (md →) HTML → clean DOM → reading-order
// plain text + exact TOC entries from the real h1–h6 headings + per-section sanitized HTML for
// the synced Source view. Scripts, styles, nav bars, hidden elements and comments contribute
// nothing to the word stream — formatting and hidden tagging can't leak into the reader.

// Elements that are chrome/machinery, not prose. Checkboxes are kept — task-list ticks are
// content (the Source view makes them tickable).
const SKIP_SEL = 'script,style,noscript,template,iframe,object,embed,canvas,svg,nav,button,select,input:not([type="checkbox"]),textarea,link,meta,title,[hidden],[aria-hidden="true"]';
// Elements whose boundaries are line breaks when flattening to text.
const BLOCK_RX = /^(P|DIV|SECTION|ARTICLE|MAIN|ASIDE|HEADER|FOOTER|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|DL|DT|DD|DETAILS|SUMMARY|H[1-6]|HR|ADDRESS)$/;

// Flatten an element's subtree into reading-order text. Paragraph-level blocks are separated by
// blank lines (the reader treats those as paragraph boundaries); table cells within a row are
// separated by a spaced em-dash so columns don't fuse into one pseudo-word. Headings are
// reported via onHeading(level, title, tokensBeforeHeading) for exact TOC entries.
function domToText(root, onHeading) {
  let out = '';
  let tokens = 0;
  const push = (s) => {
    if (!s) return;
    out += s;
    tokens += (s.match(/\S+/g) || []).length;
  };
  const blockBreak = () => { if (out && !out.endsWith('\n\n')) out = out.replace(/[ \t]+$/, '') + (out.endsWith('\n') ? '\n' : '\n\n'); };

  (function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      push(node.nodeValue.replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      blockBreak();
      const title = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (title) onHeading?.(Number(heading[1]), title, tokens);
      push(title);
      blockBreak();
      return;
    }
    if (tag === 'PRE') {
      blockBreak();
      push((node.textContent || '').replace(/\n{3,}/g, '\n\n').trim());
      blockBreak();
      return;
    }
    if (tag === 'TR') {
      blockBreak();
      const cells = [...node.children].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      push(cells.join(' — '));
      blockBreak();
      return;
    }
    const isBlock = BLOCK_RX.test(tag);
    if (isBlock) blockBreak();
    for (const child of node.childNodes) walk(child);
    if (isBlock) blockBreak();
  })(root);

  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), headings: null };
}

// Parse an HTML string into { texts, htmls, toc }: sections split at top-level h1/h2 boundaries
// (chapter-like source sync), each with reading-order text and sanitized HTML.
function htmlToSections(htmlString) {
  const dom = new DOMParser().parseFromString(htmlString, 'text/html');
  // Keep the document's own CSS (its "theme") for the Source view before stripping — inline
  // <style> only; external stylesheets are never fetched.
  const styles = [...dom.querySelectorAll('style')].map((s) => s.textContent || '').join('\n');
  dom.querySelectorAll(SKIP_SEL).forEach((el) => el.remove());
  const body = dom.body;

  // Group top-level children into sections; a top-level h1/h2 (or a wrapper starting with one)
  // begins a new section. A page with no such structure stays a single section.
  const sections = [];
  let cur = [];
  for (const child of [...body.children]) {
    const startsChapter = /^H[12]$/.test(child.tagName)
      || (child.firstElementChild && /^H[12]$/.test(child.firstElementChild.tagName) && child.children.length > 1);
    if (startsChapter && cur.length) { sections.push(cur); cur = []; }
    cur.push(child);
  }
  if (cur.length) sections.push(cur);
  if (!sections.length) sections.push([body]);

  const texts = [];
  const htmls = [];
  const toc = [];
  let globalTokens = 0;
  for (const nodes of sections) {
    const wrap = dom.createElement('div');
    for (const n of nodes) wrap.appendChild(n.cloneNode(true));
    const { text } = domToText(wrap, (level, title, tokensBefore) => {
      // h1→tier 0, h2→tier 1, h3+→tier 2 (the ToC uses three tiers)
      toc.push({ wordIndex: globalTokens + tokensBefore, title, level: Math.min(2, level - 1) });
    });
    texts.push(text);
    htmls.push(sanitizeHtml(wrap.innerHTML));
    globalTokens += (text.match(/\S+/g) || []).length;
  }
  return { texts, htmls, toc, styles };
}

function docFromHtmlString(htmlString, fileName) {
  const { texts, htmls, toc, styles } = htmlToSections(htmlString);
  const doc = readerDocFromText(texts.join('\n\n'), fileName);
  attachSegments(doc, texts, { kind: 'html', sections: htmls, styles });
  if (toc.length) doc.tocEntries = toc;
  return doc;
}

async function parseHtml(file, onProgress) {
  onProgress?.({ phase: 'Converting HTML' });
  const doc = docFromHtmlString(await file.text(), file.name);
  onProgress?.({ phase: 'Building document' });
  return doc;
}

async function parseMarkdown(file, onProgress) {
  onProgress?.({ phase: 'Rendering Markdown' });
  const doc = docFromHtmlString(mdToHtml(await file.text()), file.name);
  onProgress?.({ phase: 'Building document' });
  return doc;
}

// onProgress({ phase, done?, total? }) drives the import wizard's progress bars.
export async function parseFile(file, onProgress) {
  const name = (file.name || '').toLowerCase();
  let doc;
  if (name.endsWith('.docx')) doc = await parseDocx(file, onProgress);
  else if (name.endsWith('.pdf')) doc = await parsePdf(file, onProgress);
  else if (name.endsWith('.epub')) doc = await parseEpub(file, onProgress);
  else if (name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.xhtml')) doc = await parseHtml(file, onProgress);
  else if (name.endsWith('.md') || name.endsWith('.markdown')) doc = await parseMarkdown(file, onProgress);
  else doc = await parseTxt(file, onProgress);
  onProgress?.({ phase: 'Indexing & fingerprinting' });
  await attachChecksum(doc);
  return doc;
}

export async function parseClipboardText() {
  const text = await navigator.clipboard.readText();
  const doc = readerDocFromText(text || '', 'Clipboard');
  await attachChecksum(doc);
  return doc;
}
