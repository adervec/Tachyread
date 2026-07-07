// Self-check for htmlExport. Run: node app/src/document/htmlExport.demo.mjs
import assert from 'node:assert';
import { docToHtml, HTML_AUTHORING_GUIDE, restructurePrompt } from './htmlExport.js';

// A doc-like object (the shape readerDocFromText produces): lines + tocEntries.
const doc = {
  tocEntries: [
    { wordIndex: 0, title: 'Chapter One', level: 0 },
    { wordIndex: 6, title: 'A Section', level: 1 },
  ],
  lines: [
    { text: 'Chapter One', startWordIndex: 0, endWordIndex: 1, isEmpty: false },
    { text: 'First paragraph with <b>markup</b> & symbols.', startWordIndex: 2, endWordIndex: 5, isEmpty: false },
    { text: '', startWordIndex: -1, endWordIndex: -1, isEmpty: true },
    { text: 'A Section', startWordIndex: 6, endWordIndex: 7, isEmpty: false },
    { text: 'Second paragraph here.', startWordIndex: 8, endWordIndex: 10, isEmpty: false },
  ],
};

const html = docToHtml(doc, 'My Book');
assert.ok(html.startsWith('<!doctype html>'));
assert.ok(html.includes('<main>') && html.includes('</main>'));
assert.ok(html.includes('<title>My Book</title>'));
// headings from the ToC at their levels (level 0 -> h1, level 1 -> h2)
assert.ok(html.includes('<h1>Chapter One</h1>'));
assert.ok(html.includes('<h2>A Section</h2>'));
// paragraphs, with HTML-escaped text (no raw markup / ampersands leak)
assert.ok(html.includes('<p>First paragraph with &lt;b&gt;markup&lt;/b&gt; &amp; symbols.</p>'));
assert.ok(html.includes('<p>Second paragraph here.</p>'));
assert.ok(!/<b>markup<\/b>/.test(html), 'raw markup must be escaped');
// blank line separates paragraphs (two <p> blocks, not one)
assert.equal((html.match(/<p>/g) || []).length, 2);

// No ToC → still valid, content wrapped in <main> as paragraphs (auto-detector picks <main>)
const plain = docToHtml({ lines: [{ text: 'Just prose.', startWordIndex: 0, endWordIndex: 1, isEmpty: false }] }, 'Plain');
assert.ok(plain.includes('<main>') && plain.includes('<p>Just prose.</p>') && !/<h[1-6]>/.test(plain));

// Guide + prompt sanity
assert.ok(/<main>/.test(HTML_AUTHORING_GUIDE) && /Table of Contents/i.test(HTML_AUTHORING_GUIDE));
const prompt = restructurePrompt(doc, 'My Book');
assert.ok(prompt.includes('restructure') && prompt.includes(HTML_AUTHORING_GUIDE) && prompt.includes('<main>'));

console.log('htmlExport.demo: all assertions passed ✅');
