// Pure aggregates for the Typing Progress page: per-week summaries and an overall first-vs-recent
// progress comparison (absolute + relative). Runs are { ts, netWpm, accuracy, words, durationMs }.

const WEEK = 7 * 86400000;
const mondayOf = (t) => {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
};

// Weekly rollups, newest first. Only weeks with runs appear; each row carries the delta of its
// average net WPM vs the PREVIOUS active week (null for the oldest).
export function typingWeekly(runs, { weeks = 12 } = {}) {
  const byWeek = new Map();
  for (const r of runs || []) {
    if (!r?.ts) continue;
    const w = mondayOf(r.ts);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(r);
  }
  const rows = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([w, rs]) => ({
    week: new Date(w).toISOString().slice(0, 10),
    end: new Date(w + WEEK - 86400000).toISOString().slice(0, 10),
    runs: rs.length,
    avgNet: Math.round(rs.reduce((a, r) => a + (r.netWpm || 0), 0) / rs.length),
    best: Math.max(...rs.map((r) => r.netWpm || 0)),
    avgAcc: Math.round((rs.reduce((a, r) => a + (r.accuracy || 0), 0) / rs.length) * 10) / 10,
    words: rs.reduce((a, r) => a + (r.words || 0), 0),
    ms: rs.reduce((a, r) => a + (r.durationMs || 0), 0),
  }));
  for (let i = 0; i < rows.length; i++) rows[i].deltaNet = i > 0 ? rows[i].avgNet - rows[i - 1].avgNet : null;
  return rows.reverse().slice(0, weeks);
}

// Overall progress: earliest N runs vs latest N (N = up to 10, at most half the history so the
// windows never overlap). Returns null with fewer than 4 runs — not enough for a fair comparison.
export function typingOverall(runs, { window = 10 } = {}) {
  const rs = (runs || []).filter((r) => r?.ts).sort((a, b) => a.ts - b.ts);
  if (rs.length < 4) return null;
  const n = Math.min(window, Math.floor(rs.length / 2));
  const avg = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0) / arr.length;
  const first = rs.slice(0, n);
  const last = rs.slice(-n);
  const firstNet = Math.round(avg(first, (r) => r.netWpm));
  const lastNet = Math.round(avg(last, (r) => r.netWpm));
  const firstAcc = Math.round(avg(first, (r) => r.accuracy) * 10) / 10;
  const lastAcc = Math.round(avg(last, (r) => r.accuracy) * 10) / 10;
  return {
    n,
    spanDays: Math.max(1, Math.round((rs[rs.length - 1].ts - rs[0].ts) / 86400000)),
    firstNet, lastNet,
    deltaNet: lastNet - firstNet,
    pctNet: firstNet > 0 ? Math.round(((lastNet - firstNet) / firstNet) * 100) : null,
    firstAcc, lastAcc,
    deltaAcc: Math.round((lastAcc - firstAcc) * 10) / 10,
  };
}
