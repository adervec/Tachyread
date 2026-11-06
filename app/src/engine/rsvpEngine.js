// RSVP playback engine: per-word timing with multipliers, paragraph/line pauses.
// Returns a controller that callers drive via subscribe / start / stop / step.

import { isDigitWord, isLongWord, hasSpecialChars } from '../document/readerDocument.js';

const SYLLABLE_RE = /[aeiouyAEIOUY]+/g;
function syllableCount(w) {
  const m = w.match(SYLLABLE_RE);
  return Math.max(1, m ? m.length : 1);
}
function letterCount(w) {
  let n = 0;
  for (const c of w) if (/\p{L}/u.test(c)) n++;
  return n || 1;
}

// Returns milliseconds for a given word at given WPM with multipliers applied.
export function wordDurationMs(word, settings, isProperName, isHeaderFooter, atParaEnd, atLineEnd) {
  if (!word) return 100;
  let base = 60000 / Math.max(60, settings.wpm || 250);
  // Speed unit scaling
  if (settings.speedUnit === 'Letters') base *= letterCount(word);
  else if (settings.speedUnit === 'Syllables') base *= syllableCount(word);
  // Multipliers
  let mult = 1;
  if (isProperName) mult = Math.max(mult, settings.doubleTimeProperNamesMultiplier || 1);
  if (isLongWord(word, settings.longWordThreshold || 9))
    mult = Math.max(mult, settings.doubleTimeLongWordsMultiplier || 1);
  if (isDigitWord(word)) mult = Math.max(mult, settings.doubleTimeDigitWordsMultiplier || 1);
  if (hasSpecialChars(word)) mult = Math.max(mult, settings.doubleTimeSpecialWordsMultiplier || 1);
  base *= mult;
  // Punctuation comma adds a small pause
  if (/[,;:]$/.test(word)) base *= 1.4;
  // Sentence end → paragraph break inclusion handled by caller (atParaEnd)
  if (atParaEnd) base += (settings.paragraphBreakSecs || 0) * 1000;
  else if (atLineEnd) base += settings.lineBreakPauseMs || 0;
  if (isHeaderFooter && settings.autoSkipHeaders) base = 0;
  return Math.max(20, Math.round(base));
}

// Phrase chunking: how many words the Fast Reader flashes together from idx — up to `size`, but a
// phrase never runs past punctuation or onto the next line (lineOf(i) → line index).
export function chunkLen(words, idx, size, lineOf) {
  let n = 1;
  while (n < size && idx + n < words.length
    && !/[.,;:!?…—)\]"”’]$/.test(words[idx + n - 1] || '') && lineOf(idx + n) === lineOf(idx)) n++;
  return n;
}

// Start ramp: the first `over` words after Play run from `from`×WPM up to full speed.
export function rampFactor(sinceStart, over = 20, from = 0.7) {
  if (!(sinceStart >= 0) || sinceStart >= over) return 1;
  return from + (1 - from) * (sinceStart / over);
}

// A word longer than maxLen splits in two for the Fast Reader: at its own hyphen if it has one,
// else near the middle, preferring a vowel→consonant boundary ("extraordi-" / "nary").
// ponytail: heuristic, not a dictionary hyphenator — Hypher/TeX patterns if splits read badly.
export function hyphenSplit(word, maxLen) {
  if (!maxLen || !word || word.length <= maxLen) return null;
  const h = word.indexOf('-', 2);
  if (h > 0 && h < word.length - 2) return [word.slice(0, h + 1), word.slice(h + 1)];
  const mid = Math.floor(word.length / 2);
  const V = (c) => /[aeiouy]/i.test(c || ''), C = (c) => /[b-df-hj-np-tv-z]/i.test(c || '');
  // Syllable-ish breaks nearest the middle: VC|CV ("extraor|dinarily") first, then V|CV ("muni|cation").
  for (const ok of [(i) => V(word[i - 2]) && C(word[i - 1]) && C(word[i]) && V(word[i + 1]), (i) => V(word[i - 1]) && C(word[i]) && V(word[i + 1])]) {
    for (let d = 0; d <= 4; d++) {
      for (const i of [mid - d, mid + d]) if (i >= 3 && i <= word.length - 3 && ok(i)) return [`${word.slice(0, i)}-`, word.slice(i)];
    }
  }
  return [`${word.slice(0, mid)}-`, word.slice(mid)];
}

export function createEngine() {
  let timerId = null;
  let listeners = new Set();
  let playing = false;

  function emit(event, payload) {
    for (const fn of listeners) {
      try { fn(event, payload); } catch (e) { console.error(e); }
    }
  }

  function clear() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    isPlaying() { return playing; },
    start() {
      if (playing) return;
      playing = true;
      emit('play');
    },
    pause() {
      if (!playing) return;
      playing = false;
      clear();
      emit('pause');
    },
    toggle() { playing ? this.pause() : this.start(); },
    scheduleNext(ms, onFire) {
      clear();
      timerId = setTimeout(() => {
        timerId = null;
        if (playing) onFire();
      }, ms);
    },
    cancel() { clear(); },
  };
}
