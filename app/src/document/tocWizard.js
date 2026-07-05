// TOC-generation wizard engine.
//
// The robust path: many books PRINT a table of contents near the front. That printed list is the
// author's own ground-truth outline — far more reliable than guessing headings from formatting. So
// the wizard lets the user point at that printed-TOC region, we parse its lines into titles (+ page
// numbers + hierarchy), then LOCATE each title's real position in the body by matching it to a
// heading line further down. The result is a clean { wordIndex, title, level } list aligned to the
// actual text — no dependence on the (often lost) original page numbers.
//
// Pure functions over the reader document (no React). Used by dialogs/TocWizard.jsx.

import { keywordLevel, normalizeLevels, HEAD_RX } from './toc.js';

// ── normalization / matching ───────────────────────────────────────────────────────────────────
// A loose normal form for comparing a TOC title to a body heading: lowercase, drop apostrophes,
// collapse everything non-alphanumeric to single spaces. Leading chapter-number words are kept (they
// often appear in both), but matching tolerates their absence via token overlap.
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const sb = new Set(tb);
  let inter = 0;
  for (const t of ta) if (sb.has(t)) inter++;
  const uni = new Set([...ta, ...tb]).size;
  return uni ? inter / uni : 0;
}

// Split a printed-TOC line into its title and trailing page number. Page numbers in a printed TOC
// are set off by dot leaders or column alignment (a run of dots or 2+ spaces), so we only strip a
// trailing number when it's clearly separated — and, as a looser fallback, a single-spaced trailing
// number when enough title text remains (titles ending in a real number are rare in a printed TOC).
function splitTitlePage(s) {
  let m = s.match(/^(.*?)(?:[.…·•‧]{2,}|\s{2,})\s*(\d{1,4})$/u);
  if (m && m[1].trim()) return { title: m[1].trim(), page: parseInt(m[2], 10) };
  m = s.match(/^(.+?)\s+(\d{1,4})$/u);
  if (m && normTitle(m[1]).length >= 3) return { title: m[1].trim(), page: parseInt(m[2], 10) };
  return { title: s.trim(), page: null };
}

// ── parse the printed TOC region into entry candidates ───────────────────────────────────────────
// Each non-empty line in [startLine, endLine] becomes { title, page, indent, srcLine }. Lines that
// are too long (leaked body text) or numeral-only (orphan page numbers) are dropped.
export function parsePrintedToc(doc, startLine, endLine) {
  const out = [];
  const lo = Math.max(0, startLine);
  const hi = Math.min(doc.lines.length - 1, endLine);
  for (let li = lo; li <= hi; li++) {
    const line = doc.lines[li];
    if (!line || line.isEmpty) continue;
    const raw = line.text;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^[\dxivlcdm.\s…·•-]+$/i.test(trimmed) && !/[a-z]{2}/i.test(trimmed)) continue; // page-number / dots only
    const { title, page } = splitTitlePage(trimmed);
    const cleanTitle = title.replace(/^[•·–—\-*]\s*/u, '').replace(/\s+/g, ' ').trim();
    if (!cleanTitle || normTitle(cleanTitle).length < 2) continue;
    if (cleanTitle.split(/\s+/).length > 16) continue; // probably wrapped body text, not an entry
    const indent = raw.length - raw.replace(/^\s+/, '').length;
    out.push({ title: cleanTitle, page, indent, srcLine: li });
  }
  return out;
}

// Hierarchy levels for the parsed entries. Indentation in the printed TOC is the clearest signal,
// so when there's more than one indent value we rank by indent; otherwise we fall back to keyword
// tier (Book/Part/Chapter…) and dotted-number depth (1.2.3 → level 2).
function dottedDepth(title) {
  const m = title.match(/^\s*(\d+(?:\.\d+)+)/);
  return m ? m[1].split('.').length - 1 : null;
}
export function assignLevels(parsed) {
  const indents = [...new Set(parsed.map((p) => p.indent))].sort((a, b) => a - b);
  const useIndent = indents.length > 1 && indents.length <= 6;
  const levels = parsed.map((p) => {
    if (useIndent) return indents.indexOf(p.indent);
    const dd = dottedDepth(p.title);
    if (dd != null) return dd;
    return keywordLevel(p.title);
  });
  return levels;
}

