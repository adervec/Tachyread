// "What am I forgetting?" for the Trackyread library.
//
// A book you finished six months ago and never revisited is fading, whether or not you notice. This
// estimates how much of each finished book you'd still have, using a plain forgetting-curve model
// (Ebbinghaus): retention decays exponentially with time since you last read it, and each re-read
// makes the memory more durable (a longer decay constant). The point isn't a precise number — it's
// a ranked nudge toward the books slipping away while there's still enough left to refresh cheaply.
//
// Pure; see journeyForgetting.test.mjs.

import { finishMs, readStatus, bookRating } from './journeyLibrary.js';

const DAY = 86400000;
// Memory "stability" (the decay constant, in days) for a book read once. Retention = e^(-t/S), so
// after S days you're at ~37%. 30 days is a deliberately gentle default — most people remember the
// gist of a book longer than a fact on a flashcard.
export const BASE_STABILITY_DAYS = 30;
export const REREAD_FACTOR = 2.1;   // each additional finish multiplies stability (1→30d, 2→63d, 3→132d)
export const FRESH_ABOVE = 0.7;     // above this you still have it — not "being forgotten"
export const FADED_BELOW = 0.3;     // below this it's largely gone

// How many times this book has been finished (re-reads reinforce). At least 1 for a finished book.
function finishCount(b) {
  const hist = Array.isArray(b?.finishHistory) ? b.finishHistory.length : 0;
  return 1 + hist;
}

// The most recent finish, epoch ms — the last time the memory was refreshed.
function lastFinishMs(b) {
  const hist = (Array.isArray(b?.finishHistory) ? b.finishHistory : []).map((d) => (typeof d === 'number' ? d : Date.parse(d))).filter((n) => Number.isFinite(n));
  const latest = finishMs(b);
  return Math.max(latest ?? -Infinity, ...(hist.length ? hist : [-Infinity]));
}

// Estimated stability (decay constant) in days for a book, before time is applied. Grows with
// re-reads; nudged a little by how much you liked it (loved books stick better) and difficulty
// (harder books fade faster). All small, bounded effects — this is a heuristic, not a claim.
export function memoryStabilityDays(b) {
  let s = BASE_STABILITY_DAYS * REREAD_FACTOR ** (finishCount(b) - 1);
  const rating = bookRating(b); // 0 (unrated) or 1..5
  if (rating) s *= 1 + (rating - 3) * 0.08;            // 5★ → +16%, 1★ → −16%
  const diff = Number(b?.difficultyLevel) || 0;         // 0 (unknown) or 1..5
  if (diff) s *= 1 - (diff - 3) * 0.05;                 // hard (5) → −10%, easy (1) → +10%
  return Math.max(1, s);
}

// Estimated current retention 0..1 for a finished book, or null if it isn't finished / has no date.
export function retentionOf(b, now = Date.now()) {
  if (readStatus(b) !== 'finished') return null;
  const last = lastFinishMs(b);
  if (!Number.isFinite(last)) return null;
  const days = Math.max(0, (now - last) / DAY);
  return Math.exp(-days / memoryStabilityDays(b));
}

export function retentionTier(r) {
  if (r == null) return 'unknown';
  if (r >= FRESH_ABOVE) return 'fresh';
  if (r >= FADED_BELOW) return 'fading';
  return 'faded';
}

// The forgetting scan: finished books that are no longer fresh, most-at-risk first. "In the process
// of being forgotten" = the FADING band (still enough left that a quick refresh sticks); FADED books
// (largely gone) come after, so the list leads with what's worth saving now. A book you're actively
// re-reading is excluded — you're already on it.
export function forgettingScan(books, now = Date.now()) {
  const out = [];
  for (const b of books || []) {
    if (readStatus(b) === 'reading') continue;
    const r = retentionOf(b, now);
    if (r == null || r >= FRESH_ABOVE) continue;
    const last = lastFinishMs(b);
    out.push({
      id: b.id,
      title: b.title || 'Untitled',
      author: b.author || '',
      retention: r,
      tier: retentionTier(r),
      daysSince: Math.round((now - last) / DAY),
      reads: finishCount(b),
    });
  }
  // Fading before faded (worth refreshing first), then by lowest retention, then title for stability.
  const rank = { fading: 0, faded: 1 };
  return out.sort((a, b) =>
    (rank[a.tier] - rank[b.tier])
    || (a.retention - b.retention)
    || String(a.title).localeCompare(String(b.title)));
}

export function forgettingSummary(scan) {
  const out = { fading: 0, faded: 0 };
  for (const s of scan || []) out[s.tier] = (out[s.tier] || 0) + 1;
  return out;
}
