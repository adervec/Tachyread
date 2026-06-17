// Resource-generation wizard engine — the same philosophy as the TOC wizard, applied to the other
// reference apparatus a book ships with: its CAST LIST (dramatis personae), its NOTES section
// (foot/endnotes), and its printed INDEX. Rather than blindly scanning the whole text (slow and
// error-prone), we first help the user point at the in-text resource, then use it as ground truth:
//   • names  → the cast list seeds exactly which capitalised words are characters (precise highlight).
//   • index  → the printed index gives the real term list; navigation is by locating each term.
//   • notes  → the notes section + chosen marker style scopes detection.
// Pure functions over the reader document.

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────
function strip(w) {
  return String(w || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
const NAME_STOP = new Set(['the', 'and', 'of', 'a', 'an', 'or', 'to', 'in', 'mr', 'mrs', 'ms', 'dr', 'sir', 'lady', 'lord', 'king', 'queen']);

// Section headings we look for, per resource kind. Cast lists sit in the front matter; notes and the
// index sit at the back, so detection scans from the appropriate end.
export const SECTION = {
  names: { rx: /^\s*(dramatis person(?:ae|æ)|cast of characters|the characters|principal characters|list of characters|characters|persons of the (?:play|drama))\s*$/i, fromEnd: false },
  index: { rx: /^\s*index(?:\s+of\s+[\w\s]+)?\s*$/i, fromEnd: true },
  notes: { rx: /^\s*(foot ?notes|end ?notes|notes)\s*$/i, fromEnd: true },
};

// Locate a list section: find its heading, then the list block beneath it (until a 2-blank gap after
// a couple of entries, or a clearly-prose line). Returns { headingLine, startLine, endLine } or null.
export function detectListSection(doc, kind) {
  const cfg = SECTION[kind];
  if (!cfg) return null;
  const N = doc.lines.length;
  let headingLine = -1;
  if (cfg.fromEnd) {
    for (let li = N - 1; li >= 0; li--) if (cfg.rx.test(doc.lines[li].text || '')) { headingLine = li; break; }
  } else {
    const lim = Math.min(N, 1800);
    for (let li = 0; li < lim; li++) if (cfg.rx.test(doc.lines[li].text || '')) { headingLine = li; break; }
  }
  if (headingLine < 0) return null;
  let start = headingLine + 1;
  while (start < N && doc.lines[start].isEmpty) start++;
  let end = start - 1;
  let blanks = 0;
  let seen = 0;
  for (let li = start; li < N; li++) {
    const ln = doc.lines[li];
    if (ln.isEmpty) { blanks++; if (blanks >= 2 && seen >= 2) break; continue; }
    blanks = 0;
    const t = ln.text.trim();
    if (t.split(/\s+/).length > 25) break; // prose paragraph → past the list
    end = li;
    seen++;
  }
  if (seen < 1) return null;
  return { headingLine, startLine: start, endLine: Math.max(start, end) };
}

// ── cast list (proper names) ─────────────────────────────────────────────────────────────────────
// Parse a dramatis-personae block into [{ name, note }]. A line is split on the first separator
// (dash / colon / comma / 2+ spaces / tab) into the name and a descriptive note; "X and Y" yields two.
export function parseNamesRegion(doc, start, end) {
  const out = [];
  const seen = new Set();
  for (let li = Math.max(0, start); li <= Math.min(doc.lines.length - 1, end); li++) {
    const ln = doc.lines[li];
    if (!ln || ln.isEmpty) continue;
    const t = ln.text.trim();
    if (!t || t.length > 140) continue;
    const m = t.match(/^(.*?)(?:\s[–—-]\s|:\s*|,\s+|\s{2,}|\t)(.*)$/);
    const namePart = (m ? m[1] : t).trim();
    const note = m ? m[2].trim() : '';
    for (let nm of namePart.split(/\s+and\s+|\s*&\s*/i)) {
      nm = nm.replace(/^[•·\-*]\s*/u, '').trim();
      if (!nm || !/^\p{Lu}/u.test(nm)) continue;
      if (nm.split(/\s+/).length > 6) continue;
      const key = nm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: nm, note, srcLine: li });
    }
  }
  return out;
}

// The set of capitalised name tokens (lowercase → canonical) implied by a cast list.
export function nameTokens(names) {
  const map = new Map();
  for (const entry of names) {
    for (const tok of String(entry.name || '').split(/\s+/)) {
      const c = strip(tok);
      if (c.length < 3 || !/^\p{Lu}/u.test(c) || NAME_STOP.has(c.toLowerCase())) continue;
      const k = c.toLowerCase();
      if (!map.has(k)) map.set(k, c);
    }
  }
  return map;
}

