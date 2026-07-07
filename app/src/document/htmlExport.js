// "Print to HTML": turn any opened reader document (PDF / EPUB / DOCX / TXT / MD / grabbed) into a
// clean, well-structured HTML file — one <main>, real <h1>–<h6> from the ToC, <p> paragraphs — so it
// reads perfectly back in Tachyread AND is ideal to hand to Claude for restructuring. Pure; see
// htmlExport.demo.mjs.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function docToHtml(doc, title = 'Document') {
  const heads = (doc.tocEntries || []).slice().sort((a, b) => a.wordIndex - b.wordIndex);
  let hi = 0;
  const parts = [];
  let para = [];
  const flush = () => { if (para.length) { parts.push(`  <p>${esc(para.join(' '))}</p>`); para = []; } };
  for (const ln of doc.lines || []) {
    if (ln.isEmpty) { flush(); continue; }
    // A heading line: a ToC entry whose word falls within this line's word range.
    while (hi < heads.length && heads[hi].wordIndex < ln.startWordIndex) hi++;
    const isHead = hi < heads.length && heads[hi].wordIndex >= ln.startWordIndex && heads[hi].wordIndex <= ln.endWordIndex;
    if (isHead) {
      flush();
      const lvl = Math.min(6, (heads[hi].level || 0) + 1);
      parts.push(`  <h${lvl}>${esc((ln.text || '').trim() || heads[hi].title)}</h${lvl}>`);
      hi++;
      continue;
    }
    para.push((ln.text || '').trim());
  }
  flush();
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${esc(title)}</title>`,
    '  <style>',
    '    body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font: 16px/1.65 Georgia, "Times New Roman", serif; }',
    '    h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 .5em; }',
    '    p { margin: 0 0 1em; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    parts.join('\n'),
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// A copyable guide the user hands to Claude so generated / restructured HTML imports optimally.
export const HTML_AUTHORING_GUIDE = `# Structuring HTML for Tachyread (a speed-reading app)

Tachyread imports an HTML file, extracts the *reading text* (stripping site
chrome), and flows it into a reader with a synced Source view and an automatic
Table of Contents. To make an HTML document Tachyread reads perfectly, follow
these rules when generating or restructuring it:

## 1. Put all the prose in ONE <main>
Wrap the entire reading content in a single <main> element (or, for a
multi-chapter work, a run of sibling <article>/<section> chapters). Tachyread
prefers <main>; anything outside it is treated as chrome and dropped.

## 2. Use real headings for the Table of Contents
Chapter and section titles must be real <h1>-<h6> elements (h1 = top level,
h2 = section, h3+ = sub-section). Tachyread builds the ToC from them and splits
the book by them. Do NOT fake headings with bold <p> or styled <div>.

## 3. Keep chrome OUT of the content (or omit it)
Navigation, page headers/footers, sidebars, a "contents" drawer, buttons,
forms, and anything with role="dialog|menu|toolbar|search" is stripped. Best:
leave it out. If you must include it, put it OUTSIDE <main>.

## 4. Plain, semantic prose
Body text goes in <p> (and <ul>/<ol>/<li>, <blockquote>, <pre>, <table>).
Don't put readable text inside <nav>, <aside>, <button>, form controls,
hidden / aria-hidden elements, or a collapsed <details> (only its <summary>
survives).

## 5. Styling & scripts
Inline <style> is welcome — it's preserved in the Source view, so the page
keeps its look. External stylesheets and scripts are never fetched or run:
put the REAL text in the static HTML, not injected by JavaScript at runtime.

## 6. Task lists
<input type="checkbox"> items are kept and stay tickable in the Source view.

## Minimal skeleton
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Book</title>
<style>body{max-width:42rem;margin:2rem auto;font:16px/1.6 Georgia,serif}</style>
</head>
<body>
  <main>
    <h1>My Book</h1>
    <h2>Chapter One</h2>
    <p>...prose...</p>
    <h2>Chapter Two</h2>
    <p>...prose...</p>
  </main>
</body>
</html>
`;

// A ready prompt: the guide + the document's current HTML, asking Claude to restructure it.
export function restructurePrompt(doc, title) {
  return `Please restructure the HTML below so it imports optimally into Tachyread, following these rules. Return ONLY the restructured HTML, nothing else.

${HTML_AUTHORING_GUIDE}

--- CURRENT HTML (${title}) ---
${docToHtml(doc, title)}`;
}
