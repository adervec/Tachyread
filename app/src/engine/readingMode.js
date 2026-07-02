// Live "how is the user reading right now" classifier. Every position change notes its input
// source (auto tick, word/line/para step, page, scroll advance, jump); the current mode is the
// majority source over a trailing window (ties → the newest), so one stray arrow-key press amid
// scrolling doesn't flap the label. States that aren't advancement events — peeking, read-aloud,
// auto-play — override live, since they describe the present, not the recent past.

const WINDOW_MS = 10000;
const CAP = 60;

export const MODES = {
  peek: { icon: '👁', label: 'peeking', hint: 'Previewing elsewhere — the progress tick is not moving' },
  listen: { icon: '🔊', label: 'listening', hint: 'Read-aloud (TTS) is driving the pace' },
  auto: { icon: '▶', label: 'auto', hint: 'Auto-advance (word/line player) is driving the pace' },
  speak: { icon: '🎤', label: 'speaking', hint: 'Advancing by reading aloud (speech recognition follows you)' },
  word: { icon: '·', label: 'word-by-word', hint: 'Stepping one word at a time' },
  line: { icon: '↵', label: 'line-by-line', hint: 'Advancing a line at a time' },
  para: { icon: '¶', label: 'by paragraph', hint: 'Hopping paragraph to paragraph' },
  page: { icon: '⇟', label: 'by page', hint: 'Paging through the text' },
  scroll: { icon: '⇅', label: 'scroll-reading', hint: 'Scrolling the pane; text passing the top edge counts as read' },
  jump: { icon: '⤳', label: 'navigating', hint: 'Jumping around (ToC / Find / clicks) — not counted as reading' },
  idle: { icon: '…', label: 'idle', hint: 'No reading activity in the last few seconds' },
};

export function createModeDetector() {
  const events = []; // {kind, ts}

  function note(kind, now = Date.now()) {
    events.push({ kind: MODES[kind] ? kind : 'jump', ts: now });
    if (events.length > CAP) events.shift();
  }

  function current({ playing = false, listening = false, peeking = false, now = Date.now() } = {}) {
    if (peeking) return 'peek';
    if (listening) return 'listen';
    if (playing) return 'auto';
    // Not playing → stale 'auto' ticks describe the player that just stopped, not the user.
    const cutoff = now - WINDOW_MS;
    const win = events.filter((e) => e.ts >= cutoff && e.kind !== 'auto');
    if (!win.length) return 'idle';
    const counts = new Map();
    for (const e of win) counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
    let best = win[win.length - 1].kind;
    let bestN = counts.get(best);
    for (let i = win.length - 1; i >= 0; i--) {
      const n = counts.get(win[i].kind);
      if (n > bestN) { best = win[i].kind; bestN = n; }
    }
    return best;
  }

  return { note, current };
}