// ── match each parsed title to a heading line in the body ────────────────────────────────────────
// Searches forward from `fromLine`, keeping a monotonic cursor so entries map in order. Returns a
// list aligned 1:1 with `parsed`; unmatched entries carry wordIndex = null.
export function matchEntriesToBody(doc, parsed, fromLine) {
  const bodyLines = [];
  for (let li = Math.max(0, fromLine); li < doc.lines.length; li++) {
    const ln = doc.lines[li];
    if (!ln || ln.isEmpty || ln.startWordIndex < 0) continue;
    const t = ln.text.trim();
    if (!t || t.length > 100) continue;
    bodyLines.push({ li, norm: normTitle(t), startWordIndex: ln.startWordIndex });
  }
  const out = [];
  let cursor = 0;
  for (const p of parsed) {
    const target = normTitle(p.title);
    if (!target) { out.push({ wordIndex: null, title: p.title, matched: false, page: p.page }); continue; }
    const minScore = target.split(' ').length <= 2 ? 0.85 : 0.58;
    let best = -1;
    let bestScore = 0;
    const limit = Math.min(bodyLines.length, cursor + 6000);
    for (let k = cursor; k < limit; k++) {
      const sc = matchScore(bodyLines[k].norm, target);
      if (sc >= minScore && sc > bestScore) {
        best = k;
        bestScore = sc;
        if (sc >= 0.99) break;
      }
    }
    if (best >= 0) {
      out.push({ wordIndex: bodyLines[best].startWordIndex, title: p.title, matched: true, score: bestScore, bodyLine: bodyLines[best].li, page: p.page });
      cursor = best + 1;
    } else {
      out.push({ wordIndex: null, title: p.title, matched: false, page: p.page });
    }
  }
  return out;
}

// Infer levels + locate each parsed title in the body → review candidates (some possibly unmatched).
export function buildFromParsed(doc, parsed, fromLine) {
  if (!parsed || !parsed.length) return [];
  const levels = assignLevels(parsed);
  const matched = matchEntriesToBody(doc, parsed, fromLine);
  return matched.map((m, i) => ({ ...m, level: levels[i] ?? 0 }));
}

// Full pipeline for a normally line-per-entry printed TOC.
export function buildFromPrintedToc(doc, startLine, endLine) {
  return buildFromParsed(doc, parsePrintedToc(doc, startLine, endLine), endLine + 1);
}

// ── guided parsing for a squashed / one-line printed TOC ─────────────────────────────────────────
// Some books print the whole contents on a single wrapped line ("Introduction 1 Chapter One 5 …").
// parsePrintedToc sees one line and finds nothing. These helpers let the user GUIDE the split instead
// of being stopped: we join the region to a blob, offer a best-guess split into "title … page" pieces
// (which they can then hand-edit line by line), and parse the edited text.
export function joinRegion(doc, startLine, endLine) {
  const lo = Math.max(0, startLine), hi = Math.min(doc.lines.length - 1, endLine);
  let blob = '';
  for (let li = lo; li <= hi; li++) { const ln = doc.lines[li]; if (ln && !ln.isEmpty && ln.text.trim()) blob += (blob ? ' ' : '') + ln.text.trim(); }
  return blob.replace(/[.…·•‧]{2,}/g, ' ').replace(/\s+/g, ' ').trim(); // drop dot leaders
}

// Best-guess split of a squashed blob: newline after each page number that's followed by a capital
// (the likely start of the next entry). A starting point the user refines by editing the text.
export function autoSplitSquashed(blob) {
  return String(blob).replace(/(\s\d{1,4})\s+(?=[A-Z0-9])/g, '$1\n').trim();
}

// Parse hand-split text (one entry per line) into { title, page, indent } candidates.
export function parseManualToc(text) {
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const trimmed = rawLine.replace(/[.…·•‧]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const { title, page } = splitTitlePage(trimmed);
    const clean = title.replace(/^[•·–—\-*]\s*/u, '').trim();
    if (!clean || normTitle(clean).length < 2) continue;
    out.push({ title: clean, page, indent: rawLine.length - rawLine.replace(/^\s+/, '').length, srcLine: 0 });
  }
  return out;
}

// Indices of candidates whose located position is OUT OF SEQUENCE — a printed TOC is monotonic, so a
// matched entry whose word index isn't strictly between its nearest matched neighbours is suspect
// (usually a mis-match). Pure; used to warning-flag rows and to bound auto-location.
export function outOfSequence(candidates) {
  const wi = candidates.map((c) => (c.matched && Number.isFinite(c.wordIndex) ? c.wordIndex : null));
  const bad = new Set();
  for (let a = 0; a < wi.length; a++) {
    if (wi[a] == null) continue;
    let prev = null; for (let k = a - 1; k >= 0; k--) if (wi[k] != null) { prev = wi[k]; break; }
    let next = null; for (let k = a + 1; k < wi.length; k++) if (wi[k] != null) { next = wi[k]; break; }
    if ((prev != null && wi[a] <= prev) || (next != null && wi[a] >= next)) bad.add(a);
  }
  return bad;
}

