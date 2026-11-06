import assert from 'node:assert/strict';
import { sharedPayload, shareFileName } from './shareTarget.js';

const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
assert.equal(sharedPayload('?foo=1'), null, 'not a share');
assert.deepEqual(sharedPayload(`?share-target&title=Note&text=${encodeURIComponent(long)}`), { kind: 'text', title: 'Note', text: long });
assert.deepEqual(sharedPayload('?share-target&text=https%3A%2F%2Fex.com%2Fa'), { kind: 'url', title: '', url: 'https://ex.com/a', text: '' }, 'Android puts the link in text');
assert.deepEqual(sharedPayload('?share-target&title=T&text=Look%20at%20this&url=https%3A%2F%2Fex.com'), { kind: 'url', title: 'T', url: 'https://ex.com', text: 'Look at this' }, 'short blurb + link → fetch the link');
assert.deepEqual(sharedPayload('?share-target&text=just%20a%20thought'), { kind: 'text', title: 'Shared text', text: 'just a thought' }, 'short text, no link → still opens');
assert.equal(sharedPayload('?share-target'), null, 'nothing shared');
assert.equal(shareFileName('A/B: "c"?', ''), 'A B c.txt');
assert.equal(shareFileName('', 'https://www.example.org/x'), 'www.example.org.txt');
console.log('shareTarget: all cases pass');
