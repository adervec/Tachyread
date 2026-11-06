import assert from 'node:assert/strict';
import { parseNarrationTags, hasNarrationTags, resolveVoice } from './narrationTags.js';

assert.equal(hasNarrationTags('plain text'), false);
assert.equal(hasNarrationTags('a [Pause:2] b'), true);
assert.deepEqual(parseNarrationTags('It was night. [pause:2] Then [voice:Amy]“Who is there?”[/voice] he said. [break] [pause]'), [
  { kind: 'speech', text: 'It was night.', voice: null },
  { kind: 'pause', ms: 2000 },
  { kind: 'speech', text: 'Then', voice: null },
  { kind: 'speech', text: '“Who is there?”', voice: 'Amy' },
  { kind: 'speech', text: 'he said.', voice: null },
  { kind: 'pause', ms: 1500 },
  { kind: 'pause', ms: 750 },
]);
assert.deepEqual(parseNarrationTags('[pause:99]'), [{ kind: 'pause', ms: 10000 }], 'capped at 10 s');
assert.deepEqual(parseNarrationTags('no tags here'), [{ kind: 'speech', text: 'no tags here', voice: null }]);
assert.deepEqual(parseNarrationTags('[voice:x]unclosed'), [{ kind: 'speech', text: 'unclosed', voice: 'x' }]);

const voices = [{ id: 'en_US-amy-medium', label: 'English (US) — Amy' }, { id: 'el:abc', label: 'Rachel' }];
assert.equal(resolveVoice('Amy', voices, 'def'), 'en_US-amy-medium', 'by label');
assert.equal(resolveVoice('rachel', voices, 'def'), 'el:abc', 'case-insensitive');
assert.equal(resolveVoice('el:abc', voices, 'def'), 'el:abc', 'exact id');
assert.equal(resolveVoice('Nobody', voices, 'def'), 'def', 'unknown → the job voice');
assert.equal(resolveVoice(null, voices, 'def'), 'def');
console.log('narrationTags: all cases pass');
