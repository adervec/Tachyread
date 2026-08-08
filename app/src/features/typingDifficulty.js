// Text difficulty, so typing progress compares like with like.
//
// Raw WPM says as much about the text as about you: a numbers drill or a page of dialogue with
// quotes and capitals reads as a slump even when your hands got faster. WPM is already chars/5, so
// word length is normalised away — what's left is which KEYS the text made you hit.
//
// Every run already stores `keys` ({ char: { n, err } }), a histogram of the characters actually
// typed, so difficulty is derived from history that already exists — no new capture, and old runs
// score too. It also lowercases when case-sensitivity is off, which is exactly right: if the run
// never demanded a capital, it never charged you for shift.

// Relative keystroke effort on a QWERTY board. Home row is the unit; everything else is priced
// against it. ponytail: a flat per-character table, not a bigram/same-finger model — the histogram
// has no sequence in it. Store bigrams on runs if rolls and finger repeats need pricing too.
const HOME = 'asdfghjkl;';
const SHIFTED_SYMBOLS = '~!@#$%^&*()_+{}|:"<>?';
const PLAIN_SYMBOLS = "`-=[]\\;',./";

export function charCost(ch) {
  const c = String(ch || '');
  if (!c) return 0;
  if (c.length !== 1) return 2.3;                       // exotic / multi-code-unit
  if (c >= 'a' && c <= 'z') return HOME.includes(c) ? 1.0 : 1.12;
  if (c >= 'A' && c <= 'Z') return 1.9;                 // shift held
  if (c >= '0' && c <= '9') return 1.75;                // number row, no home anchor
  if (SHIFTED_SYMBOLS.includes(c)) return 2.1;          // shift + a reach
  if (PLAIN_SYMBOLS.includes(c)) return 1.35;
  if (c === ' ') return 0.55;
  return 2.3;                                           // accents, curly quotes, em dashes…
}

// Mean cost of ordinary lowercase English prose, so that text scores 1.00. Derived from letter
// frequency (~34% of letters sit on the home row) plus the punctuation prose actually carries; the
// self-check pins it against a real sample rather than trusting the arithmetic.
export const BASELINE_COST = 1.09;

const MIN_CHARS = 40; // below this a run is too short to say anything about its text

// 1.00 = ordinary prose. Above = harder text than baseline, below = easier.
// Runs with no key profile (recorded before this shipped) score 1 so they never skew a comparison.
export function runDifficulty(run) {
  const keys = run?.keys;
  if (!keys) return 1;
  let n = 0;
  let cost = 0;
  for (const ch of Object.keys(keys)) {
    const c = keys[ch]?.n || 0;
    if (c > 0) { n += c; cost += c * charCost(ch); }
  }
  if (n < MIN_CHARS) return 1;
  const d = cost / n / BASELINE_COST;
  return Math.round(Math.min(2.5, Math.max(0.6, d)) * 100) / 100;
}

// What this run's pace is worth on baseline prose — the number to compare across sessions.
export const adjustedNet = (run) => Math.round((run?.netWpm || 0) * runDifficulty(run));

export function difficultyLabel(d) {
  if (d < 0.95) return 'Easy';
  if (d < 1.1) return 'Normal';
  if (d < 1.3) return 'Hard';
  return 'Very hard';
}

// Swap raw net WPM for the difficulty-adjusted figure, so every existing aggregate (the chart,
// weekly rollups, first-vs-recent) can be reused unchanged on normalised numbers.
export const normalizeRuns = (runs) =>
  (runs || []).map((r) => ({ ...r, netWpm: adjustedNet(r), rawNetWpm: r.netWpm, difficulty: runDifficulty(r) }));

// Rollup per difficulty band, easiest first — "am I actually slower on hard text, and by how much?"
export function difficultyRows(runs) {
  const order = ['Easy', 'Normal', 'Hard', 'Very hard'];
  const by = new Map();
  for (const r of runs || []) {
    const d = runDifficulty(r);
    const band = difficultyLabel(d);
    if (!by.has(band)) by.set(band, []);
    by.get(band).push({ r, d });
  }
  return order.filter((b) => by.has(b)).map((band) => {
    const rows = by.get(band);
    const avg = (f) => rows.reduce((a, x) => a + f(x), 0) / rows.length;
    return {
      band,
      runs: rows.length,
      avgDifficulty: Math.round(avg((x) => x.d) * 100) / 100,
      avgNet: Math.round(avg((x) => x.r.netWpm || 0)),
      avgAdj: Math.round(avg((x) => adjustedNet(x.r))),
      avgAcc: Math.round(avg((x) => x.r.accuracy || 0) * 10) / 10,
      best: Math.max(...rows.map((x) => x.r.netWpm || 0)),
    };
  });
}
