// Dictation throughput — measure spoken (or otherwise dictated) output as net words-per-minute, so
// voice sits on the same footing as the typing / Flow Writer output track. The transcript is the
// source of truth; net WPM = words / active minutes. Pure: no Web Speech, no clock — callers pass the
// accumulated text and elapsed active milliseconds in.

// A "word" is a whitespace-delimited token containing at least one letter or digit (so stray
// punctuation tokens from a recognizer don't inflate the count).
export function countWords(text) {
  const m = (text || '').trim().match(/\S+/gu);
  if (!m) return 0;
  let n = 0;
  for (const t of m) if (/[\p{L}\p{N}]/u.test(t)) n++;
  return n;
}

export function netWpm(words, elapsedMs) {
  const w = Number(words) || 0;
  const ms = Number(elapsedMs) || 0;
  if (w <= 0 || ms <= 0) return 0;
  return Math.round((w / ms) * 60000);
}

export function throughput(text, elapsedMs) {
  const words = countWords(text);
  return { words, wpm: netWpm(words, elapsedMs) };
}

// mm:ss for a duration in ms.
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
