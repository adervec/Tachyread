// ponytail: the command registry's dispatch + voice-phrase matching — the load-bearing logic that
// replaced the old hardcoded gesture/voice/clap switches.
// Run: node src/features/commandRegistry.test.mjs
import assert from 'node:assert';
import {
  runCommand, labelFor, actionLabel, matchVoice,
  COMMAND_BY_ID, DEFAULT_VOICE_COMMANDS, DEFAULT_GESTURE_MAP, DEFAULT_CLAP_MAP,
} from './commandRegistry.js';

// --- runCommand dispatches the right action against the ctx bag ---
function spyCtx() {
  const calls = [];
  return {
    calls,
    playPause: () => calls.push(['playPause']),
    setPlaying: (v) => calls.push(['setPlaying', v]),
    nav: (k) => calls.push(['nav', k]),
    adjustWpm: (d) => calls.push(['adjustWpm', d]),
  };
}
let c = spyCtx();
assert.equal(runCommand('nextWord', c), true, 'known id returns true');
assert.deepEqual(c.calls.at(-1), ['nav', 'nextWord'], 'nextWord → nav(nextWord)');
runCommand('prevPara', c); assert.deepEqual(c.calls.at(-1), ['nav', 'prevPara']);
runCommand('playPause', c); assert.deepEqual(c.calls.at(-1), ['playPause']);
runCommand('pause', c); assert.deepEqual(c.calls.at(-1), ['setPlaying', false], 'pause → setPlaying(false)');
runCommand('play', c); assert.deepEqual(c.calls.at(-1), ['setPlaying', true]);
runCommand('wpmUp', c); assert.deepEqual(c.calls.at(-1), ['adjustWpm', 25]);
runCommand('wpmDown', c); assert.deepEqual(c.calls.at(-1), ['adjustWpm', -25]);

// Unassigned / unknown ids are safe no-ops (that's how "no mapping" behaves).
c = spyCtx();
assert.equal(runCommand('', c), false, 'empty id → false');
assert.equal(runCommand(undefined, c), false, 'undefined id → false');
assert.equal(runCommand('bogus', c), false, 'unknown id → false');
assert.equal(c.calls.length, 0, 'no ctx calls for empty/unknown ids');

// --- matchVoice against the editable phrase list ---
// Exact + contained matches.
assert.equal(matchVoice('play', DEFAULT_VOICE_COMMANDS), 'play', 'exact phrase');
assert.equal(matchVoice("let's play now", DEFAULT_VOICE_COMMANDS), 'play', 'transcript containing the phrase still matches');
// Two different phrases → one command (stop and pause both pause; next and forward both step).
assert.equal(matchVoice('stop', DEFAULT_VOICE_COMMANDS), 'pause', 'stop → pause');
assert.equal(matchVoice('pause', DEFAULT_VOICE_COMMANDS), 'pause', 'pause → pause (same command as stop)');
assert.equal(matchVoice('go forward', DEFAULT_VOICE_COMMANDS), 'nextWord', 'forward → nextWord');
assert.equal(matchVoice('next', DEFAULT_VOICE_COMMANDS), 'nextWord', 'next → nextWord (same command as forward)');
// No match → null.
assert.equal(matchVoice('banana', DEFAULT_VOICE_COMMANDS), null, 'unrelated speech → null');
// Custom user phrase mapped to any command.
const custom = [{ phrase: 'zoom ahead', commandId: 'nextPara' }, { phrase: 'chill', commandId: 'pause' }];
assert.equal(matchVoice('zoom ahead', custom), 'nextPara', 'custom phrase → its command');
assert.equal(matchVoice('chill', custom), 'pause');
// Rows with an empty phrase or command never match.
assert.equal(matchVoice('anything', [{ phrase: '', commandId: 'play' }, { phrase: 'x', commandId: '' }]), null);

// --- defaults are internally consistent (every mapped id is a real command) ---
for (const id of Object.values(DEFAULT_GESTURE_MAP)) assert.ok(COMMAND_BY_ID[id], `gesture default ${id} is a real command`);
for (const id of Object.values(DEFAULT_CLAP_MAP)) assert.ok(COMMAND_BY_ID[id], `clap default ${id} is a real command`);
for (const r of DEFAULT_VOICE_COMMANDS) assert.ok(COMMAND_BY_ID[r.commandId], `voice default ${r.commandId} is a real command`);

// --- labels ---
assert.equal(labelFor('nextPara'), 'Next paragraph');
assert.equal(labelFor(''), '(none)');
assert.equal(actionLabel('pause'), '❚❚ Pause');
assert.equal(actionLabel('bogus'), '', 'unknown id → empty action label');

console.log('commandRegistry: all cases pass');
