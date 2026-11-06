// Self-check for openLibrary pure helpers. Run: node src/features/openLibrary.demo.mjs
import assert from 'node:assert';
import { olSearchUrl, pickOlMatch, olPatch, bookCoverUrl } from './openLibrary.js';

// olSearchUrl: ISBN wins; else fielded title+author; no title → null
assert.ok(olSearchUrl({ isbn: '978-0-441-17271-9' }).includes('q=isbn:9780441172719'));
assert.ok(olSearchUrl({ title: 'Dune', author: 'Frank Herbert' }).includes('title=Dune'));
assert.ok(olSearchUrl({ title: 'Dune', author: 'Frank Herbert' }).includes('author=Frank%20Herbert'));
assert.equal(olSearchUrl({ author: 'Nobody' }), null);

// pickOlMatch: requires title overlap + author last-name; prefers docs with cover/pages
const json = {
  docs: [
    { title: 'Dune Encyclopedia', author_name: ['Willis McNelly'], cover_i: 1 },
    { title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, number_of_pages_median: 412, cover_i: 44, isbn: ['9780441172719'] },
    { title: 'Dune', author_name: ['Someone Else'] },
  ],
};
const m = pickOlMatch(json, { title: 'Dune', author: 'Frank Herbert' });
assert.equal(m.cover_i, 44, 'picks the Herbert Dune');
assert.equal(pickOlMatch(json, { title: 'Totally Different Book', author: 'X' }), null, 'no forced match');

// olPatch: blanks-only fill
const p = olPatch({ title: 'Dune', pages: 500, pubDate: '' }, m);
assert.equal(p.pages, undefined, 'existing pages kept');
assert.equal(p.pubDate, '1965');
assert.equal(p.isbn, '9780441172719');
assert.equal(p.coverId, 44);

// bookCoverUrl: coverId beats isbn; nothing → null
assert.equal(bookCoverUrl({ coverId: 44 }), 'https://covers.openlibrary.org/b/id/44-M.jpg');
assert.ok(bookCoverUrl({ isbn: '9780441172719' }).includes('/b/isbn/9780441172719-M.jpg'));
assert.equal(bookCoverUrl({ title: 'x' }), null);
assert.equal(bookCoverUrl({ coverUrl: 'https://img.example/c.jpg', coverId: 44 }), 'https://img.example/c.jpg', 'custom cover URL wins');

// ISBN validation + result → book
{
  const { validIsbn, isbnBook } = await import('./openLibrary.js');
  assert.equal(validIsbn('978-0-441-01359-3'), '9780441013593');
  assert.equal(validIsbn('9780441013594'), null, 'bad check digit');
  assert.equal(validIsbn('0-441-01359-7'), '0441013597');
  assert.equal(validIsbn('080442957X'), '080442957X', 'X check digit');
  assert.equal(validIsbn('5012345678900'), null, 'a grocery EAN is not a book');
  assert.equal(validIsbn(''), null);
  assert.deepEqual(isbnBook({ docs: [{ title: 'Dune', author_name: ['Frank Herbert'], number_of_pages_median: 604, first_publish_year: 1965, cover_i: 7 }] }, '9780441013593'),
    { title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', fnf: 'F', type: 'long', genre: '', pages: 604, pubDate: '1965', coverId: 7 });
  assert.equal(isbnBook({ docs: [] }, 'x'), null);
}

console.log('openLibrary.demo: all assertions passed ✅');
