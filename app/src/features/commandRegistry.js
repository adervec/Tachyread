// Single source of truth for the reader commands that hands-free inputs (camera gestures, spoken
// words, claps) can trigger. Before this, each modality had its own divergent hardcoded switch in
// App.jsx / audioControl.js; now they all resolve a commandId against this list, and the user can
// remap any trigger (many triggers may point at one command).
//
// run(ctx) receives the small action bag App assembles from its own closures:
//   { playPause(), setPlaying(bool), nav(kind), page(dir), adjustWpm(delta), jumpToCurrent(),
//     jumpToFrontier(), jumpToGap(), toggleReadAloud(), toggleScroll(), toggleFocus(),
//     toggleFaces(), toggleStats(), switchTab(dir), sourcePage(dir) }.
// Missing ctx entries are safe no-ops, so a partial bag (e.g. tests) never throws.

import { wordMatches } from './speechRecognition.js';

export const COMMANDS = [
  { id: 'playPause', label: 'Play / pause', icon: '⏯', run: (c) => c.playPause?.() },
  { id: 'play', label: 'Play', icon: '▶', run: (c) => c.setPlaying?.(true) },
  { id: 'pause', label: 'Pause', icon: '❚❚', run: (c) => c.setPlaying?.(false) },
  { id: 'nextWord', label: 'Next word', icon: '→', run: (c) => c.nav?.('nextWord') },
  { id: 'prevWord', label: 'Previous word', icon: '←', run: (c) => c.nav?.('prevWord') },
  { id: 'nextLine', label: 'Next line', icon: '⤓', run: (c) => c.nav?.('nextLine') },
  { id: 'prevLine', label: 'Previous line', icon: '⤒', run: (c) => c.nav?.('prevLine') },
  { id: 'nextPara', label: 'Next paragraph', icon: '⏭', run: (c) => c.nav?.('nextPara') },
  { id: 'prevPara', label: 'Previous paragraph', icon: '⏮', run: (c) => c.nav?.('prevPara') },
  { id: 'restart', label: 'Restart (to top)', icon: '⟲', run: (c) => c.nav?.('restart') },
  { id: 'pageDown', label: 'Page down', icon: '⇟', run: (c) => c.page?.(1) },
  { id: 'pageUp', label: 'Page up', icon: '⇞', run: (c) => c.page?.(-1) },
  // Direct scroll by a "tick" (the App Settings tick size); great for hands-free scroll-reading.
  { id: 'scrollTickDown', label: 'Scroll down a tick', icon: '⤓', run: (c) => c.scrollTicks?.(1, 1) },
  { id: 'scrollTickUp', label: 'Scroll up a tick', icon: '⤒', run: (c) => c.scrollTicks?.(-1, 1) },
  { id: 'scrollTickDownBig', label: 'Scroll down 3 ticks', icon: '⏬', run: (c) => c.scrollTicks?.(1, 3) },
  { id: 'scrollTickUpBig', label: 'Scroll up 3 ticks', icon: '⏫', run: (c) => c.scrollTicks?.(-1, 3) },
  { id: 'jumpToCurrent', label: 'Jump to current word', icon: '⌖', run: (c) => c.jumpToCurrent?.() },
  { id: 'jumpFrontier', label: 'Jump to latest unread', icon: '⇥', run: (c) => c.jumpToFrontier?.() },
  { id: 'jumpGap', label: 'Jump to first unread gap', icon: '↷', run: (c) => c.jumpToGap?.() },
  { id: 'wpmUp', label: 'Speed up (+25 WPM)', icon: '➕', run: (c) => c.adjustWpm?.(25) },
  { id: 'wpmDown', label: 'Slow down (−25 WPM)', icon: '➖', run: (c) => c.adjustWpm?.(-25) },
  { id: 'wpmUp100', label: 'Speed up a lot (+100 WPM)', icon: '⏫', run: (c) => c.adjustWpm?.(100) },
  { id: 'wpmDown100', label: 'Slow down a lot (−100 WPM)', icon: '⏬', run: (c) => c.adjustWpm?.(-100) },
  { id: 'toggleReadAloud', label: 'Read-aloud (TTS) on/off', icon: '🗣', run: (c) => c.toggleReadAloud?.() },
  { id: 'toggleScroll', label: 'Scroll-to-read on/off', icon: '📜', run: (c) => c.toggleScroll?.() },
  { id: 'toggleFocus', label: 'Focus mode on/off', icon: '🎯', run: (c) => c.toggleFocus?.() },
  { id: 'toggleFaces', label: 'Reader faces on/off', icon: '🙂', run: (c) => c.toggleFaces?.() },
  { id: 'toggleStats', label: 'Reading stats on/off', icon: '📊', run: (c) => c.toggleStats?.() },
  { id: 'nextTab', label: 'Next tab', icon: '📑→', run: (c) => c.switchTab?.(1) },
  { id: 'prevTab', label: 'Previous tab', icon: '←📑', run: (c) => c.switchTab?.(-1) },
  { id: 'nextSourcePage', label: 'Next source page', icon: '▤▶', run: (c) => c.sourcePage?.(1) },
  { id: 'prevSourcePage', label: 'Previous source page', icon: '◀▤', run: (c) => c.sourcePage?.(-1) },
];

