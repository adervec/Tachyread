// Self-check for webGrab pure helpers. Run: node src/features/webGrab.demo.mjs
import assert from 'node:assert';
import { normalizeUrl, proxyUrl, isHtmlContentType } from './webGrab.js';

// normalizeUrl: add a scheme, keep valid ones, reject junk
assert.equal(normalizeUrl('example.com/article'), 'https://example.com/article');
assert.equal(normalizeUrl('  https://a.org/x '), 'https://a.org/x');
assert.equal(normalizeUrl('http://b.net'), 'http://b.net/');
assert.equal(normalizeUrl('www.foo.com'), 'https://www.foo.com/');
assert.equal(normalizeUrl('ftp://x.com'), ''); // non-http scheme rejected
assert.equal(normalizeUrl('javascript:alert(1)'), ''); // no injection scheme
assert.equal(normalizeUrl('notaurl'), ''); // no TLD → rejected
assert.equal(normalizeUrl(''), '');

// proxyUrl encodes the target so its query string can't break out
const p = proxyUrl('https://x.com/a?b=1&c=2');
assert.ok(p.startsWith('https://api.allorigins.win/raw?url='));
assert.ok(p.includes(encodeURIComponent('https://x.com/a?b=1&c=2')));
assert.ok(!p.includes('&c=2')); // the target's & is encoded, not a proxy param

// content-type sniff
assert.ok(isHtmlContentType('text/html; charset=utf-8'));
assert.ok(isHtmlContentType('application/xhtml+xml'));
assert.ok(!isHtmlContentType('text/plain'));
assert.ok(!isHtmlContentType(''));

console.log('webGrab.demo: all assertions passed ✅');
