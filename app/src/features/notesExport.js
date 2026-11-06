// Notes & highlights out of Tachyread: a Markdown file grouped by book, and Readwise's highlight
// API (the user's own token, called straight from the browser — Readwise allows this origin).
// items: [{ book, author?, quote?, text?, wordIndex?, createdAt?, section? }]

export function notesMarkdown(items, { title = 'Tachyread notes & highlights', date = new Date() } = {}) {
  const byBook = new Map();
  for (const it of items) {
    if (!it.quote && !it.text) continue;
    if (!byBook.has(it.book)) byBook.set(it.book, []);
    byBook.get(it.book).push(it);
  }
  const out = [`# ${title}`, '', `_Exported ${date.toISOString().slice(0, 10)}_`];
  for (const [book, list] of [...byBook.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const author = list.find((x) => x.author)?.author;
    out.push('', `## ${book}${author ? ` — ${author}` : ''}`);
    for (const it of [...list].sort((a, b) => (a.wordIndex ?? Infinity) - (b.wordIndex ?? Infinity))) {
      out.push('');
      if (it.quote) out.push(...String(it.quote).split('\n').map((l) => `> ${l}`));
      if (it.text) out.push(it.quote ? `\n${it.text}` : it.text);
      const where = [it.section?.title && `§ ${it.section.title}`, it.wordIndex != null && `word ${it.wordIndex + 1}`].filter(Boolean).join(' · ');
      if (where) out.push(`<sub>${where}</sub>`);
    }
  }
  return `${out.join('\n')}\n`;
}

// Readwise v2 /highlights payload. A plain note (no quote) goes up as its own highlight text.
export function readwisePayload(items) {
  return {
    highlights: items.filter((it) => it.quote || it.text).map((it) => ({
      text: String(it.quote || it.text).slice(0, 8191),
      title: String(it.book || 'Untitled').slice(0, 511),
      ...(it.author ? { author: String(it.author).slice(0, 1024) } : {}),
      ...(it.quote && it.text ? { note: String(it.text).slice(0, 8191) } : {}),
      ...(it.wordIndex != null ? { location: it.wordIndex + 1, location_type: 'order' } : {}),
      ...(it.createdAt ? { highlighted_at: new Date(it.createdAt).toISOString() } : {}),
      source_type: 'tachyread',
      category: 'books',
    })),
  };
}

export async function sendToReadwise(token, items) {
  const res = await fetch('https://readwise.io/api/v2/highlights/', {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readwisePayload(items)),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Readwise rejected the token' : `Readwise error ${res.status}`);
  return readwisePayload(items).highlights.length;
}
