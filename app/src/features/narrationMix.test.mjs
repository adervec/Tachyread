import assert from 'node:assert/strict';
import { narrationMix } from './narrationQuality.js';

const mix = narrationMix([
  { source: 'mic', quality: { score: 80, accuracy: 90, completeness: 100, voice: { overall: 70 } } },
  { source: 'mic', quality: { score: 60, accuracy: 70 } },
  { source: 'tts', voiceId: 'piper:x' },
  null, null,
]);
assert.equal(mix.human, 2); assert.equal(mix.bot, 1); assert.equal(mix.none, 2); assert.equal(mix.total, 5);
assert.deepEqual(mix.avg, { score: 70, accuracy: 80, completeness: 100, voice: 70 });
assert.deepEqual(narrationMix([]).avg, {});
console.log('narrationMix: all cases pass');