// Build the doc.properNames-shaped Map { tokenLower → { canonical, indices } } by finding every body
// occurrence of a cast-list name token. Precise: only words that are actually named characters.
export function buildProperNamesFromList(doc, names) {
  const tokens = nameTokens(names);
  const final = new Map();
  if (!tokens.size) return final;
  for (let i = 0; i < doc.words.length; i++) {
    const c = strip(doc.words[i]);
    if (c.length < 3) continue;
    const k = c.toLowerCase();
    if (!tokens.has(k)) continue;
    if (!final.has(k)) final.set(k, { canonical: tokens.get(k), indices: [] });
    final.get(k).indices.push(i);
  }
  return final;
}

// ── printed index ─────────────────────────────────────────────────────────────────────────────────
// Parse a back-of-book index into [{ term, pages:[], level }]. Each line: a term followed by page
// numbers (comma/range separated); indented lines are subentries (level 1).
export function parseIndexRegion(doc, start, end) {
  const out = [];
  for (let li = Math.max(0, start); li <= Math.min(doc.lines.length - 1, end); li++) {
    const ln = doc.lines[li];
    if (!ln || ln.isEmpty) continue;
    const raw = ln.text;
    const t = raw.trim();
    if (!t) continue;
    let term = t;
    let pageStr = '';
    const m = t.match(/^(.*?)[,\s]+(\d[\d,\s–—-]*)$/u);
    if (m && /[a-z]/i.test(m[1])) { term = m[1].trim(); pageStr = m[2]; }
    const pages = (pageStr.match(/\d+/g) || []).map((n) => parseInt(n, 10)).filter((n) => n > 0 && n < 100000);
    term = term.replace(/[,;:]+$/, '').replace(/\s+/g, ' ').trim();
    if (!term || !/[a-z]/i.test(term) || term.split(/\s+/).length > 12) continue;
    const indent = raw.length - raw.replace(/^\s+/, '').length;
    out.push({ term, pages, level: indent > 0 ? 1 : 0, srcLine: li });
  }
  return out;
}

// Find the first body occurrence (word index) of a term phrase, at/after `fromWord`. -1 if none.
export function findTermIndex(doc, term, fromWord = 0) {
  const toks = String(term || '').toLowerCase().split(/\s+/).map(strip).filter((x) => x.length);
  if (!toks.length) return -1;
  for (let i = Math.max(0, fromWord); i < doc.words.length; i++) {
    if (strip(doc.words[i]).toLowerCase() !== toks[0]) continue;
    let ok = true;
    for (let k = 1; k < toks.length; k++) {
      if (strip(doc.words[i + k] || '').toLowerCase() !== toks[k]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// ── notes / footnotes ───────────────────────────────────────────────────────────────────────────
// Configurable footnote detection: choose which marker styles to honour and (optionally) scope the
// body-text search to the notes-section region so stray "1." lines in the prose aren't mistaken for
// note bodies. Returns a Map(number → { number, anchors:[wordIndex], body, bodyLine }).
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function detectFootnotes(doc, opts = {}) {
  const styles = { bracket: true, paren: true, super: true, ...(opts.styles || {}) };
  const bodyStart = opts.bodyStart ?? 0;
  const bodyEnd = opts.bodyEnd ?? (doc.lines.length - 1);
  const re = /(?:\[(\d+)\])|(?:\((\d+)\))|([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/;
  const fmap = new Map();
  for (let wi = 0; wi < doc.words.length; wi++) {
    const m = doc.words[wi].match(re);
    if (!m) continue;
    let num = null;
    if (m[1] && styles.bracket) num = parseInt(m[1], 10);
    else if (m[2] && styles.paren) num = parseInt(m[2], 10);
    else if (m[3] && styles.super) num = parseInt(m[3].split('').map((c) => SUP.indexOf(c)).join(''), 10);
    if (!num || num > 999) continue;
    if (!fmap.has(num)) fmap.set(num, { number: num, anchors: [], body: '' });
    fmap.get(num).anchors.push(wi);
  }
  const bodyRe = /^\s*(\d+)[.)]\s+(.{2,})$/;
  for (let li = Math.max(0, bodyStart); li <= Math.min(doc.lines.length - 1, bodyEnd); li++) {
    const m = doc.lines[li].text.match(bodyRe);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (fmap.has(n) && !fmap.get(n).body) { fmap.get(n).body = m[2].trim(); fmap.get(n).bodyLine = li; }
  }
  return fmap;
}
