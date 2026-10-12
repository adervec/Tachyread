// Split a finished typing run into halves / thirds / quarters, each with its own speed, accuracy
// and grade, plus a "differential" grade for how well the pace held from first part to last.
//
// Input is the run's trend: samples of RUNNING totals ({ t secs, chars, ok, correct }), where
// `ok` = letters of words that ended up right (what net WPM counts). A part's own numbers are the
// difference of the totals at its two ends, linearly interpolated between samples.
import { letterGrade } from './gradeChime.js';

// Shortest run each split is offered for (secs) — short runs would give noisy parts.
export const SPLIT_MIN_SECS = { 2: 60, 3: 180, 4: 240 };

function at(trend, t) {
  let prev = { t: 0, chars: 0, ok: 0, correct: 0 };
  for (const p of trend) {
    if (p.t >= t) {
      const f = p.t > prev.t ? (t - prev.t) / (p.t - prev.t) : 1;
      const lerp = (k) => (prev[k] || 0) + ((p[k] || 0) - (prev[k] || 0)) * f;
      return { chars: lerp('chars'), ok: lerp('ok'), correct: lerp('correct') };
    }
    prev = p;
  }
  return { chars: prev.chars || 0, ok: prev.ok || 0, correct: prev.correct || 0 };
}

// Pace held (or rose) within 5% is an A; each band below loses a grade.
export function holdGrade(pct) {
  if (pct >= -5) return 'A';
  if (pct >= -10) return 'B';
  if (pct >= -20) return 'C';
  if (pct >= -30) return 'D';
  return 'F';
}

export function splitRun(trend, parts) {
  const pts = (trend || []).filter((p) => p && p.chars != null);
  const T = pts.at(-1)?.t || 0;
  if (!T || parts < 2) return null;
  const out = [];
  for (let k = 0; k < parts; k++) {
    const a = at(pts, (T * k) / parts), b = at(pts, (T * (k + 1)) / parts);
    const mins = T / parts / 60;
    const chars = b.chars - a.chars;
    const net = Math.round((b.ok - a.ok) / 5 / mins);
    out.push({
      net,
      gross: Math.round(chars / 5 / mins),
      acc: chars > 0 ? Math.round(((b.correct - a.correct) / chars) * 1000) / 10 : 100,
      grade: letterGrade(net),
    });
  }
  const first = out[0].net, last = out.at(-1).net;
  const diffPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  return { parts: out, diffPct, diffGrade: holdGrade(diffPct) };
}

// Which splits a run of `secs` qualifies for.
export const splitsFor = (secs) => [2, 3, 4].filter((n) => secs >= SPLIT_MIN_SECS[n]);
