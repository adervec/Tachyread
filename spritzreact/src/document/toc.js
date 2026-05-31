// Table-of-contents helpers shared by the TOC pane, the current-chapter heading and the
// minimap TOC bar. Entries are a flat list sorted by wordIndex, each carrying a `level`
// (0 = top tier). The hierarchy (book → part → chapter …) is derived from those levels the
// same way Markdown headings nest: an entry owns every following entry of a deeper level
// until one of equal or shallower level appears.

import { getLineIndex } from './readerDocument.js';

const HEAD_RX = /^\s*(chapter|part|book|volume|section|prologue|epilogue|appendix|introduction|foreword|preface)\b/i;

// Keyword → tier. Lower = higher in the hierarchy. Generic capitalised lines fall to leaf tier.
const TIER_KEYWORDS = [
  { rx: /^\s*(book|volume)\b/i, level: 0 },
  { rx: /^\s*part\b/i, level: 1 },
  { rx: /^\s*(chapter|section|prologue|epilogue|appendix|introduction|foreword|preface)\b/i, level: 2 },
];

function keywordLevel(text) {
  for (const k of TIER_KEYWORDS) if (k.rx.test(text)) return k.level;
  return 2; // generic short heading → leaf tier
}

// Shift the smallest present level to 0 so a chapters-only document shows its chapters at the
// top tier instead of indented under empty book/part tiers.
function normalizeLevels(entries) {
  if (!entries.length) return entries;
  const min = Math.min(...entries.map((e) => e.level || 0));
  if (!min) return entries;
  return entries.map((e) => ({ ...e, level: (e.level || 0) - min }));
}

// Heuristic auto-detection: short lines that look like headings → [{ wordIndex, title, level }].
export function autoDetectToc(doc) {
  const entries = [];
  for (let li = 0; li < doc.lines.length; li++) {
    const line = doc.lines[li];
    if (line.isEmpty || line.startWordIndex < 0) continue;
    const text = line.text.trim();
    if (!text || text.length > 80) continue;
    const wc = text.split(/\s+/).length;
    if (wc > 8) continue;
    const looksHead = HEAD_RX.test(text) || /^[A-Z0-9][A-Za-z0-9 ,'’\-:&]{1,60}$/.test(text);
    if (!looksHead) continue;
    entries.push({ wordIndex: line.startWordIndex, title: text, level: keywordLevel(text) });
  }
  return normalizeLevels(entries.slice(0, 400));
}

// Stored custom entries take precedence over auto-detection; always returned sorted with a
// numeric `level` present (defaults to 0 for older entries saved before hierarchy existed).
export function getTocEntries(tab) {
  const stored = tab.settings.tocEntries;
  const list = stored && stored.length ? stored : autoDetectToc(tab.doc);
  return [...list]
    .map((e) => ({ ...e, level: Number.isFinite(e.level) ? e.level : 0 }))
    .sort((a, b) => a.wordIndex - b.wordIndex);
}

// Build a nested tree from the flat, level-tagged, sorted list. Each node carries the entry's
// index in the flat list (a stable id for stats / edit / flash) and its children.
export function buildTocTree(entries) {
  const roots = [];
  const stack = []; // nodes currently open, by increasing level
  entries.forEach((entry, index) => {
    const node = { entry, index, level: entry.level || 0, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

// Word span a section covers, *including* its descendants: from its wordIndex up to the start
// of the next entry at an equal or shallower level (or the end of the document).
export function sectionSpan(entries, i, totalWords) {
  const start = entries[i].wordIndex;
  const lvl = entries[i].level || 0;
  let end = totalWords;
  for (let k = i + 1; k < entries.length; k++) {
    if ((entries[k].level || 0) <= lvl) {
      end = entries[k].wordIndex;
      break;
    }
  }
  return { start, end: Math.max(start, end) };
}

// Which (deepest) section the current word falls in + progress within it. The deepest active
// heading is simply the last entry whose wordIndex precedes the cursor.
export function currentChapter(entries, wordIndex, totalWords) {
  if (!entries.length) return null;
  let i = -1;
  for (let k = 0; k < entries.length; k++) {
    if (entries[k].wordIndex <= wordIndex) i = k;
    else break;
  }
  if (i < 0) {
    const end = entries[0].wordIndex || totalWords;
    return { index: -1, title: '(front matter)', level: 0, start: 0, end, progress: end ? wordIndex / end : 0, count: entries.length };
  }
  // Leaf span runs to the *next entry of any level* (progress through this heading's own text).
  const start = entries[i].wordIndex;
  const end = i + 1 < entries.length ? entries[i + 1].wordIndex : totalWords;
  const span = Math.max(1, end - start);
  return {
    index: i,
    title: entries[i].title,
    level: entries[i].level || 0,
    start,
    end,
    progress: Math.max(0, Math.min(1, (wordIndex - start) / span)),
    count: entries.length,
  };
}

// Convenience: start position of a section as line / word / percent.
export function sectionStartInfo(doc, wordIndex) {
  const total = doc.words.length || 1;
  return {
    line: getLineIndex(doc, wordIndex) + 1,
    word: wordIndex + 1,
    pct: (wordIndex / total) * 100,
  };
}

// ── Numeral extraction ───────────────────────────────────────────────────────
const ROMAN_RX = /\b([MDCLXVI]{1,12})\b/;
const ROMAN_MAP = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(s) {
  const t = String(s || '').toUpperCase();
  if (!/^[MDCLXVI]+$/.test(t)) return NaN;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = ROMAN_MAP[t[i]];
    const next = ROMAN_MAP[t[i + 1]];
    total += next && cur < next ? -cur : cur;
  }
  return total;
}

export function intToRoman(n) {
  if (!Number.isFinite(n) || n <= 0 || n >= 4000) return String(n);
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let r = Math.floor(n);
  for (const [v, sym] of table) while (r >= v) { out += sym; r -= v; }
  return out;
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function intToWords(n) {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + intToWords(n % 100) : '');
  return String(n);
}

// Pull a number out of a heading. A per-tier custom regex (capture group 1 = the numeral) wins;
// otherwise we try a leading roman numeral, then any arabic run. Returns the integer or null.
export function extractNumeral(title, customRegex) {
  const text = String(title || '');
  if (customRegex) {
    try {
      const m = text.match(new RegExp(customRegex));
      if (m && m[1] != null) {
        const cap = m[1].trim();
        if (/^\d+$/.test(cap)) return parseInt(cap, 10);
        const r = romanToInt(cap);
        if (Number.isFinite(r) && r > 0) return r;
        return null;
      }
    } catch {
      /* invalid regex → fall through to defaults */
    }
  }
  // Default: a roman numeral that follows a heading keyword, else the first arabic number.
  const afterKw = text.replace(HEAD_RX, '').trim();
  const rm = afterKw.match(ROMAN_RX);
  if (rm) {
    const r = romanToInt(rm[1]);
    if (Number.isFinite(r) && r > 0) return r;
  }
  const am = text.match(/\d+/);
  if (am) return parseInt(am[0], 10);
  return null;
}

// Format an extracted numeral for the TOC-bar badge per the chosen style.
export function formatNumeral(n, style) {
  if (n == null) return '';
  if (style === 'roman') return intToRoman(n);
  if (style === 'words') return intToWords(n);
  if (style === 'arabic') return String(n);
  return '';
}
