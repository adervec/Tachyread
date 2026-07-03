// ponytail: truth table for the mini Markdown renderer — the shapes Claude/Cowork files actually
// use must render structurally, and no syntax may leak. Run: node src/document/markdown.test.mjs
import { mdToHtml } from './markdown.js';
import assert from 'node:assert';

const h = mdToHtml([
  '---',
  'title: Front matter',
  'tags: [hidden, meta]',
  '---',
  '# Title',
  '',
  'Intro with **bold**, *italic*, `code`, ~~gone~~ and a [link](https://example.com) plus ![a chart](img.png).',
  '',
  '<!-- hidden tagging comment -->',
  '## Section two',
  '',
  '- item one',
  '- item two',
  '  continued line',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted wisdom',
  '',
  '| Col A | Col B |',
  '|-------|-------|',
  '| a1    | b1    |',
  '',
  '---',
  '',
  '```js',
  'const x = "<b>not bold</b>";',
  '```',
].join('\n'));

assert(!/Front matter|hidden, meta/.test(h), 'front matter stripped');
assert(!/hidden tagging comment/.test(h), 'HTML comments stripped');
assert(/<h1>Title<\/h1>/.test(h), 'h1');
assert(/<h2>Section two<\/h2>/.test(h), 'h2');
assert(/<strong>bold<\/strong>/.test(h) && /<em>italic<\/em>/.test(h) && /<code>code<\/code>/.test(h) && /<del>gone<\/del>/.test(h), 'inline styles');
assert(/<a href="https:\/\/example.com"[^>]*>link<\/a>/.test(h), 'links keep their text');
assert(/\[image: a chart\]/.test(h) && !/img.png/.test(h.replace(/\[image[^\]]*\]/, '')), 'images become placeholders, never fetched');
assert(/<ul><li>item one<\/li><li>item two continued line<\/li><\/ul>/.test(h), 'unordered list with continuation');
assert(/<ol><li>first<\/li><li>second<\/li><\/ol>/.test(h), 'ordered list');
assert(/<blockquote>[\s\S]*quoted wisdom[\s\S]*<\/blockquote>/.test(h), 'blockquote');
assert(/<th>Col A<\/th>/.test(h) && /<td>b1<\/td>/.test(h), 'table');
assert(/<hr>/.test(h), 'horizontal rule');
assert(/&lt;b&gt;not bold&lt;\/b&gt;/.test(h), 'code fences escape embedded HTML');
assert(!/[^`]\*\*/.test(h.replace(/<[^>]+>/g, '')), 'no ** markers leak into text');
console.log('ok');
