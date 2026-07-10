// Self-check for textMeta. Run: node src/features/textMeta.demo.mjs
import assert from 'node:assert';
import { extractTextMeta } from './textMeta.js';

// Project Gutenberg header
const pg = extractTextMeta(`The Project Gutenberg eBook of The Complete Works of William Shakespeare

Title: The Complete Works of William Shakespeare

Author: William Shakespeare

Release date: January 1, 1994 [eBook #100]`);
assert.equal(pg.title, 'The Complete Works of William Shakespeare');
assert.equal(pg.author, 'William Shakespeare');
assert.equal(pg.year, 1994);

// Copyright page with ISBN-13 (dashed) + © year
const cp = extractTextMeta(`THE MARTIAN\n\nby Andy Weir\n\nCopyright © 2011 by Andy Weir\nISBN 978-0-8041-3902-1\nPrinted in the USA`);
assert.equal(cp.author, 'Andy Weir');
assert.equal(cp.year, 2011);
assert.equal(cp.isbn, '9780804139021');

// ISBN-10 with X check digit; "First published"
const old = extractTextMeta(`First published 1959.\nISBN: 043942089X`);
assert.equal(old.year, 1959);
assert.equal(old.isbn, '043942089X'.replace(/[^0-9xX]/g, ''));

// Conservative: no explicit phrasing → no year; junk ISBN length → dropped; prose "by the" not an author
const none = extractTextMeta('It was the best of times in 1775, said the man. ISBN 12-34. Written by the fireside.');
assert.equal(none.year, undefined);
assert.equal(none.isbn, undefined);
assert.equal(none.author, undefined);

console.log('textMeta.demo: all assertions passed ✅');
