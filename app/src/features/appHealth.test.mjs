// Self-check for the crash and update notices' decisions. Run: node src/features/appHealth.test.mjs
import assert from 'node:assert/strict';
import { crashText, isNewBuild } from './appHealth.js';

// crashes are shown…
assert.equal(crashText({ error: new TypeError('x is undefined') }), 'x is undefined', 'an uncaught error');
assert.equal(crashText({ reason: new Error('save failed') }), 'save failed', 'an unhandled rejection');
assert.equal(crashText({ reason: 'plain string' }), 'plain string', 'a rejected string');
assert.equal(crashText({ message: 'from the event only' }), 'from the event only');
assert.equal(crashText({ error: new Error('y'.repeat(300)) }).length, 158, 'long messages are cut');
// …browser noise is not
assert.equal(crashText({ message: 'ResizeObserver loop completed with undelivered notifications.' }), null);
assert.equal(crashText({ message: 'Script error.' }), null, 'opaque cross-origin error');
assert.equal(crashText({ reason: Object.assign(new Error('aborted'), { name: 'AbortError' }) }), null);
assert.equal(crashText({ reason: Object.assign(new Error('play() failed'), { name: 'NotAllowedError' }) }), null);
assert.equal(crashText({}), null);

// update notice
assert.equal(isNewBuild('abc1234', 'def5678'), true, 'a different deployed build');
assert.equal(isNewBuild('abc1234', 'abc1234'), false, 'same build');
assert.equal(isNewBuild('abc1234', undefined), false, 'no version.json');
assert.equal(isNewBuild('dev', 'def5678'), false, 'a local dev build never nags');
console.log('appHealth: all cases pass');
