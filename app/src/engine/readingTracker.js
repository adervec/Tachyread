// Reading-efficiency tracker.
//
// The old model equated "WPM" with the slider setpoint and counted every forward step as a
// word read. That misrepresents real reading. This tracker measures how efficiently a
// document is actually read by classifying every change of reading position and accounting
// active time honestly:
//
//   • Idle / background: time only accrues between position changes, capped per gap, and not
//     at all while the tab is hidden — so leaving the reader open does not inflate anything.
//   • Reading (auto-play or manual line-by-line): contiguous forward motion at a human pace
//     marks words read and counts toward speed.
//   • Skips (major forward jumps, TOC/Find/Go-to, or holding a key to blow past text faster
//     than a person could read): the spanned words are NOT marked read and add no speed.
//   • Re-reading (small backward then forward over the same words): adds active time but no
//     new coverage, so the session's net rate drops the way real re-reading lowers efficiency.
//   • Revisiting a far section then returning: the forward frontier is preserved, so resuming
//     is not mistaken for a skip of unread material.
//
// Two headline numbers fall out: a live "recent WPM" (eyes pace over a sliding window) and a
// "session/lifetime WPM" (unique new words read per active minute = reading efficiency). A
// per-word WPM trace + read mask back the coverage stat and the mountain-graph trendline.

const IDLE_CAP_MS = 12000; // max active time credited to a single gap between moves
const SKIP_WORDS = 50; // forward jump larger than this (when not contiguous) is a skip
const REVISIT_WORDS = 50; // backward jump larger than this is a far revisit, not a re-read
const WINDOW_MS = 30000; // sliding window for the live "recent WPM"
const MIN_MS_PER_WORD = 25; // faster than this (~2400 wpm) over a multi-word move = skim/skip
const MAX_RECENT_WPM = 2500; // clamp the live readout for sanity
// Regression awareness: a backward saccade of ≤ this many words is a "short" regression — the kind
// that is frequently a habitual twitch rather than a deliberate comprehension repair, and the main
// target of regression-reduction training. Longer backward jumps usually mean genuine re-analysis.
const SHORT_REGRESSION = 2;
const REG_CAP = 400; // max recent regression events retained (session-only)

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}

// ── bit-packed read-mask (de)serialization ──────────────────────────────────
function encodeMask(mask) {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  return toBase64(bytes);
}
function decodeMask(b64, wordCount) {
  const mask = new Uint8Array(wordCount);
  if (!b64) return mask;
  try {
    const bin = atob(b64);
    for (let i = 0; i < wordCount; i++) if ((bin.charCodeAt(i >> 3) || 0) & (1 << (i & 7))) mask[i] = 1;
  } catch {
    /* corrupt → fresh */
  }
  return mask;
}

// ── per-word WPM trace (Uint16, little-endian) ──────────────────────────────
function encodeWpm(arr) {
  const bytes = new Uint8Array(arr.length * 2);
  for (let i = 0; i < arr.length; i++) {
    bytes[i * 2] = arr[i] & 0xff;
    bytes[i * 2 + 1] = (arr[i] >> 8) & 0xff;
  }
  return toBase64(bytes);
}
function decodeWpm(b64, wordCount) {
  const arr = new Uint16Array(wordCount);
  if (!b64) return arr;
  try {
    const bin = atob(b64);
    for (let i = 0; i < wordCount; i++) arr[i] = (bin.charCodeAt(i * 2) || 0) | ((bin.charCodeAt(i * 2 + 1) || 0) << 8);
  } catch {
    /* corrupt → fresh */
  }
  return arr;
}

