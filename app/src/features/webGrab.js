// Pure helpers for the "grab from a web URL" wizard. The actual fetch is impure and lives in the
// wizard; this is the URL munging (normalize a typed address, build the reader-service URL) so it
// can be checked without a network. See webGrab.demo.mjs.

// Accept what people actually paste: bare hostnames, missing scheme, stray whitespace. Returns a
// normalized absolute URL string, or '' if it can't be made into an http(s) URL.
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-z]+:\/\//i.test(s)) {
    // has a scheme — accept only http/https
    if (!/^https?:\/\//i.test(s)) return '';
  } else {
    s = 'https://' + s.replace(/^\/+/, '');
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.')) return ''; // reject "https://localhostish" typos without a TLD
    return u.href;
  } catch {
    return '';
  }
}

// A public CORS reader that returns the target page's RAW HTML with permissive headers, so a browser
// can read a cross-origin page the same-origin policy would otherwise block. Sending the URL here
// discloses it to that third party — the wizard gates this behind an explicit click.
export function proxyUrl(url) {
  return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
}

// Does a fetched Content-Type look like HTML (vs plain text / markdown)?
export function isHtmlContentType(ct) {
  return /text\/html|application\/xhtml/i.test(ct || '');
}

// Resolve a ToC link's href to an absolute, same-site http(s) URL (fragment stripped), or null if it
// isn't a followable off-page link — used when the structure picker follows a table-of-contents page's
// chapter links. Same-origin only (relevance + safety); in-page anchors / mailto / js are skipped. Pure.
export function resolveLink(href, baseUrl) {
  if (!href || /^\s*(#|javascript:|mailto:|tel:|data:)/i.test(href)) return null;
  let base = null;
  try { base = new URL(baseUrl); } catch { /* no base → treat href as absolute */ }
  let abs;
  try { abs = base ? new URL(href, base) : new URL(href); } catch { return null; }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
  if (base && abs.origin !== base.origin) return null; // same-site only
  abs.hash = '';
  return abs.href;
}

// Fetch a page's HTML, trying a direct read first (works for CORS-friendly sites) then the reader
// relay. `preferProxy` skips the direct attempt (once one link needed the relay, the rest will too).
// Impure (network) — lives here beside proxyUrl. Returns { text, viaProxy }.
export async function fetchPageText(url, { preferProxy = false } = {}) {
  if (!preferProxy) {
    try { const r = await fetch(url, { redirect: 'follow' }); if (r.ok) return { text: await r.text(), viaProxy: false }; } catch { /* fall through to relay */ }
  }
  const r = await fetch(proxyUrl(url));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { text: await r.text(), viaProxy: true };
}
