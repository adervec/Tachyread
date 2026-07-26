// ponytail: the open-doc → Trackyread book builder (title cleanup + reading status + word/page est).
// Run: node src/features/trackyreadAdd.test.mjs
import assert from 'node:assert';
import { titleFromFileName, bookFromOpenedDoc } from './trackyreadAdd.js';
import { readStatus } from './journeyLibrary.js';

// title cleanup
assert.equal(titleFromFileName('The_Tower.epub'), 'The Tower', 'drops ext, underscores → spaces');
assert.equal(titleFromFileName('war.and.peace.txt'), 'war and peace', 'dots → spaces, ext removed');
assert.equal(titleFromFileName('Notes'), 'Notes', 'no extension is fine');
assert.equal(titleFromFileName(''), 'Untitled', 'empty → Untitled');
assert.equal(titleFromFileName('report.final.PDF'), 'report final', 'only the trailing ext is stripped');

// book building
const b = bookFromOpenedDoc({ fileName: 'My Book.pdf', words: 55000 });
assert.equal(b.title, 'My Book');
assert.equal(readStatus(b), 'reading', 'opened doc → currently reading');
assert.equal(b.words, 55000, 'word count carried');
assert.equal(b.pages, Math.round(55000 / 275), 'pages estimated from words');
assert.equal(b.recBy, '', 'a user add, not a Claude rec');
assert.ok(b.id && b.id.startsWith('bk:'), 'has a derived id');
// same title → same id (so opening the same doc twice won't duplicate the book)
assert.equal(bookFromOpenedDoc({ fileName: 'My Book.pdf' }).id, b.id, 'deterministic id by title');

// zero/unknown words → no bogus counts
const c = bookFromOpenedDoc({ fileName: 'x.txt', words: 0 });
assert.ok(!('words' in c) && !('pages' in c), 'no words → omit words/pages');

// status override
assert.equal(readStatus(bookFromOpenedDoc({ fileName: 'q.txt', status: 'queue' })), 'queue', 'status can be overridden');

console.log('trackyreadAdd: all cases pass');
