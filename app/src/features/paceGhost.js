// Pace ghost for MANUAL reading: a marker that walks the text at the auto-play WPM so you have
// something to race while you drive the position yourself. Auto-play already moves at that speed,
// so the ghost only runs when you're reading by hand.
//
// Pure — the caller supplies `now` and stores the small {startIdx, startedAt} run, so the whole
// thing is testable and the ghost costs one arithmetic op per tick rather than its own timer state.

// Words the ghost has covered since its run began. Guards a nonsense WPM so a bad setting can't
// teleport it to the end of the book.
export function ghostIndexAt({ startIdx = 0, startedAt = 0, now = 0, wpm = 250, totalWords = Infinity } = {}) {
  if (!startedAt || !(wpm > 0)) return null;
  const mins = Math.max(0, now - startedAt) / 60000;
  const rate = Math.max(10, Math.min(3000, wpm));
  const idx = Math.floor(startIdx + mins * rate);
  return Math.max(0, Math.min(totalWords > 0 ? totalWords - 1 : 0, idx));
}

// How the race stands. Positive delta = the reader is AHEAD of the ghost.
export function raceState(readerIdx, ghostIdx) {
  if (ghostIdx == null || readerIdx == null) return null;
  const delta = readerIdx - ghostIdx;
  // A word or two either way is just rounding on a marker that moves continuously — calling that
  // "behind" would make the readout flicker while you sit level with it.
  const status = delta > 2 ? 'ahead' : delta < -2 ? 'behind' : 'level';
  return { delta, status };
}

// The ghost restarts from wherever the reader is. It's a pace to race, not a score to defend:
// after a break, resuming against a ghost that ran on without you is just noise.
export const ghostRunFrom = (readerIdx, now) => ({ startIdx: Math.max(0, readerIdx || 0), startedAt: now });

// Why a run should end. Auto-play owns the pace itself, idle means you stopped reading, and a
// jump (chapter skip, search hit, a big rewind) invalidates the comparison entirely.
export function ghostResetReason({ playing = false, idle = false, readerIdx = 0, ghostIdx = null, jumpThreshold = 300 } = {}) {
  if (playing) return 'playing';
  if (idle) return 'idle';
  if (ghostIdx != null && Math.abs(readerIdx - ghostIdx) > jumpThreshold) return 'jump';
  return null;
}

// ── goal integration ──────────────────────────────────────────────────────────────────────────
// With a goal set, the race gets a finish line: the ghost stops at the goal's target index rather
// than wandering past it, and the readout becomes "who reaches the goal first".

// Cap a ghost position at the goal's target. Returns { idx, done }.
export function ghostAtGoal(ghostIdx, targetIdx) {
  if (ghostIdx == null) return null;
  if (targetIdx == null || !(targetIdx > 0)) return { idx: ghostIdx, done: false };
  return ghostIdx >= targetIdx ? { idx: targetIdx, done: true } : { idx: ghostIdx, done: false };
}

// Seconds for a walker at `wpm` to cover `words`. null when it will never get there.
const etaSec = (words, wpm) => (wpm > 0 ? Math.max(0, words) / wpm * 60 : null);

// Who reaches the goal target first, and by how much. `readerWpm` is the reader's MEASURED pace
// (their real speed), `ghostWpm` the ghost's set pace — comparing a measured rate against a target
// rate is the whole point, so they deliberately come from different places.
export function goalRace({ readerIdx = 0, ghostIdx = null, targetIdx = null, readerWpm = 0, ghostWpm = 0 } = {}) {
  if (targetIdx == null || !(targetIdx > 0) || ghostIdx == null) return null;
  const readerDone = readerIdx >= targetIdx;
  const ghostDone = ghostIdx >= targetIdx;
  const readerEta = readerDone ? 0 : etaSec(targetIdx - readerIdx, readerWpm);
  const ghostEta = ghostDone ? 0 : etaSec(targetIdx - ghostIdx, ghostWpm);
  // A finished racer beats an unfinished one outright, whatever the estimates say.
  if (readerDone || ghostDone) {
    const leader = readerDone && ghostDone ? 'tie' : readerDone ? 'you' : 'ghost';
    return { readerEta, ghostEta, leader, marginSec: 0, readerDone, ghostDone };
  }
  if (readerEta == null || ghostEta == null) return { readerEta, ghostEta, leader: null, marginSec: null, readerDone, ghostDone };
  const marginSec = Math.abs(readerEta - ghostEta);
  // Inside 5s the projection isn't precise enough to crown anyone.
  const leader = marginSec < 5 ? 'tie' : readerEta < ghostEta ? 'you' : 'ghost';
  return { readerEta, ghostEta, leader, marginSec, readerDone, ghostDone };
}
