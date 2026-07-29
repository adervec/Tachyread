// ponytail: the Play-button state→glyph/title mapping — every reading toggle it must reflect.
// Run: node src/features/playButtonMode.test.mjs
import assert from 'node:assert';
import { playButtonView } from './playButtonMode.js';

const V = (o) => playButtonView({ playing: false, scrollMode: false, readAloud: false, offlineVoice: false, followMode: 'off', timerMin: 0, adapt: false, voiceCmd: false, ...o });

// scroll mode disables auto-play entirely and wins over everything
const scroll = V({ scrollMode: true, readAloud: true, playing: true });
assert.equal(scroll.disabled, true, 'scroll mode disables the button');
assert.equal(scroll.glyph, '📜', 'scroll glyph');
assert.match(scroll.title, /Scroll-to-read is on/);

// idle / playing base glyphs
assert.equal(V({}).glyph, '▶', 'idle → play triangle');
assert.equal(V({ playing: true }).glyph, '❚❚', 'playing → pause bars');
assert.equal(V({}).disabled, false, 'not disabled normally');

// read-aloud changes the glyph (native vs offline voice), even while paused shows pause bars
assert.equal(V({ readAloud: true }).glyph, '🔊', 'read-aloud native → speaker');
assert.equal(V({ readAloud: true, offlineVoice: true }).glyph, '🎧', 'read-aloud offline → headphones');
assert.equal(V({ readAloud: true, playing: true }).glyph, '❚❚', 'playing beats the aloud glyph');
assert.equal(V({ readAloud: true }).cls, 'read-aloud', 'read-aloud class');
assert.equal(V({}).cls, '', 'no class when plain');

// title enumerates every engaged mode
assert.match(V({}).title, /^Play \(Space\)$/, 'plain title, no suffix');
assert.match(V({ playing: true }).title, /^Pause \(Space\)/, 'pause title when playing');
const all = V({ readAloud: true, offlineVoice: true, followMode: 'line', adapt: true, timerMin: 15, voiceCmd: true });
assert.match(all.title, /read aloud · offline voice/, 'offline voice noted');
assert.match(all.title, /follow: line/, 'follow mode noted');
assert.match(all.title, /adaptive pace/);
assert.match(all.title, /auto-stop 15m/, 'timer noted with minutes');
assert.match(all.title, /voice commands/);
assert.equal(V({ followMode: 'firstWord' }).title.includes('follow: first word'), true, 'firstWord follow label');
// a 0 timer must NOT show (guard against `||` / falsy slip)
assert.ok(!V({ timerMin: 0 }).title.includes('auto-stop'), 'timerMin 0 → no auto-stop text');
// off followMode must not appear
assert.ok(!V({ followMode: 'off' }).title.includes('follow'), 'followMode off → no follow text');

console.log('playButtonMode: all cases pass');
