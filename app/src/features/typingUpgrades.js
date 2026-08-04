// Pure engine pieces for the typing-practice upgrade wave (the "between-runs" layer the classic
// trainers are loved for): keystroke consistency (Monkeytype), personal bests per mode, daily
// typing streaks, problem-word mining + review drills (Amphetype/TIPP10-style), per-key/per-finger
// error profiles (Keybr/TIPP10), and the pace-caret math (Monkeytype's pace caret / TypeRacer's
// ghost). All pure — see typingUpgrades.test.mjs.

// ── consistency ─────────────────────────────────────────────────────────────
// Keystroke-timing consistency as a percentage: 100 × (1 − coefficient of variation) of the
// inter-key intervals, clamped to 0..100 (Monkeytype's definition, near enough). Pauses over 2s
// are thinking, not typing rhythm, and batch-scored keys (0ms) carry no timing — both filtered.
export function consistencyPct(intervals) {
  const xs = (intervals || []).filter((v) => Number.isFinite(v) && v > 0 && v < 2000);
  if (xs.length < 5) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return null;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return Math.round(Math.max(0, Math.min(100, (1 - sd / mean) * 100)));
}

// ── personal bests ──────────────────────────────────────────────────────────
// Which records a finished run just beat, judged against the runs BEFORE it. A first-ever run
// (or first in its mode) is a baseline, not a celebration.
export function pbFlags(pastRuns, run) {
  const prior = (pastRuns || []).filter((r) => r && Number.isFinite(r.netWpm));
  const sameMode = prior.filter((r) => (r.mode || 'passage') === (run.mode || 'passage'));
  const allTime = prior.length > 0 && run.netWpm > Math.max(...prior.map((r) => r.netWpm));
  const mode = !allTime && sameMode.length > 0 && run.netWpm > Math.max(...sameMode.map((r) => r.netWpm));
  return { allTime, mode };
}

// Best net WPM in a run list (optionally per mode); null when empty.
export function bestNet(runs, mode = null) {
  const rs = (runs || []).filter((r) => r && Number.isFinite(r.netWpm) && (mode == null || (r.mode || 'passage') === mode));
  return rs.length ? Math.max(...rs.map((r) => r.netWpm)) : null;
}

// ── daily streak ────────────────────────────────────────────────────────────
const localDay = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Consecutive LOCAL days with at least one run, ending today (or yesterday — a streak isn't broken
// until a full day passes without typing). Also totals today's typed words and time.
export function typingStreak(runs, nowTs) {
  const days = new Set((runs || []).filter((r) => r?.ts).map((r) => localDay(r.ts)));
  const DAY = 86400000;
  const today = localDay(nowTs);
  let cursor = days.has(today) ? nowTs : days.has(localDay(nowTs - DAY)) ? nowTs - DAY : null;
  let streak = 0;
  while (cursor != null && days.has(localDay(cursor))) { streak += 1; cursor -= DAY; }
  const todays = (runs || []).filter((r) => r?.ts && localDay(r.ts) === today);
  return {
    days: streak,
    today: days.has(today),
    todayWords: todays.reduce((a, r) => a + (r.words || 0), 0),
    todayMs: todays.reduce((a, r) => a + (r.durationMs || 0), 0),
  };
}

// ── problem words (Amphetype-style mining of ONE run) ───────────────────────
// The run's mistyped words plus its unusually slow ones (per-word time > 1.7× the median),
// deduped case-insensitively, worst first: misses before slowness, then by time lost. These feed
// the one-click "drill the misses" review.
export function problemWords(passage, results, { max = 24, slowFactor = 1.7 } = {}) {
  const rows = [];
  const times = [];
  for (let i = 0; i < (results || []).length; i++) {
    const target = passage?.[i];
    const r = results[i];
    if (!target || target.length < 2 || !r) continue;
    if (Number.isFinite(r.ms) && r.ms > 0) times.push(r.ms);
    rows.push({ word: target, perfect: r.perfect !== false, ms: Number.isFinite(r.ms) ? r.ms : 0 });
  }
  if (!rows.length) return [];
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 0;
  const bad = rows.filter((r) => !r.perfect || (median > 0 && r.ms > median * slowFactor));
  bad.sort((a, b) => (a.perfect === b.perfect ? b.ms - a.ms : a.perfect ? 1 : -1));
  const seen = new Set();
  const out = [];
  for (const r of bad) {
    const k = r.word.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r.word);
    if (out.length >= max) break;
  }
  return out;
}

