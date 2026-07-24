// ponytail: the help exporters — print/PDF HTML and the self-contained narrated slideshow.
// Run: node src/features/helpExport.test.mjs
import assert from 'node:assert';
import { printHtml, slideshowHtml } from './helpExport.js';

const sections = [
  { id: 'a', title: '🚀 Getting started', say: 'Welcome aboard.', body: ['Open a file.', 'Press space to read.'] },
  { id: 'b', title: '⌨ Shortcuts', intro: 'Keys work anywhere.', groups: [{ name: 'Play', keys: [['Space', 'Play / pause'], ['← →', 'Prev / next']] }] },
  { id: 'c', title: '🖼 Shots', say: 'A shot slide.', body: ['<script>alert(1)</script> & "quotes"'], shot: 'data:image/png;base64,AAAA' },
];

// ── print / PDF ──
const pdf = printHtml(sections, { title: 'My Help' });
assert.ok(pdf.startsWith('<!doctype html>'), 'is a full HTML doc');
assert.ok(pdf.includes('<title>My Help</title>'), 'carries the title');
assert.ok(pdf.includes('Getting started') && pdf.includes('Shortcuts'), 'includes every section heading');
assert.ok(pdf.includes('Space — Play / pause'), 'flattens keyboard groups into text');
assert.ok(pdf.includes('@media print'), 'has print styling');
assert.ok(!/https?:\/\//.test(pdf.replace(/xmlns|schema/g, '')) || !/src=["']https?:/.test(pdf), 'no external resources referenced');
assert.ok(pdf.includes('&lt;script&gt;'), 'section text is HTML-escaped');
assert.ok(!/<script>alert/.test(pdf), 'no injected script survives');

// ── slideshow ──
const show = slideshowHtml(sections, { title: 'Tour' });
assert.ok(show.startsWith('<!doctype html>'), 'is a full HTML doc');
assert.ok(show.includes('<title>Tour</title>'), 'carries the title');
assert.ok(show.includes('speechSynthesis') && show.includes('SpeechSynthesisUtterance'), 'narrates via speech synthesis');
assert.ok(show.includes('const SLIDES ='), 'embeds the slide data');
// Self-contained: no external hosts (fonts/scripts/img). data: URLs are fine.
const externals = show.match(/(?:src|href)=["']https?:\/\/[^"']+/g) || [];
assert.equal(externals.length, 0, 'no external src/href: ' + JSON.stringify(externals));
assert.ok(show.includes('@import') === false && !/<link\b/.test(show), 'no external stylesheets');
// The screenshot data URL rides along; the script uses it for that slide.
assert.ok(show.includes('data:image/png;base64,AAAA'), 'embeds a provided screenshot');
assert.ok(show.includes('s.shot ?'), 'renders the screenshot when present, else a poster card');
// Narration content is present (as JSON data) and the malicious body is neutralised for the <script>.
assert.ok(show.includes('Welcome aboard.'), 'narration text embedded');
assert.ok(!show.includes('<script>alert(1)</script>'), 'raw </script> from content cannot break out');
assert.ok(show.includes('\\u003cscript'), 'angle brackets in embedded JSON are escaped');
// Auto-advance + controls exist.
assert.ok(show.includes("id=\"next\"") && show.includes("id=\"play\"") && show.includes("id=\"prev\""), 'has slideshow controls');
assert.ok(show.includes('advance()'), 'auto-advances between slides');

// Empty input still yields a valid doc (no crash).
assert.ok(slideshowHtml([]).startsWith('<!doctype html>') && printHtml([]).startsWith('<!doctype html>'), 'empty sections → valid docs');

console.log('helpExport: all cases pass');
