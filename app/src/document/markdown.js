// Minimal Markdown → HTML for reading — not a spec-complete renderer, just enough for the
// Markdown that LLMs and note apps emit: YAML front matter, ATX headings, hr, lists,
// blockquotes, fenced code, tables, bold/italic/strikethrough/inline code, links and images.
// The output feeds BOTH the plain-text extraction (structure-aware, via parsers.js) and the
// synced Source view, so formatting characters never leak into the word stream.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline syntax. Code spans go first so markup inside them stays literal; images become a small
// placeholder (never fetched — a reading app shouldn't hit remote hosts from documents).
export function mdInline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_, alt) => (alt ? `<em>[image: ${alt}]</em>` : ''));
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, t, u) =>
    /^https?:\/\//i.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

const HR_RX = /^ {0,3}((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$/;
const TABLE_SEP_RX = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

export function mdToHtml(md) {
  let text = String(md || '').replace(/\r\n?/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, ''); // hidden tagging (HTML comments) contributes nothing
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  // YAML front matter: --- ... --- at the very top is metadata, not prose.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)$/.test(l.trim()));
    if (end > 0) i = end + 1;
  }

  let para = [];
  const flushPara = () => {
    if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = []; }
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { flushPara(); i++; continue; }

    // fenced code
    const fence = /^ {0,3}(```|~~~)/.exec(line);
    if (fence) {
      flushPara();
      const mark = fence[1];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) code.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    // ATX heading
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (HR_RX.test(t)) { flushPara(); out.push('<hr>'); i++; continue; }

    // blockquote (consume the run)
    if (/^ {0,3}>/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      out.push(`<blockquote>${mdToHtml(q.join('\n'))}</blockquote>`);
      continue;
    }

    // table: a header row followed by the |---|---| separator
    if (t.includes('|') && i + 1 < lines.length && TABLE_SEP_RX.test(lines[i + 1])) {
      flushPara();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInline(c.trim()));
      const head = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      );
      continue;
    }

    // list (unordered or ordered; nesting flattens — fine for reading order)
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[3]); i++; continue; }
        // continuation line of the previous item (indented, non-blank)
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      // GitHub-style task lists: "- [ ] thing" / "- [x] thing" become real checkboxes (the
      // Source pane makes them tickable and persists the ticks per file).
      const itemHtml = (it) => {
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(it);
        if (task) return `<li class="task"><input type="checkbox"${/x/i.test(task[1]) ? ' checked' : ''}> ${mdInline(task[2])}</li>`;
        return `<li>${mdInline(it)}</li>`;
      };
      out.push(`<${tag}>${items.map(itemHtml).join('')}</${tag}>`);
      continue;
    }

    para.push(t);
    i++;
  }
  flushPara();
  return out.join('\n');
}
