// ReaderDocument: parses raw text into words, lines, sentences, with ORP, checksum,
// header/footer detection, and proper-name extraction. Mirrors SPRITZApp/MainWindow.xaml.cs.

export const ReadStatus = Object.freeze({
  Unread: 'Unread',
  Read: 'Read',
  SessionRead: 'SessionRead',
  NavSessionRead: 'NavSessionRead',
  Current: 'Current',
});

export function orpIndex(len) {
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

export function isSentenceEndWord(w) {
  if (!w) return false;
  const last = w[w.length - 1];
  return last === '.' || last === '!' || last === '?';
}

export async function computeChecksum(text) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return 'fb' + (h >>> 0).toString(16);
}

const WS_RE = /[ \t ]+/;

function detectHeaderFooterLines(lines) {
  const result = new Set();
  if (lines.length < 10) return result;
  const freq = new Map();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.length > 80) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  const pageNumRx = /^\s*(?:(?:page\s+)?\d+|[ivxlcdm]+\.?|-\s*\d+\s*-)\s*$/i;
  const threshold = Math.max(3, Math.floor(lines.length / 100));
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (pageNumRx.test(t)) {
      result.add(i);
      continue;
    }
    const count = freq.get(t) || 0;
    if (count >= threshold) {
      const wc = t.split(WS_RE).filter(Boolean).length;
      if (wc <= 6) result.add(i);
    }
  }
  return result;
}

const STOP_WORDS = new Set([
  'The','A','An','And','But','Or','Nor','For','So','Yet','At','By','In','Of','On','To','Up','As',
  'Is','Are','Was','Were','Be','Been','Being','He','She','It','They','We','You','I','Mr','Mrs','Ms','Dr',
  'St','Mt','This','That','These','Those','My','Your','His','Her','Its','Our','Their','If','When',
  'Where','Why','How','What','Who','Which','While','Then','Now','Here','There','Yes','No','Not','Do',
  'Did','Does','Has','Have','Had','Will','Would','Should','Could','Can','May','Might','Must','Once',
  'After','Before','During','Until','Through','With','Without','From','About','Into','Onto','Over',
  'Under','Again','Some','Any','Each','Every','Both','All','One','Two','Three','Four','Five',
  'Chapter','Part','Book','Volume','Section','Page','Note','Notes','Footnote',
]);

function stripPunct(w) {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function detectProperNames(doc) {
  const occMap = new Map();
  for (let i = 0; i < doc.words.length; i++) {
    const raw = doc.words[i];
    const w = stripPunct(raw);
    if (w.length < 2) continue;
    if (!/^\p{Lu}/u.test(w)) continue;
    if (STOP_WORDS.has(w)) continue;
    if (w === w.toUpperCase() && w.length <= 3) continue;
    const isStartOfSentence = i === 0 || isSentenceEndWord(doc.words[i - 1]);
    if (isStartOfSentence) continue;
    const key = w.toLowerCase();
    if (!occMap.has(key)) occMap.set(key, { canonical: w, indices: [] });
    occMap.get(key).indices.push(i);
  }
  const final = new Map();
  for (const [key, val] of occMap) {
    if (val.indices.length < 2) continue;
    final.set(key, val);
  }
  doc.properNames = final;
}

function findFootnoteMarkers(doc) {
  const fmap = new Map();
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const re = /(?:\[(\d+)\]|\((\d+)\)|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))/;
  for (let wi = 0; wi < doc.words.length; wi++) {
    const m = doc.words[wi].match(re);
    if (!m) continue;
    let num;
    if (m[1]) num = parseInt(m[1], 10);
    else if (m[2]) num = parseInt(m[2], 10);
    else if (m[3]) num = m[3].split('').map((c) => SUP.indexOf(c)).join('') | 0;
    if (!num || num > 999) continue;
    if (!fmap.has(num)) fmap.set(num, { number: num, anchors: [], body: '' });
    fmap.get(num).anchors.push(wi);
  }
  // Match against body lines like "1. ..." or "1) ..."
  const bodyRe = /^\s*(\d+)[\.\)]\s+(.{2,})$/;
  for (let li = 0; li < doc.lines.length; li++) {
    const m = doc.lines[li].text.match(bodyRe);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (fmap.has(n) && !fmap.get(n).body) {
      fmap.get(n).body = m[2].trim();
      fmap.get(n).bodyLine = li;
    }
  }
  doc.footnotes = fmap;
}

export function readerDocFromText(text, displayName, filePath = '') {
  const norm = text.replace(/\r\n?/g, '\n');
  const rawLines = norm.split('\n');
  const words = [];
  const lines = [];
  const wordToLine = [];

  for (let li = 0; li < rawLines.length; li++) {
    const lineText = rawLines[li];
    const startIdx = words.length;
    const lineWords = lineText.split(WS_RE).filter(Boolean);
    for (const w of lineWords) {
      wordToLine.push(li);
      words.push(w);
    }
    lines.push({
      lineNumber: li + 1,
      text: lineText,
      startWordIndex: startIdx,
      endWordIndex: lineWords.length > 0 ? words.length - 1 : -1,
      isEmpty: lineWords.length === 0,
    });
  }

  const sentences = [];
  const wordToSentence = new Array(words.length);
  let sStart = 0;
  for (let i = 0; i < words.length; i++) {
    wordToSentence[i] = sentences.length;
    if (isSentenceEndWord(words[i]) || i === words.length - 1) {
      sentences.push({ startWordIndex: sStart, endWordIndex: i });
      sStart = i + 1;
    }
  }

  // Mark paragraph starts (first non-empty line after empty lines, or first line)
  let prevEmpty = true;
  for (const line of lines) {
    line.isParaStart = !line.isEmpty && prevEmpty;
    prevEmpty = line.isEmpty;
  }

  const doc = {
    filePath,
    fileName: displayName,
    words,
    lines,
    wordToLine,
    sentences,
    wordToSentence,
    headerFooterLines: detectHeaderFooterLines(rawLines),
    properNames: new Map(),
    footnotes: new Map(),
    contentChecksum: '',
    fullText: norm,
  };

  // Proper-name detection is opt-in (heavy for large docs); call detectProperNames(doc) lazily.
  findFootnoteMarkers(doc);
  return doc;
}

export async function attachChecksum(doc) {
  doc.contentChecksum = await computeChecksum(doc.fullText);
  return doc;
}

export function getLineIndex(doc, wordIndex) {
  if (doc.wordToLine.length === 0) return 0;
  const i = Math.max(0, Math.min(doc.wordToLine.length - 1, wordIndex));
  return doc.wordToLine[i];
}

export function getSentenceIndex(doc, wordIndex) {
  if (doc.wordToSentence.length === 0) return 0;
  const i = Math.max(0, Math.min(doc.wordToSentence.length - 1, wordIndex));
  return doc.wordToSentence[i];
}

export function getParagraphRange(doc, lineIndex) {
  let start = lineIndex;
  while (start > 0 && !doc.lines[start].isEmpty && !doc.lines[start].isParaStart) start--;
  if (doc.lines[start].isEmpty) start++;
  let end = lineIndex;
  while (end < doc.lines.length - 1 && !doc.lines[end + 1].isEmpty) end++;
  return { startLine: start, endLine: end };
}

export function isDigitWord(w) {
  return /^\d+(?:[.,]\d+)?$/.test(w);
}

export function isLongWord(w, threshold) {
  return w.length >= threshold;
}

export function hasSpecialChars(w) {
  return /[^\p{L}\p{N}\s'’.,!?;:()\-]/u.test(w);
}