export const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));

// Parametric "set the reading speed to an exact value" command, encoded as `setWpm:<n>` so it fits
// the same string-id mapping model as every other command. Any trigger can point at a specific WPM.
const SET_WPM_RE = /^setWpm:(\d{2,4})$/;
export function parseSetWpm(id) {
  const m = typeof id === 'string' && id.match(SET_WPM_RE);
  return m ? Number(m[1]) : null;
}
export function setWpmCommandId(wpm) {
  return `setWpm:${Math.max(50, Math.min(2000, Math.round(Number(wpm) || 0)))}`;
}

// Fire a command by id. Returns true if the id was known (an empty/unknown id is a no-op — that's how
// "unassigned" triggers behave). ctx is the action bag above.
export function runCommand(id, ctx) {
  const wpm = parseSetWpm(id);
  if (wpm != null) { ctx.setWpmValue?.(wpm); return true; }
  const cmd = id && COMMAND_BY_ID[id];
  if (cmd) cmd.run(ctx);
  return !!cmd;
}

export function labelFor(id) {
  const wpm = parseSetWpm(id);
  if (wpm != null) return `Set speed to ${wpm} WPM`;
  return COMMAND_BY_ID[id]?.label || id || '(none)';
}

// "⏯ Play / pause" — the feed / legend action string for a command id.
export function actionLabel(id) {
  const wpm = parseSetWpm(id);
  if (wpm != null) return `🎯 Set ${wpm} WPM`;
  const c = COMMAND_BY_ID[id];
  return c ? `${c.icon} ${c.label}` : '';
}

// First voice row whose phrase matches the (final) transcript, else null. Reuses the fuzzy
// comparator so "let's play" still triggers "play". Rows are [{ phrase, commandId, on? }].
// Disabled rows (on === false) still MATCH here — they feed trigger sequences — but matchVoice
// (the direct-command path) skips them, so a disabled mapping is preserved without firing.
export function matchVoiceRow(transcript, rows) {
  for (const row of rows || []) {
    if (row?.phrase && wordMatches(row.phrase, transcript)) return row;
  }
  return null;
}
export function matchVoice(transcript, rows) {
  const row = matchVoiceRow(transcript, (rows || []).filter((r) => r?.on !== false && r?.commandId));
  return row ? row.commandId : null;
}

// Default trigger→command maps — these reproduce the app's original hardcoded behavior exactly, so a
// fresh install (or any trigger the user hasn't touched) works as before.
export const DEFAULT_GESTURE_MAP = {
  thumbUp: 'wpmUp', thumbDown: 'wpmDown', fist: 'pause', victory: 'nextPara', wave: 'playPause',
  pointUp: 'pageUp', iLoveYou: 'jumpToCurrent', pinch: 'playPause', swipeLeft: 'prevPara', swipeRight: 'nextPara',
};
export const DEFAULT_VOICE_COMMANDS = [
  { phrase: 'play', commandId: 'play' },
  { phrase: 'pause', commandId: 'pause' },
  { phrase: 'stop', commandId: 'pause' },
  { phrase: 'next', commandId: 'nextWord' },
  { phrase: 'forward', commandId: 'nextWord' },
  { phrase: 'back', commandId: 'prevWord' },
  { phrase: 'faster', commandId: 'wpmUp' },
  { phrase: 'slower', commandId: 'wpmDown' },
];
export const DEFAULT_CLAP_MAP = { 1: 'playPause', 2: 'nextWord', 3: 'prevWord' };
