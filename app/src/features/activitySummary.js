// One line for the splash screen: how much reading happened lately and which way it's heading.
// Terse and factual by design — numbers and a direction, no cheering and no guilt. Aggregates the
// same per-file dailyHistory the Statistics dialog uses ({ date: 'YYYY-MM-DD' local, wordsRead }).
import { localDay } from './localDay.js';
import { t, fmtNum } from '../i18n.js';

// Words per LOCAL day over the trailing `days`, index 0 = today. Missing days are zero.
export function dailyWords(files, days = 14, now = Date.now()) {
  const keys = [];
  for (let i = 0; i < days; i++) keys.push(localDay(now - i * 86400000)); // a day KEY, compared with stored days
  const byDay = new Map(keys.map((k) => [k, 0]));
  for (const f of files || []) {
    for (const e of f?.dailyHistory || []) {
      if (byDay.has(e.date)) byDay.set(e.date, byDay.get(e.date) + (e.wordsRead || 0));
    }
  }
  return keys.map((k) => byDay.get(k));
}

const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${fmtNum(n / 1000, 1, 1)}k` : String(n));

// The line itself, or null when there's nothing to say (a fresh install shouldn't open with a zero).
export function activitySummary(files, now = Date.now()) {
  const daily = dailyWords(files, 14, now);
  const week = daily.slice(0, 7);
  const prev = daily.slice(7, 14);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const wWords = sum(week), pWords = sum(prev);
  if (wWords === 0 && pWords === 0) return null; // quiet fortnight — say nothing rather than "0 words"

  const days = week.filter((v) => v > 0).length;
  let head;
  if (wWords === 0) head = t('No reading in the past 7 days');
  else head = t.n('Past 7 days: {words} words over {n} day', 'Past 7 days: {words} words over {n} days', days, { words: compact(wWords) });

  // Trajectory vs the 7 days before — a percentage, not a verdict. ±15% reads as noise, not news.
  let tail;
  if (pWords === 0) tail = wWords > 0 ? t('none the week before') : '';
  else {
    const delta = Math.round(((wWords - pWords) / pWords) * 100);
    tail = Math.abs(delta) <= 15 ? t('about level with the week before')
      : delta > 0 ? t('up {pct}% on the week before', { pct: delta })
        : t('down {pct}% on the week before', { pct: Math.abs(delta) });
  }
  return tail ? `${head} · ${tail}.` : `${head}.`;
}
