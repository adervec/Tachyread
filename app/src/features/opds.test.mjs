import assert from 'node:assert/strict';
import { pickAcquisition, isNavLink, fillSearch, resolveUrl, fileNameFor, knownSearch } from './opds.js';

const A = 'http://opds-spec.org/acquisition';
const links = [
  { rel: A, type: 'text/plain; charset=utf-8', href: 'https://x/1.txt' },
  { rel: A, type: 'application/epub+zip', href: 'https://x/1.epub' },
  { rel: `${A}/open-access`, type: 'application/pdf', href: 'https://x/1.pdf' },
  { rel: 'http://opds-spec.org/image/thumbnail', type: 'image/png', href: 'https://x/t.png' },
];
assert.equal(pickAcquisition(links).href, 'https://x/1.epub', 'EPUB first');
assert.equal(pickAcquisition(links.filter((l) => !/epub/.test(l.type))).href, 'https://x/1.pdf', 'then PDF (open-access rel counts)');
assert.equal(pickAcquisition([{ rel: 'alternate', href: 'h' }]), null);
assert.equal(isNavLink({ rel: 'subsection', type: 'application/atom+xml;profile=opds-catalog' }), true);
assert.equal(isNavLink({ rel: 'self', type: 'application/atom+xml' }), false);
assert.equal(isNavLink(links[1]), false);
assert.equal(fillSearch('https://g.org/search.opds/?query={searchTerms}&start={startIndex?}', 'dune messiah'), 'https://g.org/search.opds/?query=dune%20messiah&start=');
assert.equal(resolveUrl('/ebooks/1.epub', 'https://www.gutenberg.org/ebooks.opds/'), 'https://www.gutenberg.org/ebooks/1.epub');
assert.equal(fileNameFor('Pride: and "Prejudice"', { type: 'application/epub+zip' }), 'Pride and Prejudice.epub');
assert.equal(knownSearch('https://www.gutenberg.org/ebooks.opds/'), 'https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}');
assert.equal(knownSearch('https://my.calibre/opds'), '');
console.log('opds: all cases pass');
