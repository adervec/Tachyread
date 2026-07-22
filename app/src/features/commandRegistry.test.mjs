// ponytail: the command registry's dispatch + voice-phrase matching — the load-bearing logic that
// replaced the old hardcoded gesture/voice/clap switches.
// Run: node src/features/commandRegistry.test.mjs
import assert from 'node:assert';
import {
  runCommand, labelFor, actionLabel, matchVoice, parseSetWpm, setWpmCommandId,
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
    setWpmValue: (v) => calls.push(['setWpmValue', v]),
    page: (d) => calls.push(['page', d]),
    jumpToCurrent: () => calls.push(['jumpToCurrent']),
    jumpToFrontier: () => calls.push(['jumpToFrontier']),
    jumpToGap: () => calls.push(['jumpToGap']),
    toggleReadAloud: () => calls.push(['toggleReadAloud']),
    toggleScroll: () => calls.push(['toggleScroll']),
    toggleFocus: () => calls.push(['toggleFocus']),
    toggleFaces: () => calls.push(['toggleFaces']),
    toggleStats: () => calls.push(['toggleStats']),
    switchTab: (d) => calls.push(['switchTab', d]),
    sourcePage: (d) => calls.push(['sourcePage', d]),
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
runCommand('wpmUp100', c); assert.deepEqual(c.calls.at(-1), ['adjustWpm', 100]);
runCommand('wpmDown100', c); assert.deepEqual(c.calls.at(-1), ['adjustWpm', -100]);
runCommand('pageDown', c); assert.deepEqual(c.calls.at(-1), ['page', 1]);
runCommand('pageUp', c); assert.deepEqual(c.calls.at(-1), ['page', -1]);
runCommand('jumpToCurrent', c); assert.deepEqual(c.calls.at(-1), ['jumpToCurrent']);
runCommand('jumpFrontier', c); assert.deepEqual(c.calls.at(-1), ['jumpToFrontier']);
runCommand('jumpGap', c); assert.deepEqual(c.calls.at(-1), ['jumpToGap']);
runCommand('toggleReadAloud', c); assert.deepEqual(c.calls.at(-1), ['toggleReadAloud']);
runCommand('toggleScroll', c); assert.deepEqual(c.calls.at(-1), ['toggleScroll']);
runCommand('toggleFocus', c); assert.deepEqual(c.calls.at(-1), ['toggleFocus']);
runCommand('toggleFaces', c); assert.deepEqual(c.calls.at(-1), ['toggleFaces']);
runCommand('toggleStats', c); assert.deepEqual(c.calls.at(-1), ['toggleStats']);
runCommand('nextTab', c); assert.deepEqual(c.calls.at(-1), ['switchTab', 1]);
runCommand('prevTab', c); assert.deepEqual(c.calls.at(-1), ['switchTab', -1]);
runCommand('nextSourcePage', c); assert.deepEqual(c.calls.at(-1), ['sourcePage', 1]);
runCommand('prevSourcePage', c); assert.deepEqual(c.calls.at(-1), ['sourcePage', -1]);
// New voice defaults resolve.
assert.equal(matchVoice('read faster please', DEFAULT_VOICE_COMMANDS), 'wpmUp', 'faster → wpmUp');
assert.equal(matchVoice('slower', DEFAULT_VOICE_COMMANDS), 'wpmDown', 'slower → wpmDown');

// Unassigned / unknown ids are safe no-ops (that's how "no mapping" behaves).
c = spyCtx();
assert.equal(runCommand('', c), false, 'empty id → false');
assert.equal(runCommand(undefined, c), false, 'undefined id → false');
assert.equal(runCommand('bogus', c), false, 'unknown id → false');
assert.equal(c.calls.length, 0, 'no ctx calls for empty/unknown ids');

// --- parametric setWpm:<n> command ---
assert.equal(parseSetWpm('setWpm:400'), 400, 'parses a target WPM');
assert.equal(parseSetWpm('setWpm:0'), null, 'a 1-digit value is not a valid target');
assert.equal(parseSetWpm('wpmUp'), null, 'a normal command is not a setWpm');
assert.equal(parseSetWpm(''), null, 'empty → null');
assert.equal(setWpmCommandId(400), 'setWpm:400', 'builds the id');
assert.equal(setWpmCommandId(5000), 'setWpm:2000', 'clamps to the max');
assert.equal(setWpmCommandId(10), 'setWpm:50', 'clamps to the min');
c = spyCtx();
assert.equal(runCommand('setWpm:333', c), true, 'a setWpm id is a known command');
assert.deepEqual(c.calls, [['setWpmValue', 333]], 'and calls setWpmValue with the target');
assert.match(actionLabel('setWpm:450'), /450/, 'its feed label names the speed');
assert.match(labelFor('setWpm:450'), /450 WPM/, 'and so does its picker label');

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
