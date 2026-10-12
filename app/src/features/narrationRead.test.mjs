import assert from 'node:assert/strict';
import { createReadingTracker } from '../engine/readingTracker.js';
import { readerDocFromText } from '../document/readerDocument.js';

// storage.js needs IndexedDB, so only the pure parts are checked here.
const { chunkRange, textReadShare } = await import('./narrationRead.js').catch(() => ({}));
if (!chunkRange) { console.log('SKIP: narrationRead needs IndexedDB to import'); process.exit(0); }

const doc = readerDocFromText('One two three four.\nFive six seven eight.\nNine ten.', 'x.txt');
const [a, b] = chunkRange(doc, { startLine: 1, endLine: 2 });
assert.deepEqual([a, b], [4, 10]);
const tr = createReadingTracker({ wordCount: doc.words.length });
tr.markRangeRead(4, 7, 'line');                // read as text
tr.markRangeReadAtPace(7, 10, 150, 'speak');   // narrated
assert.equal(textReadShare(tr, [4, 10]), 0.5, 'narrated words are not "read as text"');
assert.equal(tr.srcAt(8), 8);
assert.equal(tr.readCount, 6);
assert.ok(tr.lifetimeActiveMs > 0, 'narration credits reading time at its pace');
console.log('narrationRead: all cases pass');
