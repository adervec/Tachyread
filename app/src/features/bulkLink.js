// Bulk-link planning for the Trackyread "Unlinked files" scan: score every opened-but-unlinked file
// against the library, tier its best match, and pick a SAFE default action per file. Pure; see
// bulkLink.test.mjs. The dialog renders the rows and applies whatever targets the user leaves in place.
//
// Why not "any shared word links it" (the old rule): a made-up AI title like "The Lighthouse
// Keeper's Daughter" shares a word with Woolf's "The Lighthouse". Dice on the significant tokens
// (2·common / total) wants BOTH sides mostly covered, and a length sanity check knocks a 2,000-word
// one-off off a 100,000-word novel even when the words line up. A weak match defaults to "leave
// unlinked" rather than a guess: a wrong link the user accepts is worse than a file left for later.
import { bookWordCount } from './readingTime.js';
import { bookFromOpenedDoc } from './trackyreadAdd.js';

const STOP = new Set('the a an and or of in on at to for by with from vol volume edition ed part complete works novel ebook txt epub pdf md html'.split(' '));
export function tokensOf(s) {
  return new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
}
export const baseName = (fileName) => String(fileName || '').replace(/\.[a-z0-9]{1,5}$/i, '');

// 0..1: Dice over title tokens (author tokens taken out of the file name first), +0.2 when the
// author's name is in the file name too.
export function matchScore(fileName, book) {
  const author = tokensOf(book?.author);
  const raw = tokensOf(baseName(fileName));
  const f = new Set([...raw].filter((t) => !author.has(t)));
  const t = tokensOf(book?.title);
  if (!f.size || !t.size) return 0;
  const common = [...f].filter((x) => t.has(x)).length;
  const byAuthor = [...author].some((a) => a.length > 2 && raw.has(a)) ? 0.2 : 0;
  return Math.min(1, (2 * common) / (f.size + t.size) + byAuthor);
}

export const STRONG = 0.75, WEAK = 0.4;
export function tierOf(score, fileWords, book) {
  if (score < WEAK) return { tier: 'none', why: 'no book title comes close' };
  const bw = bookWordCount(book);
  if (bw > 0 && fileWords > 0 && (fileWords < bw * 0.25 || fileWords > bw * 4)) {
    return { tier: 'weak', why: `the title fits, but the file is ${fileWords.toLocaleString()} words and the book about ${bw.toLocaleString()}` };
  }
  if (score >= STRONG) return { tier: 'strong', why: `${Math.round(score * 100)}% of the title words match` };
  return { tier: 'weak', why: `only ${Math.round(score * 100)}% of the title words match` };
}

// files: [{ cs, fileName, words, coverage }] — already filtered to the unlinked ones. Rows come back
// best-first, each with its candidates (dropdown), tier, reason, and default target:
// strong → that book · weak → 'skip' (review) · none → 'new:ai-gen' (the typical one-off).
export function planBulkLinks(files, books, { max = 5 } = {}) {
  return (files || []).map((f) => {
    const cands = (books || []).map((book) => ({ book, score: matchScore(f.fileName, book) }))
      .filter((c) => c.score >= 0.25).sort((a, b) => b.score - a.score).slice(0, max);
    const best = cands[0] || null;
    const { tier, why } = best ? tierOf(best.score, f.words || 0, best.book) : tierOf(0);
    const target = tier === 'strong' ? best.book.id : tier === 'weak' ? 'skip' : 'new:ai-gen';
    return { ...f, title: baseName(f.fileName), cands, best, tier, why, target };
  }).sort((a, b) => (b.best?.score || 0) - (a.best?.score || 0) || a.title.localeCompare(b.title));
}

// Reading status for a book created from a file: what the file's own read coverage says.
export const statusForCoverage = (cov) => (cov >= 0.99 ? 'finished' : cov > 0 ? 'reading' : 'toread');
// A new tracker book for a row, typed as chosen ('ai-gen' | 'long' | 'short' | 'article').
export function newBookFor(row, type) {
  const book = { ...bookFromOpenedDoc({ fileName: row.fileName, words: row.words, status: statusForCoverage(row.coverage || 0) }), type };
  return type === 'ai-gen' ? { ...book, tags: ['ai-gen'], recBy: 'Claude' } : book;
}