// ── per-paragraph first-read timestamp trace (Uint32 seconds since epoch, little-endian) ──
// Tracking the reading timeline per PARAGRAPH rather than per word keeps it ~50-100× smaller (a few
// KB/book vs hundreds): one timestamp per paragraph instead of per word.
function encodeU32(arr) {
  const bytes = new Uint8Array(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] >>> 0;
    bytes[i * 4] = v & 0xff; bytes[i * 4 + 1] = (v >>> 8) & 0xff;
    bytes[i * 4 + 2] = (v >>> 16) & 0xff; bytes[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return toBase64(bytes);
}
function decodeU32(b64, n) {
  const arr = new Uint32Array(n);
  if (!b64) return arr;
  try {
    const bin = atob(b64);
    for (let i = 0; i < n; i++) {
      arr[i] = (((bin.charCodeAt(i * 4) || 0)) | ((bin.charCodeAt(i * 4 + 1) || 0) << 8)
        | ((bin.charCodeAt(i * 4 + 2) || 0) << 16) | ((bin.charCodeAt(i * 4 + 3) || 0) << 24)) >>> 0;
    }
  } catch {
    /* corrupt → fresh */
  }
  return arr;
}

function popcount(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

export function createReadingTracker({ wordCount, maskB64 = '', wpmB64 = '', lifetimeActiveMs = 0, daily = [], paragraphStarts = [], paraTsB64 = '' } = {}) {
  const mask = decodeMask(maskB64, wordCount); // 1 = read (cumulative, all sessions)
  const wpm = decodeWpm(wpmB64, wordCount); // per-word recorded reading pace
  // Paragraph-resolution reading timeline: first-read clock time per paragraph (0 = unread).
  const paraStart = paragraphStarts && paragraphStarts.length ? paragraphStarts : [0];
  const paraCount = paraStart.length;
  const paraTs = decodeU32(paraTsB64, paraCount);
  const sessionMask = new Uint8Array(wordCount); // words touched this session (transient)
  let readCount = popcount(mask);
  let sessionNewWords = 0;
  let sessionActiveMs = 0;
  let lifetimeMs = lifetimeActiveMs;
  let lastTs = null;
  let hidden = false;
  let dirty = false;
  let regressionCount = 0; // session-only: backward saccades over already-read text
  let shortRegressions = 0; // of those, jumps of ≤ SHORT_REGRESSION words
  let longRegressions = 0;
  const regress = []; // capped recent regressions: {at, back, ms, ts}
  const events = []; // {ts, processed, activeMs}
  const dayMap = new Map(daily.map((d) => [d.date, { date: d.date, words: d.words || 0, ms: d.ms || 0 }]));

  function bumpDay(words, ms) {
    const d = today();
    const cur = dayMap.get(d) || { date: d, words: 0, ms: 0 };
    cur.words += words;
    cur.ms += ms;
    dayMap.set(d, cur);
  }

  function paraLowerBound(x) { // first paragraph index whose start >= x
    let lo = 0, hi = paraCount;
    while (lo < hi) { const m = (lo + hi) >> 1; if (paraStart[m] < x) lo = m + 1; else hi = m; }
    return lo;
  }
  // Stamp the first-read time onto every paragraph overlapping the forward span [from,to). Only sets
  // unstamped paragraphs, so re-reading never rewrites when a paragraph was first reached.
  function stampParas(from, to, nowMs) {
    if (to <= from) return;
    const ts = Math.floor(nowMs / 1000);
    let i = Math.max(0, paraLowerBound(from + 1) - 1); // paragraph containing `from`
    for (; i < paraCount && paraStart[i] < to; i++) if (!paraTs[i]) { paraTs[i] = ts; dirty = true; }
  }

  // Mark [from,to) as read at the given pace; record per-word wpm + session flag.
  function markReading(from, to, pace) {
    let added = 0;
    for (let i = Math.max(0, from); i < Math.min(wordCount, to); i++) {
      if (!mask[i]) {
        mask[i] = 1;
        added++;
      }
      if (pace > 0) wpm[i] = Math.min(65535, pace);
      sessionMask[i] = 1;
    }
    return added;
  }

  function trim(now) {
    const cutoff = now - WINDOW_MS;
    while (events.length && events[0].ts < cutoff) events.shift();
  }

  function recordMove(prev, next, now = Date.now()) {
    if (next === prev || prev == null || next == null) {
      lastTs = now;
      return;
    }
    let activeMs = 0;
    if (lastTs != null && !hidden) activeMs = Math.min(Math.max(0, now - lastTs), IDLE_CAP_MS);
    lastTs = now;
    if (hidden) return;

    const d = next - prev;
    let processed = 0;
    let newWords = 0;

    if (d > 0) {
      const msPerWord = activeMs > 0 ? activeMs / d : Infinity;
      const isSkim = d <= SKIP_WORDS && activeMs > 0 && msPerWord < MIN_MS_PER_WORD;
      if (d <= SKIP_WORDS && !isSkim) {
        const pace = activeMs > 0 ? Math.round((60000 * d) / activeMs) : 0;
        newWords = markReading(prev, next, pace);
        processed = d;
      }
    } else {
      const back = -d;
      if (back <= REVISIT_WORDS) {
        processed = back; // re-read: eyes pace only
        // Regression bookkeeping (a near backward move over text just read). Classify by distance.
        regressionCount++;
        if (back <= SHORT_REGRESSION) shortRegressions++;
        else longRegressions++;
        regress.push({ at: next, back, ms: activeMs, ts: now });
        if (regress.length > REG_CAP) regress.shift();
      }
    }

    sessionActiveMs += activeMs;
    lifetimeMs += activeMs;
    sessionNewWords += newWords;
    readCount += newWords;
    if (activeMs > 0 || newWords > 0) bumpDay(newWords, activeMs);
    if (activeMs > 0 || processed > 0) events.push({ ts: now, processed, activeMs });
    trim(now);
    dirty = true;
  }

  // Mark a contiguous prefix [0, n) as read without crediting any time/pace. Used by book-group
  // catch-up: when a grouped edition resumes at another edition's further position, the coverage
  // mask is advanced to match the new cursor so "% read" stays consistent with "% position".
  function markPrefixRead(n) {
    const to = Math.min(wordCount, Math.max(0, n | 0));
    for (let i = 0; i < to; i++) if (!mask[i]) { mask[i] = 1; readCount++; }
    if (to > 0) dirty = true;
  }

  // Mark an arbitrary forward span [from,to) read for COVERAGE only — no active time, no pace, no
  // WPM/efficiency credit. Used when the user deliberately navigates forward (end of line/paragraph,
  // page down, a short forward jump) and counts that text as read. recordMove still runs alongside to
  // account dwell time honestly; this only ensures the spanned words show as read in "% read".
  function markRangeRead(from, to) {
    const a = Math.max(0, from | 0);
    const b = Math.min(wordCount, to | 0);
    for (let i = a; i < b; i++) if (!mask[i]) { mask[i] = 1; readCount++; sessionMask[i] = 1; }
    if (b > a) { stampParas(a, b, Date.now()); dirty = true; }
  }

  function setHidden(h, now = Date.now()) {
    if (h === hidden) return;
    hidden = h;
    if (!h) lastTs = now;
  }

  function recentWpm(now = Date.now()) {
    trim(now);
    let p = 0;
    let ms = 0;
    for (const e of events) {
      p += e.processed;
      ms += e.activeMs;
    }
    if (ms < 400) return 0;
    return Math.min(MAX_RECENT_WPM, Math.round((p / ms) * 60000));
  }

  const wpmFrom = (words, ms) => (ms > 1000 ? Math.round((words / ms) * 60000) : 0);

  // Downsample the per-word trace into `cols` buckets for the mountain-graph trendline.
  // Each bucket: { wpm: avg read pace, readFrac, sessionFrac }.
  function sampleTrend(cols) {
    const out = new Array(cols);
    if (wordCount === 0) {
      for (let c = 0; c < cols; c++) out[c] = { wpm: 0, readFrac: 0, sessionFrac: 0 };
      return out;
    }
    for (let c = 0; c < cols; c++) {
      const a = Math.floor((c * wordCount) / cols);
      const b = Math.max(a + 1, Math.floor(((c + 1) * wordCount) / cols));
      let sum = 0;
      let read = 0;
      let sess = 0;
      let n = 0;
      for (let i = a; i < b && i < wordCount; i++) {
        n++;
        if (mask[i]) {
          read++;
          sum += wpm[i];
        }
        if (sessionMask[i]) sess++;
      }
      out[c] = {
        wpm: read ? sum / read : 0,
        readFrac: n ? read / n : 0,
        sessionFrac: n ? sess / n : 0,
      };
    }
    return out;
  }

  // Per-section stats for the TOC: fraction of [from,to) actually read + the average recorded
  // reading pace over the words that were read.
  function rangeStats(from, to) {
    const a = Math.max(0, Math.min(wordCount, from | 0));
    const b = Math.max(a, Math.min(wordCount, to | 0));
    let read = 0;
    let sum = 0;
    let paced = 0;
    for (let i = a; i < b; i++) {
      if (mask[i]) {
        read++;
        if (wpm[i]) { sum += wpm[i]; paced++; }
      }
    }
    const n = b - a;
    return { total: n, readWords: read, readFrac: n ? read / n : 0, wpm: paced ? Math.round(sum / paced) : 0 };
  }

  // Session regression summary. `ratePer100` is regressions per 100 words of forward progress this
  // session; `recent` is the newest-first list (each {at, back, ms, ts}) for a jump-to-spot report.
  function regressionStats() {
    return {
      count: regressionCount,
      short: shortRegressions,
      long: longRegressions,
      ratePer100: sessionNewWords > 0 ? (regressionCount / sessionNewWords) * 100 : 0,
      recent: regress.slice(-60).reverse(),
    };
  }
  function resetRegressions() {
    regressionCount = 0;
    shortRegressions = 0;
    longRegressions = 0;
    regress.length = 0;
  }

  // Regressions whose timestamp falls in the trailing window — a "burst" signal for attention.
  function recentRegressionCount(windowMs = 20000, now = Date.now()) {
    const cutoff = now - windowMs;
    let n = 0;
    for (let i = regress.length - 1; i >= 0; i--) {
      if (regress[i].ts < cutoff) break;
      n++;
    }
    return n;
  }

  // Coefficient of variation (std/mean) of recent per-move active dwell — a pace-instability signal.
  function recentPaceCv() {
    const xs = [];
    for (const e of events) if (e.activeMs > 0) xs.push(e.activeMs);
    if (xs.length < 3) return 0;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (mean <= 0) return 0;
    const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
    return Math.sqrt(variance) / mean;
  }

  return {
    recordMove,
    setHidden,
    markPrefixRead,
    markRangeRead,
    recentWpm,
    sampleTrend,
    rangeStats,
    regressionStats,
    resetRegressions,
    recentRegressionCount,
    recentPaceCv,
    sessionWpm: () => wpmFrom(sessionNewWords, sessionActiveMs),
    lifetimeWpm: () => wpmFrom(readCount, lifetimeMs),
    coverage: () => (wordCount ? readCount / wordCount : 0),
    // Completion fraction with some word ranges excluded from BOTH numerator and denominator —
    // front/back matter flagged "skip" doesn't count toward % read (but reading it still credits
    // WPM, which this doesn't touch). Iterates only the (small) skipped ranges, not the whole doc.
    coverageExcluding: (ranges) => {
      if (!ranges || !ranges.length) return wordCount ? readCount / wordCount : 0;
      let skipRead = 0;
      let skipTotal = 0;
      for (const r of ranges) {
        const a = Math.max(0, Math.min(wordCount, r.start | 0));
        const b = Math.max(a, Math.min(wordCount, r.end | 0));
        for (let i = a; i < b; i++) { skipTotal++; if (mask[i]) skipRead++; }
      }
      const effTotal = wordCount - skipTotal;
      const effRead = readCount - skipRead;
      return effTotal > 0 ? Math.max(0, Math.min(1, effRead / effTotal)) : 1;
    },
    isRead: (i) => !!mask[i],
    get sessionNewWords() {
      return sessionNewWords;
    },
    get sessionActiveMs() {
      return sessionActiveMs;
    },
    get lifetimeActiveMs() {
      return lifetimeMs;
    },
    get readCount() {
      return readCount;
    },
    get wordCount() {
      return wordCount;
    },
    get dirty() {
      return dirty;
    },
    markSaved() {
      dirty = false;
    },
    serializeMask: () => encodeMask(mask),
    serializeWpm: () => encodeWpm(wpm),
    serializeParaTs: () => encodeU32(paraTs),
    // Paragraph-resolution reading timeline: [{ para, startWord, ts(ms) }] for paragraphs read,
    // oldest first by paragraph order. Backs the "when & where" session view.
    paraTimeline: () => {
      const out = [];
      for (let p = 0; p < paraCount; p++) if (paraTs[p]) out.push({ para: p, startWord: paraStart[p], ts: paraTs[p] * 1000 });
      return out;
    },
    get paraCount() { return paraCount; },
    dailyArray: () => [...dayMap.values()],
  };
}