// Review passage: the problem words shuffled and repeated to drill length (deterministic per seed).
export function reviewPassage(words, { max = 60, seed = 0 } = {}) {
  const src = (words || []).filter(Boolean);
  if (!src.length) return [];
  let s = (seed + 1) * 1103515245 + 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  while (out.length < max) {
    const round = [...src];
    for (let i = round.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [round[i], round[j]] = [round[j], round[i]];
    }
    out.push(...round);
  }
  return out.slice(0, max);
}

// ── per-key / per-finger profile (QWERTY) ───────────────────────────────────
export const FINGERS = ['L pinky', 'L ring', 'L middle', 'L index', 'R index', 'R middle', 'R ring', 'R pinky'];
const FINGER_OF = {};
const assign = (chars, f) => { for (const c of chars) FINGER_OF[c] = f; };
assign('`1qaz', 'L pinky'); assign('2wsx', 'L ring'); assign('3edc', 'L middle');
assign('45rtfgvb', 'L index'); assign('67yuhjnm', 'R index'); assign('8ik,', 'R middle');
assign('9ol.', 'R ring'); assign("0-=p;'[]\\/", 'R pinky');
export function keyFinger(ch) {
  return FINGER_OF[String(ch || '').toLowerCase()] || null;
}

// Merge per-run key profiles ({ ch: { n, err } }) across runs.
export function aggregateKeys(runs) {
  const agg = {};
  for (const r of runs || []) {
    for (const [ch, v] of Object.entries(r?.keys || {})) {
      const a = (agg[ch] ||= { n: 0, err: 0 });
      a.n += v?.n || 0;
      a.err += v?.err || 0;
    }
  }
  return agg;
}

// Per-finger rollup of an aggregated key profile, worst error rate first. Keys with no finger
// (exotic chars) are skipped; fingers never typed are omitted.
export function fingerStats(keyAgg) {
  const by = {};
  for (const [ch, v] of Object.entries(keyAgg || {})) {
    const f = keyFinger(ch);
    if (!f || !v?.n) continue;
    const b = (by[f] ||= { finger: f, n: 0, err: 0 });
    b.n += v.n;
    b.err += v.err || 0;
  }
  return Object.values(by)
    .map((b) => ({ ...b, rate: b.n ? b.err / b.n : 0 }))
    .sort((a, b) => b.rate - a.rate);
}

// ── pace caret ──────────────────────────────────────────────────────────────
// Standard WPM ⇒ 5 chars per word; a word in the passage costs its length + 1 (the space).
export function buildCum(passage) {
  const cum = [];
  let c = 0;
  for (const w of passage || []) { c += (w?.length || 0) + 1; cum.push(c); }
  return cum;
}
export function paceChars(wpm, secs) {
  return Math.max(0, (wpm * 5 * secs) / 60);
}
// The word the pacer is on after `chars` characters — first word whose cumulative span isn't yet
// finished. Past the end it parks on the last word.
export function paceWordIndex(cum, chars) {
  if (!cum?.length) return 0;
  for (let i = 0; i < cum.length; i++) if (chars < cum[i]) return i;
  return cum.length - 1;
}

// Completion progress of a run, 0..1 — drives the typing progress bar. Timed runs measure the
// clock, word runs the committed count, and ENDLESS runs (no limit at all) measure how far
// through the loaded passage you've typed, so the bar still means something.
export function runProgress(mode, { secs = 0, limit = 0, words = 0, pos = 0, total = 0 } = {}) {
  const frac = mode === 'seconds' ? (limit > 0 ? secs / limit : 0)
    : mode === 'words' ? (limit > 0 ? words / limit : 0)
      : (total > 0 ? pos / total : 0);
  return Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
}

// SETBACK mode: a mistyped word erases committed progress. Given the results so far and the
// position just after the bad commit, work out where the run rewinds to and what the word/perfect
// tallies lose. Char stats are deliberately NOT rewound — you really did type those keys (same
// model as monkeytype-style backspace-into-the-previous-word).
export function penaltyRewind(results, pos, words) {
  const n = Math.max(0, Math.floor(words || 0));
  if (!n) return { pos, dropped: 0, perfectLost: 0, kept: results };
  const target = Math.max(0, pos - n);
  const lost = results.slice(target, pos);
  return {
    pos: target,
    dropped: lost.length,
    perfectLost: lost.filter((r) => r?.perfect).length,
    kept: results.slice(0, target),
  };
}
