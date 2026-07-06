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
