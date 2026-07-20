// Open-Recent filtering: a finished book that isn't being reread is noise in the recent list.
// Pure so it can be unit-tested; MenuBar applies it against allFiles() records.

// f: a FileSettings record from storage (completions, dailyHistory, wordIndex, totalWords).
// shelf: the user's explicit shelf for this checksum ('reading'|'finished'|'toread'|'paused') or undefined.
export function finishedNotRereading(f, shelf) {
  if (!f) return false;
  if (shelf && shelf !== 'finished') return false; // explicitly re-shelved → always show
  if (shelf === 'finished') return true; // explicit shelf wins over heuristics
  const comps = Array.isArray(f.completions) ? f.completions : [];
  // wordIndex is the CURRENT word (0-based), so sitting on the last word means totalWords read — the
  // +1 matters for short files, where "last word" is otherwise only ~99% and never counts as done.
  const posFrac = f.totalWords ? Math.min(1, ((f.wordIndex || 0) + 1) / f.totalWords) : 0;
  if (!comps.length) return posFrac >= 0.999; // parked at the very end counts as finished; restarting un-hides
  const lastFinish = comps.map((c) => String(c.date || '').slice(0, 10)).sort().pop();
  // Rereading = reading on a later day than the last finish…
  if ((f.dailyHistory || []).some((d) => (d.wordsRead || 0) > 0 && String(d.date) > lastFinish)) return false;
  // …or already mid-book again (covers same-day restarts, which day-granularity history can't see).
  if (posFrac > 0.005 && posFrac < 0.95) return false;
  return true;
}
