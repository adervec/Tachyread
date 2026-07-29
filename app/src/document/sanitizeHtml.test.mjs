// ponytail: HTML sanitizer for retained document HTML (EPUB source is injected same-origin, so this is
// a real XSS boundary). Locks the confirmed exploit vectors closed. Run: node src/document/sanitizeHtml.test.mjs
import assert from 'node:assert';
import { sanitizeHtml } from './sanitizeHtml.js';

const clean = (h) => sanitizeHtml(h);
// the confirmed auto-exec exploits must be fully removed
assert.ok(!/iframe/i.test(clean('<iframe srcdoc="&lt;script&gt;fetch(0)&lt;/script&gt;"></iframe>')), 'iframe (srcdoc XSS) removed');
assert.ok(!/object/i.test(clean('<object data="data:text/html,<script>x</script>"></object>')), 'object data:text/html removed');
assert.ok(!/embed/i.test(clean('<embed src="evil.svg">')), 'embed removed');
assert.ok(!/<script/i.test(clean('<p>hi</p><script>steal()</script>')), 'script element removed');
assert.ok(!/onerror/i.test(clean('<img src=x onerror=alert(1)>')), 'UNQUOTED on* handler stripped');
assert.ok(!/onload/i.test(clean('<img src="x" onload="alert(1)">')), 'quoted on* handler stripped');
assert.ok(!/onmouseover/i.test(clean("<a onmouseover='x()'>")), 'single-quoted handler stripped');
assert.ok(!/srcdoc/i.test(clean('<iframe srcdoc="x">')), 'srcdoc attribute dropped');
assert.ok(!/javascript:/i.test(clean('<a href="javascript:steal()">go</a>')), 'javascript: scheme neutralized');
assert.ok(!/vbscript:/i.test(clean('<a href="vbscript:x">')), 'vbscript: neutralized');
assert.ok(!/svg/i.test(clean('<svg><script>x</script></svg>')), 'svg (can host script) removed');
assert.ok(!/<link/i.test(clean('<link rel=import href=evil>')), 'link removed');
assert.ok(!/<meta/i.test(clean('<meta http-equiv=refresh content="0;url=evil">')), 'meta removed');
assert.ok(!/<base/i.test(clean('<base href="//evil/">')), 'base removed');

// legitimate content is preserved
const ok = clean('<h1>Chapter 1</h1><p style="color:red">A <b>bold</b> <a href="https://ok.example">link</a> and <img src="pic.jpg" alt="x"></p><table><tr><td>cell</td></tr></table>');
assert.ok(/<h1>Chapter 1<\/h1>/.test(ok), 'heading kept');
assert.ok(/<b>bold<\/b>/.test(ok) && /<img /.test(ok) && /<table>/.test(ok), 'formatting/img/table kept');
assert.ok(/href="https:\/\/ok\.example"/.test(ok), 'safe links kept');
assert.ok(/style="color:red"/.test(ok), 'inline style kept');
assert.ok(/src="pic\.jpg"/.test(ok), 'normal image src kept');
// data:image (safe) survives; only data:text/html is blocked
assert.ok(/data:image\/png/.test(clean('<img src="data:image/png;base64,AAAA">')), 'data:image kept');

// junk tolerance
assert.equal(clean(null), '', 'null → empty string, no throw');
assert.equal(clean(undefined), '', 'undefined → empty');
assert.equal(typeof clean(123), 'string', 'coerces non-strings');

console.log('sanitizeHtml: all cases pass');
