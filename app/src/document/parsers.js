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
// content (the Source view makes them tickable). Templates are handled separately (their content is
// spliced in), so they're NOT skipped here. Dialogs/menus/toolbars and their ARIA roles are chrome.
const SKIP_SEL = 'script,style,noscript,iframe,object,embed,canvas,svg,nav,button,select,'
  + 'input:not([type="checkbox"]),textarea,link,meta,title,dialog,'
  + '[role="dialog"],[role="menu"],[role="menubar"],[role="toolbar"],[role="tablist"],[role="search"],'
  + '[contenteditable],[hidden],[aria-hidden="true"]';
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

// The reading region of a page: the real prose, not the site chrome around it. Many self-contained
// "reader" HTML files wrap the whole book in <main> (or a run of <article>/<section> chapters) and
// surround it with a fixed header, a table-of-contents drawer (<nav>), footers, a TTS panel and
// settings overlays — all of which would otherwise pour into the word stream. Prefer <main>; else a
// wrapper of the article/section chapters; else the body.
// Text an element holds, counting the (inert) content of any <template> inside it — since those get
// spliced in. Lets us tell a real <main> from an empty <main> placeholder that a page fills via JS
// (some readers ship <main></main> and inject the chapters, which live as siblings in the static file).
function richTextLen(el) {
  let t = el.textContent || '';
  for (const tpl of el.querySelectorAll('template')) t += tpl.content ? (tpl.content.textContent || '') : '';
  return t.trim().length;
}
function pickContentRoot(dom) {
  const main = dom.querySelector('main');
  if (main && richTextLen(main) > 200) return main;
  // No <main>, or an empty <main> placeholder → gather the top-level article/section chapters
  // (skip ones nested inside another). This catches readers whose chapters sit as body siblings.
  const chapters = [...dom.querySelectorAll('article, section')]
    .filter((el) => !el.parentElement || !el.parentElement.closest('article, section'));
  if (chapters.length >= 2) {
    const wrap = dom.createElement('div');
    for (const el of chapters) wrap.appendChild(el.cloneNode(true));
    return wrap;
  }
  return dom.body;
}

// Splice each <template>'s inert content into the DOM where the template sits, so section text that a
// page renders client-side from templates is recovered too (DOMParser doesn't run scripts). Empty
// templates are dropped.
function expandTemplates(root) {
  for (const t of [...root.querySelectorAll('template')]) {
    const frag = t.content && t.content.cloneNode(true);
    if (frag && (frag.textContent || '').trim()) t.replaceWith(frag);
    else t.remove();
  }
}

// Parse an HTML string into { texts, htmls, toc }: sections split at chapter boundaries
// (article/section elements or top-level h1/h2), each with reading-order text and sanitized HTML.
function htmlToSections(htmlString) {
  const dom = new DOMParser().parseFromString(htmlString, 'text/html');
  // Keep the document's own CSS (its "theme") for the Source view — inline <style> only; external
  // stylesheets are never fetched.
  const styles = [...dom.querySelectorAll('style')].map((s) => s.textContent || '').join('\n');

  const root = pickContentRoot(dom);
  expandTemplates(root);
  // A collapsed <details> is hidden until expanded — keep only its <summary> label, drop the body,
  // so author notes / spoilers folded away by default don't leak into the reading text.
  for (const d of [...root.querySelectorAll('details:not([open])')]) {
    for (const c of [...d.childNodes]) if (!(c.nodeType === 1 && c.tagName === 'SUMMARY')) c.remove();
  }
  // Control rows: a small block built around a button/control (e.g. a "HOLD TO MARK READ" affordance)
  // is chrome, not prose — drop the wrapper so its instruction label doesn't leak. Task-list
  // checkboxes are excluded so their item text survives.
  for (const ctrl of [...root.querySelectorAll('button, select, textarea, input:not([type="checkbox"])')]) {
    const p = ctrl.parentElement;
    if (!p || p === root) continue;
    if ((p.textContent || '').trim().split(/\s+/).filter(Boolean).length <= 6) p.remove();
  }
  root.querySelectorAll(SKIP_SEL).forEach((el) => el.remove());

  // Group children into sections; an <article>/<section>, a top-level h1/h2, or a wrapper starting
  // with one begins a new section. A region with no such structure stays a single section.
  const sections = [];
  let cur = [];
  for (const child of [...root.children]) {
    const t = child.tagName;
    const startsChapter = /^(ARTICLE|SECTION)$/.test(t) || /^H[12]$/.test(t)
      || (child.firstElementChild && /^H[12]$/.test(child.firstElementChild.tagName) && child.children.length > 1);
    if (startsChapter && cur.length) { sections.push(cur); cur = []; }
    cur.push(child);
  }
  if (cur.length) sections.push(cur);
  if (!sections.length) sections.push([root]);

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

export function docFromHtmlString(htmlString, fileName) {
  const { texts, htmls, toc, styles } = htmlToSections(htmlString);
  const doc = readerDocFromText(texts.join('\n\n'), fileName);
  attachSegments(doc, texts, { kind: 'html', sections: htmls, styles });
  if (toc.length) doc.tocEntries = toc;
  return doc;
}

// A readable document name derived from a URL — its <title>/<h1> is preferred by the caller; this is
// the fallback: the last meaningful path segment, else the hostname.
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() || '';
    const base = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').trim();
    return base || u.hostname.replace(/^www\./, '');
  } catch {
    return 'Web page';
  }
}

// Turn fetched/pasted web content into an opened-ready doc. HTML (auto-detected, or forced via
// `asHtml`) goes through the same structure-aware pipeline as .html files (readability + source view
// + ToC); anything else is treated as plain text. A checksum is attached so openDoc can adopt it.
export async function docFromWebContent(content, { url = '', asHtml = null } = {}) {
  const looksHtml = asHtml != null ? asHtml : /<\/?(?:html|body|main|article|section|div|p|h[1-6]|ul|ol|table)\b/i.test(content);
  let doc;
  if (looksHtml) {
    const titleM = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1M = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = (titleM?.[1] || h1M?.[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    doc = docFromHtmlString(content, title || nameFromUrl(url));
  } else {
    doc = readerDocFromText(content.replace(/\r\n?/g, '\n'), nameFromUrl(url));
  }
  if (url) doc.sourceUrl = url;
  await attachChecksum(doc);
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
