// Reading-time math for a tracked book: how long it took, and — when the rest was finished as an
// audiobook — an estimated total based on 1× narration. Pure; see readingTime.demo.mjs.
import { parseDay } from './localDay.js';
import { t } from '../i18n.js';

export const AUDIOBOOK_WPM = 150; // typical audiobook narration at 1× speed

// Effective word count of a book (prefer words; fall back to ~275 words/page).
export function bookWordCount(b) {
  return Number(b?.words) || (Number(b?.pages) ? Math.round(Number(b.pages) * 275) : 0);
}

// Seconds to narrate the UNREAD remainder at 1×. eyeFrac = fraction already read by eye (0..1).
export function audiobookSecs(words, eyeFrac) {
  const frac = Math.max(0, Math.min(1, Number(eyeFrac) || 0));
  const remaining = Math.max(0, (Number(words) || 0) * (1 - frac));
  return Math.round((remaining / AUDIOBOOK_WPM) * 60);
}

// Estimated total time to complete = eye reading time + (audiobook remainder at 1×, if flagged).
export function estimateTotalSecs({ readSecs = 0, words = 0, audiobookFinish = false, eyeFrac = 0 } = {}) {
  return Math.max(0, Number(readSecs) || 0) + (audiobookFinish ? audiobookSecs(words, eyeFrac) : 0);
}

export function fmtDur(secs) {
  const s = Math.round(Number(secs) || 0);
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Whole days between two ISO dates (start → finish); null if either is missing/invalid.
export function daysBetween(startISO, finishISO) {
  const a = parseDay(startISO || ''), b = parseDay(finishISO || '');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

// One-line human summary for the book editor / detail.
export function readingTimeSummary(b, finishISO) {
  const words = bookWordCount(b);
  const eyeFrac = (Number(b?.audiobookEyePct) || 0) / 100;
  const readSecs = Number(b?.readSecs) || 0;
  const abSecs = b?.audiobookFinish ? audiobookSecs(words, eyeFrac) : 0;
  const total = readSecs + abSecs;
  const days = daysBetween(b?.startTime, finishISO);
  const parts = [];
  parts.push(b?.startTime ? t('Started {date}', { date: b.startTime }) : t('No start date set'));
  if (days != null) parts.push(t.n('{n} day to finish', '{n} days to finish', days));
  if (readSecs > 0) parts.push(t('{time} reading', { time: fmtDur(readSecs) }));
  if (b?.audiobookFinish) parts.push(t('+ ~{audio} audiobook (1×) = ~{total} total', { audio: fmtDur(abSecs), total: fmtDur(total) }));
  else if (readSecs > 0) parts.push(t('({total} total)', { total: fmtDur(total) }));
  return parts.join(' · ');
}
