// Self-check for the update notice's decision. Run: node src/features/appHealth.test.mjs
import assert from 'node:assert/strict';
import { isNewBuild } from './appHealth.js';

// update notice
assert.equal(isNewBuild('abc1234', 'def5678'), true, 'a different deployed build');
assert.equal(isNewBuild('abc1234', 'abc1234'), false, 'same build');
assert.equal(isNewBuild('abc1234', undefined), false, 'no version.json');
assert.equal(isNewBuild('dev', 'def5678'), false, 'a local dev build never nags');
console.log('appHealth: all cases pass');
