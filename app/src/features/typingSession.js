// "Current typing session" = today's trailing cluster of runs. A day can hold more than one
// sitting: a multi-hour break splits it, so morning practice doesn't pad the evening's numbers.
// Used by the in-run info panel that takes over the (locked) controls area while you type.

export const SESSION_GAP_MS = 2 * 3600000; // "multi-hour break" — 2h+ between runs = a new sitting

const sameLocalDay = (a, b) => {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

// The runs belonging to the sitting that `now` is part of: today's runs, walked backwards from
// `now`, stopping at the first gap over gapMs. If even the newest run is a full break ago, the
// current sitting simply has no prior runs yet.
export function currentSession(runs, now = Date.now(), { gapMs = SESSION_GAP_MS } = {}) {
  const today = (runs || [])
    .filter((r) => r?.ts && sameLocalDay(r.ts, now) && r.ts <= now)
    .sort((a, b) => a.ts - b.ts);
  const out = [];
  let edge = now;
  for (let i = today.length - 1; i >= 0; i--) {
    if (edge - today[i].ts > gapMs) break;
    out.unshift(today[i]);
    // The next gap is measured to when this run STARTED, so a long run can't split its own sitting.
    edge = today[i].ts - (today[i].durationMs || 0);
  }
  return out;
}

// Aggregates for one sitting. `liveRun` folds the in-progress run in ({ netWpm, accuracy, words,
// durationMs }) so the panel counts what you're typing right now, not just what's already saved.
export function sessionStats(runs, liveRun = null) {
  const all = [...(runs || []), ...(liveRun && (liveRun.words > 0 || liveRun.durationMs > 0) ? [liveRun] : [])];
  if (!all.length) return null;
  const sum = (f) => all.reduce((a, r) => a + (f(r) || 0), 0);
  const ms = sum((r) => r.durationMs);
  const words = sum((r) => r.words);
  return {
    runs: all.length,
    words,
    ms,
    // Time-weighted net/accuracy — a 10-minute run should count for more than a 30-second one.
    avgNet: ms > 0 ? Math.round(all.reduce((a, r) => a + (r.netWpm || 0) * (r.durationMs || 0), 0) / ms) : 0,
    avgAcc: ms > 0 ? Math.round((all.reduce((a, r) => a + (r.accuracy || 0) * (r.durationMs || 0), 0) / ms) * 10) / 10 : 0,
    best: Math.max(...all.map((r) => r.netWpm || 0)),
  };
}

// Book-typing forecast: how much is left and how long at the sitting's pace.
export function bookForecast({ totalWords = 0, throughWord = 0, avgNet = 0 }) {
  if (!totalWords) return null;
  const through = Math.max(0, Math.min(totalWords, throughWord));
  const left = totalWords - through;
  return {
    through,
    left,
    pct: Math.round((through / totalWords) * 1000) / 10,
    etaMin: avgNet > 0 && left > 0 ? Math.ceil(left / avgNet) : null,
  };
}
