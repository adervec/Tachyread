// OPDS catalogues (the Atom feeds Calibre, Komga, Project Gutenberg… publish): browse, search, and
// open books. Fetched straight from the browser, so it only works with servers that send CORS
// headers — Gutenberg's catalogue does (its files don't, so those get a Download link instead).
// ponytail: OPDS 1.x Atom, no login (Basic-auth catalogues need their CORS + a proxy we don't run).

export const DEFAULT_CATALOGS = [{ name: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks.opds/' }];

export const resolveUrl = (href, base) => { try { return new URL(href, base).href; } catch { return ''; } };

// Best acquisition link for reading here: EPUB, then PDF, then plain text, then HTML.
const RANK = [/epub/i, /pdf/i, /text\/plain/i, /html/i];
export function pickAcquisition(links) {
  const acq = (links || []).filter((l) => /opds-spec\.org\/acquisition/.test(l.rel || '') && l.href);
  const score = (l) => { const i = RANK.findIndex((re) => re.test(l.type || '')); return i < 0 ? 99 : i; };
  return [...acq].sort((a, b) => score(a) - score(b))[0] || null;
}
export const isNavLink = (l) => /opds-catalog|atom\+xml/i.test(l.type || '') && !/acquisition|image|search|self|alternate/.test(l.rel || '');

export const fillSearch = (template, q) => template.replace(/\{searchTerms\}/g, encodeURIComponent(q)).replace(/\{[^}]+\?\}/g, '');
export const fileNameFor = (title, link) => {
  const ext = /epub/i.test(link?.type || '') ? 'epub' : /pdf/i.test(link?.type || '') ? 'pdf' : /html/i.test(link?.type || '') ? 'html' : 'txt';
  return `${String(title || 'Book').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}.${ext}`;
};

// Atom feed text → { title, entries: [{ title, author, summary, nav, acq, thumb }], next, search }.
export function parseOpds(xml, base) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That address didn’t return an OPDS (Atom) catalogue.');
  const links = (el) => [...el.children].filter((c) => c.localName === 'link').map((l) => ({ rel: l.getAttribute('rel') || '', type: l.getAttribute('type') || '', href: resolveUrl(l.getAttribute('href') || '', base), title: l.getAttribute('title') || '' }));
  const text = (el, name) => [...el.children].find((c) => c.localName === name)?.textContent?.trim() || '';
  const feed = doc.documentElement;
  const fl = links(feed);
  const entries = [...feed.children].filter((c) => c.localName === 'entry').map((e) => {
    const ls = links(e);
    const author = [...e.children].filter((c) => c.localName === 'author').map((a) => text(a, 'name')).filter(Boolean).join(', ');
    return {
      title: text(e, 'title'), author, summary: (text(e, 'summary') || text(e, 'content')).slice(0, 300),
      nav: ls.find(isNavLink) || null, acq: pickAcquisition(ls),
      thumb: ls.find((l) => /image\/thumbnail|thumbnail/.test(l.rel) && !l.href.startsWith('data:'))?.href || '',
    };
  });
  return {
    title: text(feed, 'title'),
    entries,
    next: fl.find((l) => l.rel === 'next')?.href || '',
    search: fl.find((l) => l.rel === 'search') || null,
  };
}

// Known templates for catalogues whose OpenSearch description can't be fetched cross-origin
// (Gutenberg serves the feeds with CORS but not that description).
const KNOWN_SEARCH = { 'www.gutenberg.org': 'https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}' };
export const knownSearch = (url) => { try { return KNOWN_SEARCH[new URL(url).hostname] || ''; } catch { return ''; } };
// The OpenSearch URL template for a feed's search link (may need its description document).
export async function searchTemplate(searchLink, feedUrl = '') {
  if (!searchLink) return knownSearch(feedUrl);
  if (searchLink.href.includes('{searchTerms}')) return searchLink.href;
  const r = await fetch(searchLink.href).catch(() => null);
  if (!r?.ok) return knownSearch(feedUrl);
  const d = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const urls = [...d.getElementsByTagName('Url')];
  const u = urls.find((x) => /atom/i.test(x.getAttribute('type') || '')) || urls[0];
  return u ? resolveUrl(u.getAttribute('template') || '', searchLink.href) : knownSearch(feedUrl);
}
