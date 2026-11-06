import assert from 'node:assert/strict';
import { parseCsv, detectSource, rowToBook, planShelfImport } from './shelfImport.js';

const gr = [
  'Book Id,Title,Author,Author l-f,ISBN,ISBN13,My Rating,Number of Pages,Year Published,Original Publication Year,Date Read,Bookshelves,Exclusive Shelf,My Review,Private Notes',
  '1,Dune,Frank Herbert,"Herbert, Frank","=""0441013597""","=""9780441013593""",5,604,2005,1965,2024/04/02,"read, sci-fi",read,"Spice, sand.\nGreat.",',
  '2,"Emma",Jane Austen,"Austen, Jane",="",="",0,,,1815,,to-read,to-read,,',
  '3,Ulysses,James Joyce,"Joyce, James",,,0,730,,1922,,"currently-reading",currently-reading,,',
].join('\r\n');
const rows = parseCsv(gr);
assert.equal(rows.length, 3);
assert.equal(rows[0]['My Review'], 'Spice, sand.\nGreat.', 'quoted comma + newline kept');
assert.equal(detectSource(rows), 'goodreads');
const dune = rowToBook(rows[0], 'goodreads');
assert.deepEqual(
  { title: dune.title, author: dune.author, isbn: dune.isbn, rating: dune.rating, pages: dune.pages, pubYear: dune.pubYear, completion: dune.completion, finishTime: dune.finishTime, tags: dune.tags, id: dune.id },
  { title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', rating: 5, pages: 604, pubYear: 1965, completion: true, finishTime: '2024-04-02', tags: ['sci-fi'], id: 'isbn:9780441013593' },
);
const emma = rowToBook(rows[1], 'goodreads');
assert.equal(emma.isbn, undefined, 'empty ="" ISBN dropped');
assert.equal(emma.completion, undefined, 'to-read sets no status');
assert.equal(rowToBook(rows[2], 'goodreads').inProgress, true);

const sg = parseCsv('Title,Authors,ISBN/UID,Read Status,Dates Read,Star Rating,Tags\nDune,"Frank Herbert, Brian Herbert",9780441013593,read,"2021/03/01-2021/03/20, 2024/01/02-2024/02/01",4.5,desert\nX,Y,abc,did-not-finish,,,\n');
assert.equal(detectSource(sg), 'storygraph');
const sd = rowToBook(sg[0], 'storygraph');
assert.equal(sd.author, 'Frank Herbert');
assert.equal(sd.finishTime, '2024-02-01');
assert.deepEqual(sd.finishHistory, ['2021-03-20'], 'earlier readings → re-read history');
assert.equal(sd.rating, 4.5);
assert.equal(rowToBook(sg[1], 'storygraph').shelf, 'abandoned');

// planning: never overwrite, only fill blanks
const library = [
  { id: 'isbn:9780441013593', title: 'Dune', author: 'Frank Herbert', rating: 4, completion: true, finishTime: '2024-04-01', notes: 'mine' },
  { id: 'bk:x', title: 'Emma', author: 'J. Austen' },
];
const plan = planShelfImport([dune, emma, rowToBook(rows[2], 'goodreads')], library);
assert.deepEqual(plan.map((p) => p.action), ['fill', 'fill', 'new']);
assert.deepEqual(plan[1].fills, ['pubYear'], 'Emma: only the publication year was missing');
assert.equal(planShelfImport([emma], [{ id: 'bk:x', title: 'Emma', author: 'Jane Austen', pubYear: 1815 }])[0].action, 'same', 'nothing new → untouched');
assert.deepEqual(plan[0].fills, ['isbn', 'pages', 'pubYear', 'tags'], 'only blanks filled');
assert.equal(plan[0].book.rating, 4, 'your rating kept');
assert.equal(plan[0].book.finishTime, '2024-04-01', 'your finish date kept');
assert.equal(plan[0].book.notes, 'mine', 'your notes kept');
assert.equal(plan[0].book.pages, 604);
assert.equal(plan[1].match.id, 'bk:x', 'matched by title + author surname despite "J. Austen"');
const plan2 = planShelfImport([{ ...rowToBook(rows[2], 'goodreads') }], [{ id: 'bk:u', title: 'Ulysses', author: 'James Joyce' }]);
assert.deepEqual(plan2[0].fills, ['pages', 'pubYear', 'status'], 'unset status is filled in');
assert.equal(plan2[0].book.inProgress, true);
console.log('shelfImport: all cases pass');
