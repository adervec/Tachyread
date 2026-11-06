// Export the open document as a "bionic" EPUB for e-ink readers (Kindle via Send-to-Kindle, Kobo,
// any EPUB app): the first half of every word bold, the same split the Lines pane's Bionic text
// uses, chaptered by the document's table of contents. Pure: returns the file bytes.

// ── a tiny STORE-only zip writer (EPUB needs no compression; mimetype must be first + stored) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zipStore(files) { // [{ name, data: string|Uint8Array }]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, off, true);
    central.push(new Uint8Array(cen.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of all) { out.set(p, i); i += p.length; }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// One word → bionic XHTML (letters only are split; punctuation rides along).
export function bionicWord(w) {
  const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’-]*)(.*)$/u.exec(w);
  if (!m || m[2].length < 2) return esc(w);
  const k = Math.ceil(m[2].length / 2);
  return `${esc(m[1])}<b>${esc(m[2].slice(0, k))}</b>${esc(m[2].slice(k))}${esc(m[3])}`;
}

// chapters: [{ title, paragraphs: [string] }]
export function buildEpub({ title, author = '', chapters, lang = 'en', id = `tachyread-${Date.now()}` }) {
  const xhtml = (ch) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${esc(lang)}"><head><title>${esc(ch.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>${esc(ch.title)}</h2>
${ch.paragraphs.map((p) => `<p>${p.split(/\s+/).filter(Boolean).map(bionicWord).join(' ')}</p>`).join('\n')}
</body></html>`;
  const items = chapters.map((ch, i) => ({ id: `c${i + 1}`, href: `c${i + 1}.xhtml`, ch }));
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/style.css', data: 'body{font-family:serif;line-height:1.5}p{margin:0 0 .8em;text-indent:0}b{font-weight:700}' },
    { name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">${esc(id)}</dc:identifier><dc:title>${esc(title)} (bionic)</dc:title>${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}<dc:language>${esc(lang)}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${items.map((it) => `<item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${items.map((it) => `<itemref idref="${it.id}"/>`).join('')}</spine>
</package>` },
    { name: 'OEBPS/nav.xhtml', data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol>${items.map((it) => `<li><a href="${it.href}">${esc(it.ch.title)}</a></li>`).join('')}</ol></nav></body></html>` },
    ...items.map((it) => ({ name: `OEBPS/${it.href}`, data: xhtml(it.ch) })),
  ];
  return zipStore(files);
}

// Reader document → chapters: paragraphs are runs of non-empty lines; chapter starts come from the
// ToC entries' word indices (or ~3000-word parts when there's no ToC).
export function docChapters(doc, tocEntries = []) {
  const paras = [];
  let cur = [], start = -1;
  doc.lines.forEach((l) => {
    if (l.isEmpty) { if (cur.length) paras.push({ text: cur.join(' '), start }); cur = []; start = -1; return; }
    if (start < 0) start = l.startWordIndex;
    cur.push(l.text);
  });
  if (cur.length) paras.push({ text: cur.join(' '), start });
  const marks = [...tocEntries].filter((e) => e.wordIndex >= 0).sort((a, b) => a.wordIndex - b.wordIndex);
  const chapters = [];
  if (marks.length) {
    let ci = -1;
    for (const p of paras) {
      while (ci + 1 < marks.length && p.start >= marks[ci + 1].wordIndex) { ci++; chapters.push({ title: marks[ci].title, paragraphs: [] }); }
      if (ci < 0) { if (!chapters.length) chapters.push({ title: 'Opening', paragraphs: [] }); }
      const c = chapters[chapters.length - 1];
      if (!(c.paragraphs.length === 0 && p.text.trim() === c.title.trim())) c.paragraphs.push(p.text); // the heading line is already the <h2>
    }
  } else {
    let words = 0;
    for (const p of paras) {
      if (!chapters.length || words > 3000) { chapters.push({ title: `Part ${chapters.length + 1}`, paragraphs: [] }); words = 0; }
      chapters[chapters.length - 1].paragraphs.push(p.text);
      words += p.text.split(/\s+/).length;
    }
  }
  return chapters.filter((c) => c.paragraphs.length);
}
