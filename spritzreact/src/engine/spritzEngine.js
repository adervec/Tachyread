// SPRITZ playback engine: per-word timing with multipliers, paragraph/line pauses.
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
