// Book cover images. A book can carry several covers; one is the "master" shown on tiles. Covers come
// from three places: an uploaded image (data URL), a linked URL, or an AI-designed vector cover —
// Tachyread only wires Claude's TEXT API, so "AI confabulation" means Claude returns a small DESIGN
// SPEC (palette + motif + type) and we render the SVG locally. A deterministic procedural cover uses
// the same renderer, so a good-looking cover exists even with no API key. Pure; see bookCovers.test.mjs.

// ── the cover collection on a book ────────────────────────────────────────────
// b.covers: [{ id, src, source: 'upload'|'link'|'ai', spec? }]. b.coverMaster: id of the master.
export function bookCovers(b) {
  return Array.isArray(b?.covers) ? b.covers : [];
}
export function masterCover(b) {
  const list = bookCovers(b);
  if (!list.length) return null;
  return list.find((c) => c.id === b?.coverMaster) || list[0];
}
export function bookCoverSrc(b) {
  return masterCover(b)?.src || null;
}
export function hasCover(b) {
  return bookCovers(b).length > 0;
}

let seq = 0;
// Deterministic-ish id (no Date.now/Math.random — those break workflow replay; a counter + a hash of
// the src is enough to be unique within a book's short list).
export function coverId(src = '') {
  let h = 0;
  for (let i = 0; i < String(src).length; i++) h = (h * 31 + src.charCodeAt(i)) & 0x7fffffff;
  return `cv_${h.toString(36)}_${(seq++).toString(36)}`;
}

export function addCover(b, cover) {
  const list = bookCovers(b).slice();
  const c = { id: cover.id || coverId(cover.src), src: cover.src, source: cover.source || 'upload', ...(cover.spec ? { spec: cover.spec } : {}) };
  list.push(c);
  // First cover added becomes master automatically.
  const coverMaster = b?.coverMaster && list.some((x) => x.id === b.coverMaster) ? b.coverMaster : c.id;
  return { covers: list, coverMaster };
}
export function removeCover(b, id) {
  const list = bookCovers(b).filter((c) => c.id !== id);
  let coverMaster = b?.coverMaster;
  if (coverMaster === id) coverMaster = list[0]?.id || null;
  return { covers: list, coverMaster };
}
export function setMaster(b, id) {
  if (!bookCovers(b).some((c) => c.id === id)) return {};
  return { coverMaster: id };
}

// ── cover rendering: a design spec → an SVG data URL ───────────────────────────
export const MOTIFS = ['none', 'circle', 'tower', 'wave', 'diamond', 'star', 'grid', 'orbit', 'mountain', 'rings'];
export const FONTS = { serif: 'Georgia, "Times New Roman", serif', sans: '"Segoe UI", system-ui, sans-serif', mono: 'Consolas, "Courier New", monospace' };

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = (c, fb) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? c : fb);

// Naive word wrap into <=maxLines lines of <=perLine chars (SVG can't measure text). Good enough for a
// cover title. ponytail: char-count wrap; swap for a measured layout if titles look ragged.
function wrap(text, perLine, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length === maxLines - 1) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const rest = words.slice(lines.join(' ').split(/\s+/).length).join(' ');
    if (rest) lines[maxLines - 1] = (lines[maxLines - 1] + ' ' + rest).slice(0, perLine - 1) + '…';
  }
  return lines;
}

function motifSvg(motif, accent) {
  const a = safeColor(accent, '#ffffff');
  switch (motif) {
    case 'circle': return `<circle cx="150" cy="150" r="86" fill="none" stroke="${a}" stroke-width="6" opacity="0.9"/>`;
    case 'rings': return [70, 52, 34].map((r, i) => `<circle cx="150" cy="150" r="${r}" fill="none" stroke="${a}" stroke-width="4" opacity="${0.9 - i * 0.2}"/>`).join('');
    case 'tower': return `<rect x="132" y="70" width="36" height="150" fill="${a}" opacity="0.9"/><polygon points="150,44 172,74 128,74" fill="${a}"/>`;
    case 'wave': return `<path d="M20 170 Q80 120 150 170 T280 170" fill="none" stroke="${a}" stroke-width="6" opacity="0.9"/><path d="M20 205 Q80 155 150 205 T280 205" fill="none" stroke="${a}" stroke-width="6" opacity="0.6"/>`;
    case 'diamond': return `<polygon points="150,64 214,150 150,236 86,150" fill="none" stroke="${a}" stroke-width="6"/>`;
    case 'star': return `<polygon points="150,66 168,124 228,124 180,160 198,218 150,182 102,218 120,160 72,124 132,124" fill="${a}" opacity="0.9"/>`;
    case 'grid': return Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => `<rect x="${74 + c * 40}" y="${74 + r * 40}" width="26" height="26" fill="${a}" opacity="${0.3 + ((r + c) % 3) * 0.2}"/>`).join('')).join('');
    case 'orbit': return `<circle cx="150" cy="150" r="10" fill="${a}"/><ellipse cx="150" cy="150" rx="92" ry="40" fill="none" stroke="${a}" stroke-width="4" opacity="0.8"/><ellipse cx="150" cy="150" rx="40" ry="92" fill="none" stroke="${a}" stroke-width="4" opacity="0.6"/>`;
    case 'mountain': return `<polygon points="40,230 120,110 175,180 210,130 280,230" fill="${a}" opacity="0.85"/>`;
    default: return '';
  }
}

