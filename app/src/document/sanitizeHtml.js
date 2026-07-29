// Strip executable / dangerous content from retained document HTML (EPUB spine items, HTML/Markdown
// source sections) before it's rendered. The EPUB source view injects this via dangerouslySetInnerHTML
// into the SAME-ORIGIN app DOM (unlike the HTML source, which is origin-isolated in a sandboxed
// iframe), so a malicious EPUB could otherwise run script in the app origin and read IndexedDB /
// localStorage (reading history, notes, stored API keys). This must remove not just <script> but every
// element that can execute or load code, and every inline handler / dangerous URI scheme.
//
// Regex-based so it runs anywhere (incl. node tests). It closes the demonstrated auto-exec vectors
// (iframe srcdoc, object/embed data, on* handlers, javascript:/vbscript:/data:text-html). Legitimate
// content — text, headings, images, tables, links, inline <style> — is preserved. Pure; see test.

// Tags that can execute or load code, or reframe the document — removed WITH their content.
const DANGEROUS_TAGS = 'script|iframe|object|embed|frame|frameset|applet|base|meta|link|svg|math|template|noscript';

export function sanitizeHtml(html) {
  return String(html == null ? '' : html)
    // remove dangerous elements including everything between their tags (non-greedy, back-referenced)
    .replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[\\s\\S]*?</\\1\\s*>`, 'gi'), '')
    // …and any stray self-closing / unclosed remnants of those same tags
    .replace(new RegExp(`</?(?:${DANGEROUS_TAGS})\\b[^>]*>`, 'gi'), '')
    // strip EVERY inline event handler — quoted OR unquoted (on click/error/load/…)
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // srcdoc can carry a whole nested document; the structure picker's index attr is never shown
    .replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sdata-tx-idx="[^"]*"/gi, '')
    // neutralize dangerous URI schemes anywhere they appear (attr values), whitespace-tolerant
    .replace(/(?:javascript|vbscript)\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:');
}
