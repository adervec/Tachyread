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

function popcount(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

export function createReadingTracker({ wordCount, maskB64 = '', wpmB64 = '', lifetimeActiveMs = 0, daily = [] } = {}) {
  const mask = decodeMask(maskB64, wordCount); // 1 = read (cumulative, all sessions)
  const wpm = decodeWpm(wpmB64, wordCount); // per-word recorded reading pace
  const sessionMask = new Uint8Array(wordCount); // words touched this session (transient)
  let readCount = popcount(mask);
  let sessionNewWords = 0;
  let sessionActiveMs = 0;
  let lifetimeMs = lifetimeActiveMs;
  let lastTs = null;
  let hidden = false;
  let dirty = false;
  const events = []; // {ts, processed, activeMs}
  const dayMap = new Map(daily.map((d) => [d.date, { date: d.date, words: d.words || 0, ms: d.ms || 0 }]));

  function bumpDay(words, ms) {
    const d = today();
    const cur = dayMap.get(d) || { date: d, words: 0, ms: 0 };
    cur.words += words;
    cur.ms += ms;
    dayMap.set(d, cur);
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
      if (back <= REVISIT_WORDS) processed = back; // re-read: eyes pace only
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

  return {
    recordMove,
    setHidden,
    recentWpm,
    sampleTrend,
    sessionWpm: () => wpmFrom(sessionNewWords, sessionActiveMs),
    lifetimeWpm: () => wpmFrom(readCount, lifetimeMs),
    coverage: () => (wordCount ? readCount / wordCount : 0),
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
    dailyArray: () => [...dayMap.values()],
  };
}