// spec: { bg:[c1,c2], accent, titleColor, authorColor, font:'serif'|'sans'|'mono', motif }.
// Returns an SVG data URL (2:3 poster). Missing/invalid fields fall back to sensible defaults.
export function coverSpecToSvg(spec = {}, { title = '', author = '' } = {}) {
  const bg0 = safeColor(spec.bg?.[0], '#2a3550');
  const bg1 = safeColor(spec.bg?.[1], '#161d2e');
  const accent = safeColor(spec.accent, '#d9b25a');
  const titleColor = safeColor(spec.titleColor, '#ffffff');
  const authorColor = safeColor(spec.authorColor, '#c9d2e0');
  const font = FONTS[spec.font] || FONTS.serif;
  const motif = MOTIFS.includes(spec.motif) ? spec.motif : 'none';
  const titleLines = wrap(title || 'Untitled', 16, 3);
  const tStartY = 300 - (titleLines.length - 1) * 17;
  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg0}"/><stop offset="1" stop-color="${bg1}"/></linearGradient></defs>
<rect width="300" height="450" fill="url(#g)"/>
<rect x="10" y="10" width="280" height="430" fill="none" stroke="${accent}" stroke-width="2" opacity="0.5"/>
${motifSvg(motif, accent)}
<g font-family="${font}" text-anchor="middle">
${titleLines.map((l, i) => `<text x="150" y="${tStartY + i * 34}" font-size="26" font-weight="700" fill="${titleColor}">${esc(l)}</text>`).join('')}
${author ? `<text x="150" y="${tStartY + titleLines.length * 34 + 16}" font-size="15" fill="${authorColor}" opacity="0.92">${esc(author)}</text>` : ''}
</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`;
}

// ── procedural (no-AI) cover: a deterministic spec from the book's own text ────
const PALETTES = [
  ['#2a3550', '#161d2e', '#d9b25a'], ['#3a2a4a', '#1e1428', '#c98bd0'], ['#1f3b34', '#0f221d', '#6fd0a8'],
  ['#4a2a2a', '#281414', '#e08a6a'], ['#2a3a4a', '#141f28', '#6ab0e0'], ['#3a3320', '#221d0f', '#e0c86a'],
  ['#25324a', '#121a2a', '#8a9cd0'], ['#402038', '#22101d', '#e06aa8'],
];
const GENRE_MOTIF = { fantasy: 'tower', 'sci-fi': 'orbit', scifi: 'orbit', science: 'orbit', history: 'grid', poetry: 'wave', romance: 'rings', mystery: 'diamond', thriller: 'diamond', nature: 'mountain', philosophy: 'rings', reference: 'grid' };
function hash(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff; return h; }

export function proceduralSpec({ title = '', genre = '' } = {}) {
  const p = PALETTES[hash(title || 'x') % PALETTES.length];
  const g = String(genre || '').toLowerCase();
  const motif = GENRE_MOTIF[Object.keys(GENRE_MOTIF).find((k) => g.includes(k))] || MOTIFS[1 + (hash(title) % (MOTIFS.length - 1))];
  return { bg: [p[0], p[1]], accent: p[2], titleColor: '#ffffff', authorColor: '#c9d2e0', font: hash(title) % 2 ? 'serif' : 'sans', motif };
}
export function proceduralCover({ title = '', author = '', genre = '' } = {}) {
  return coverSpecToSvg(proceduralSpec({ title, genre }), { title, author });
}

// ── AI: prompt + spec validation ───────────────────────────────────────────────
export function coverPromptFor(b) {
  return `Design a book cover for this book. Reply with ONLY a JSON object, no prose.
Book: "${b?.title || 'Untitled'}"${b?.author ? ` by ${b.author}` : ''}${b?.genre ? ` — genre: ${b.genre}` : ''}${b?.subgenre ? ` / ${b.subgenre}` : ''}.
JSON shape: {"bg":["#hex","#hex"],"accent":"#hex","titleColor":"#hex","authorColor":"#hex","font":"serif|sans|mono","motif":"${MOTIFS.join('|')}"}
Choose a palette and a single motif that fit the book's mood. bg is a top→bottom gradient; make title readable against it.`;
}

// Coerce whatever Claude returned (a JSON object or a string containing one) into a valid spec.
export function parseCoverSpec(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  return {
    bg: [safeColor(obj.bg?.[0], '#2a3550'), safeColor(obj.bg?.[1], '#161d2e')],
    accent: safeColor(obj.accent, '#d9b25a'),
    titleColor: safeColor(obj.titleColor, '#ffffff'),
    authorColor: safeColor(obj.authorColor, '#c9d2e0'),
    font: FONTS[obj.font] ? obj.font : 'serif',
    motif: MOTIFS.includes(obj.motif) ? obj.motif : 'none',
  };
}
