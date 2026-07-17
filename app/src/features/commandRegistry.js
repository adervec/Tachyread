// Single source of truth for the reader commands that hands-free inputs (camera gestures, spoken
// words, claps) can trigger. Before this, each modality had its own divergent hardcoded switch in
// App.jsx / audioControl.js; now they all resolve a commandId against this list, and the user can
// remap any trigger (many triggers may point at one command).
//
// run(ctx) receives the small action bag App assembles from its own closures:
//   { playPause(), setPlaying(bool), nav(kind), adjustWpm(delta) }.

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
  { id: 'jumpToCurrent', label: 'Jump to current word', icon: '⌖', run: (c) => c.jumpToCurrent?.() },
  { id: 'wpmUp', label: 'Speed up (+25 WPM)', icon: '➕', run: (c) => c.adjustWpm?.(25) },
  { id: 'wpmDown', label: 'Slow down (−25 WPM)', icon: '➖', run: (c) => c.adjustWpm?.(-25) },
];

export const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));

// Fire a command by id. Returns true if the id was known (an empty/unknown id is a no-op — that's how
// "unassigned" triggers behave). ctx is the action bag above.
export function runCommand(id, ctx) {
  const cmd = id && COMMAND_BY_ID[id];
  if (cmd) cmd.run(ctx);
  return !!cmd;
}

export function labelFor(id) {
  return COMMAND_BY_ID[id]?.label || id || '(none)';
}

// "⏯ Play / pause" — the feed / legend action string for a command id.
export function actionLabel(id) {
  const c = COMMAND_BY_ID[id];
  return c ? `${c.icon} ${c.label}` : '';
}

// First voice row whose phrase matches the (final) transcript → its commandId, else null. Reuses the
// fuzzy comparator so "let's play" still triggers "play". Rows are [{ phrase, commandId }].
export function matchVoice(transcript, rows) {
  for (const row of rows || []) {
    if (row?.phrase && row.commandId && wordMatches(row.phrase, transcript)) return row.commandId;
  }
  return null;
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
];
export const DEFAULT_CLAP_MAP = { 1: 'playPause', 2: 'nextWord', 3: 'prevWord' };
