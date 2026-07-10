// Scrape bibliographic hints from a document's FRONT MATTER (the first few thousand characters):
// Project Gutenberg headers (Title: / Author: / Release date:), copyright lines, ISBNs, and lone
// "by <Name>" lines. Pure — see textMeta.demo.mjs. Deliberately conservative: a missed field is
// fine (the user can type it); a wrong grab is not.
export function extractTextMeta(front) {
  const s = String(front || '');
  const out = {};
  const author = s.match(/^\s*Author:\s*(.+)$/im)?.[1]
    || s.match(/^\s*by\s+([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})\s*$/m)?.[1];
  if (author) out.author = author.trim().replace(/\s+/g, ' ');
  const title = s.match(/^\s*Title:\s*(.+)$/im)?.[1];
  if (title) out.title = title.trim();
  const isbnRaw = s.match(/ISBN[-:\s]*((?:97[89][- ]?)?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?[\dxX])/)?.[1];
  if (isbnRaw) {
    const digits = isbnRaw.replace(/[^0-9xX]/g, '');
    if (digits.length === 10 || digits.length === 13) out.isbn = digits;
  }
  // Year only from explicit publication/copyright/release phrasing — never a stray 4-digit number.
  // (Bounded lazy gap so "Release date: January 1, 1994" still reaches its year.)
  const year = s.match(/(?:first published|published|release date|copyright(?:\s*©)?|©).{0,28}?\b(1[5-9]\d\d|20\d\d)\b/i)?.[1];
  if (year) out.year = Number(year);
  return out;
}
