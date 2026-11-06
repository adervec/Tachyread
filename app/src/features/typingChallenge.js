// Typing challenge links and run export.
//
// A challenge link carries a DRILL (never book text) by its mode + run length + seed, plus the
// sender's net WPM, in the URL fragment: #challenge=<base64url JSON>. The receiver types the exact
// same drill with the sender's speed as the pace ghost. No server; the fragment never leaves the
// browser. The link is untrusted input, so decode validates every field.
import { TYPING_MODE_BY_ID } from '../engine/typingModes.js';

const RUN_MODES = ['seconds', 'words'];
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function encodeChallenge({ mode, runMode, limit, seed, wpm }) {
  return b64url(JSON.stringify({ m: mode, r: runMode, l: limit, s: seed, w: Math.round(wpm || 0) }));
}

// → { mode, runMode, limit, seed, wpm } or null when anything is off.
export function decodeChallenge(code) {
  if (typeof code !== 'string' || code.length > 400) return null;
  let o;
  try { o = JSON.parse(unb64url(code)); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const m = TYPING_MODE_BY_ID[o.m];
  if (!m || m.kind !== 'drill' || o.m === 'review') return null; // review needs the sender's own misses
  if (!RUN_MODES.includes(o.r)) return null;
  const limit = Math.round(Number(o.l));
  const seed = Math.round(Number(o.s));
  const wpm = Math.round(Number(o.w) || 0);
  if (!(limit >= 5 && limit <= 600) || !Number.isFinite(seed) || Math.abs(seed) > 1e9 || wpm < 0 || wpm > 400) return null;
  return { mode: o.m, runMode: o.r, limit, seed, wpm };
}

export const challengeFromHash = (hash) => {
  const m = /(?:^#|&)challenge=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m ? decodeChallenge(m[1]) : null;
};

// Every run as CSV (one row per run) — for your own spreadsheets, or as a plain backup.
const CSV_COLS = [
  ['date', (r) => new Date(r.ts).toISOString()],
  ['mode', (r) => r.mode || ''],
  ['text', (r) => r.docName || ''],
  ['net_wpm', (r) => r.netWpm],
  ['gross_wpm', (r) => r.grossWpm],
  ['accuracy', (r) => r.accuracy],
  ['consistency', (r) => r.consistency ?? ''],
  ['words', (r) => r.words],
  ['perfect', (r) => r.perfect ?? ''],
  ['corrected', (r) => r.corrected ?? ''],
  ['errors', (r) => r.errors],
  ['chars', (r) => r.chars],
  ['seconds', (r) => (r.durationMs ? Math.round(r.durationMs / 100) / 10 : '')],
  ['grade', (r) => r.grade || ''],
  ['device', (r) => r.device || ''],
  ['keyboard', (r) => r.keyboardLabel || r.keyboard || ''],
];
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function runsCsv(runs) {
  return [CSV_COLS.map(([h]) => h).join(','), ...runs.map((r) => CSV_COLS.map(([, f]) => cell(f(r))).join(','))].join('\r\n');
}
