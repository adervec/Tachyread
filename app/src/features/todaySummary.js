// The Trackyread dashboard's "Today" card: what you've read today and how it stacks up. Pure.
//   dayAgg    [{date, wordsRead, activeSecs, aloudWords?, aloudSecs?}] — all files, per day
//   fileStats { checksum: { fileName, coverage, today: {words, secs} | undefined } }
//   bookOf    checksum → tracker book (or null)
// LOCAL calendar dates — the reading tracker records days in local time.
export const localDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayBefore = (s) => { const [y, m, d] = s.split('-').map(Number); return localDate(new Date(y, m - 1, d - 1)); };

// Consecutive reading days ending today — or ending yesterday, when today hasn't started yet (the
// streak is still alive; read today to keep it).
export function readingStreak(dayAgg, now = Date.now()) {
  const read = new Set((dayAgg || []).filter((d) => (d.wordsRead || 0) > 0).map((d) => d.date));
  const today = localDate(now);
  const readToday = read.has(today);
  let days = 0;
  for (let d = readToday ? today : dayBefore(today); read.has(d); d = dayBefore(d)) days++;
  return { days, readToday };
}

export function todaySummary({ dayAgg = [], fileStats = {}, bookOf = () => null, books = [], now = Date.now() } = {}) {
  const today = localDate(now);
  const d = (dayAgg || []).find((x) => x.date === today) || {};
  const readW = (d.wordsRead || 0) - (d.aloudWords || 0), readS = (d.activeSecs || 0) - (d.aloudSecs || 0);
  const files = Object.entries(fileStats)
    .filter(([, f]) => f.today && (f.today.words > 0 || f.today.secs > 0))
    .map(([cs, f]) => ({ cs, name: f.fileName, words: f.today.words || 0, secs: f.today.secs || 0, coverage: f.coverage || 0, book: bookOf(cs) }))
    .sort((a, b) => b.words - a.words);
  const finished = (books || []).filter((b) => !b.deleted && String(b.finishTime || '').slice(0, 10) === today);
  return {
    today,
    words: d.wordsRead || 0,
    secs: d.activeSecs || 0,
    aloudWords: d.aloudWords || 0,
    wpm: readS > 30 ? Math.round(readW / (readS / 60)) : null, // reading speed, read-aloud left out
    files, finished,
    streak: readingStreak(dayAgg, now),
  };
}