// The in-sequence word-index window for the entry at `index`: (lo, hi) exclusive, bounded by its
// nearest matched neighbours above and below. A candidate line at word w is in sequence iff lo<w<hi.
export function seqWindow(candidates, index) {
  let lo = -1, hi = Infinity;
  for (let k = index - 1; k >= 0; k--) { const c = candidates[k]; if (c?.matched && Number.isFinite(c.wordIndex)) { lo = c.wordIndex; break; } }
  for (let k = index + 1; k < candidates.length; k++) { const c = candidates[k]; if (c?.matched && Number.isFinite(c.wordIndex)) { hi = c.wordIndex; break; } }
  return { lo, hi };
}

// Auto-locate every still-unmatched entry: walk the list in order and, for each, grab the best body
// line that matches its title AND falls inside its in-sequence window (so a fill never breaks order).
export function autoLocateRemaining(doc, candidates) {
  const bodyLines = [];
  for (let li = 0; li < doc.lines.length; li++) {
    const ln = doc.lines[li];
    if (!ln || ln.isEmpty || ln.startWordIndex < 0) continue;
    const t = ln.text.trim();
    if (!t || t.length > 100) continue;
    bodyLines.push({ li, norm: normTitle(t), wi: ln.startWordIndex });
  }
  const out = candidates.map((c) => ({ ...c }));
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c.matched && Number.isFinite(c.wordIndex)) continue;
    const target = normTitle(c.title);
    if (!target) continue;
    const { lo, hi } = seqWindow(out, i);
    const minScore = target.split(' ').length <= 2 ? 0.8 : 0.5;
    let best = null, bestScore = minScore;
    for (const bl of bodyLines) {
      if (bl.wi <= lo || bl.wi >= hi) continue;   // keep it in sequence
      const sc = matchScore(bl.norm, target);
      if (sc >= bestScore) { bestScore = sc; best = bl; }
    }
    if (best) out[i] = { ...c, wordIndex: best.wi, matched: true, score: bestScore, bodyLine: best.li };
  }
  return out;
}

// Turn reviewed candidates into final, stored TOC entries: keep matched ones, sort by position,
// shift the shallowest level to 0.
export function finalizeEntries(candidates) {
  const kept = candidates
    .filter((c) => c.matched && Number.isFinite(c.wordIndex))
    .map((c) => ({ wordIndex: c.wordIndex, title: c.title, level: Math.max(0, c.level || 0) }))
    .sort((a, b) => a.wordIndex - b.wordIndex);
  return normalizeLevels(kept);
}

// ── locate the printed TOC region automatically ──────────────────────────────────────────────────
// Looks for a "Contents" / "Table of Contents" heading in the front matter and the list block that
// follows it. Returns { headingLine, startLine, endLine } (array indices) or null.
const CONTENTS_RX = /^\s*(table\s+of\s+)?contents\s*$/i;
// A printed-TOC page number: set off by dot leaders or column alignment (2+ spaces). This is the
// signal that distinguishes a contents entry ("The Beginning ...... 12") from a body heading
// ("Chapter 1") that merely looks short.
const PAGE_TAIL = /(?:[.…·•‧]\s*\d{1,4}|\s{2,}\d{1,4})\s*$/u;
export function detectTocRegion(doc) {
  const scanMax = Math.min(doc.lines.length, 1200);
  let headingLine = -1;
  for (let li = 0; li < scanMax; li++) {
    if (CONTENTS_RX.test(doc.lines[li].text || '')) { headingLine = li; break; }
  }
  if (headingLine < 0) return null;
  let start = headingLine + 1;
  while (start < scanMax && doc.lines[start].isEmpty) start++;
  let end = start - 1;
  let blanks = 0;
  let entriesSeen = 0;
  let sawPage = false;
  for (let li = start; li < scanMax; li++) {
    const ln = doc.lines[li];
    if (ln.isEmpty) { blanks++; if (blanks >= 2 && entriesSeen >= 1) break; continue; }
    blanks = 0;
    const t = ln.text.trim();
    const wc = t.split(/\s+/).length;
    if (PAGE_TAIL.test(t)) { end = li; entriesSeen++; sawPage = true; continue; } // page-numbered entry
    if (sawPage) break;                            // page numbers stopped → the body has begun
    if (wc <= 7 || HEAD_RX.test(t)) { end = li; entriesSeen++; continue; } // page-less contents list
    break;                                          // a prose line → not part of the contents
  }
  if (entriesSeen < 2) return null;
  return { headingLine, startLine: start, endLine: Math.max(start, end) };
}
