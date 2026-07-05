// Self-check for the guided squashed-ToC parsing — run: node app/src/document/tocWizard.demo.mjs
import assert from 'node:assert';
import { autoSplitSquashed, parseManualToc, parsePrintedToc } from './tocWizard.js';

// A whole contents list squashed onto ONE line (the case the wizard used to choke on).
const blob = 'Introduction 1 Chapter One The Beginning 5 Chapter Two Rising Action 20 Conclusion 99';

// parsePrintedToc on a single line finds ~nothing usable (too long → dropped, or one blob).
const oneLineDoc = { lines: [{ text: blob, isEmpty: false, startWordIndex: 0 }], words: new Array(20) };
assert.ok(parsePrintedToc(oneLineDoc, 0, 0).length <= 1, 'the automatic parse cannot split one line');

// The guided path: auto-suggest a split, then parse it line-per-entry.
const split = autoSplitSquashed(blob);
assert.ok(split.split('\n').length >= 3, `squashed blob splits into lines, got:\n${split}`);
const parsed = parseManualToc(split);
assert.ok(parsed.length >= 3, `parsed ${parsed.length} entries`);
assert.equal(parsed[0].title, 'Introduction');
assert.equal(parsed[0].page, 1);
assert.ok(parsed.some((p) => p.page === 20), 'a mid entry keeps its page number');
assert.ok(parsed.every((p) => p.title && p.title.length >= 2));

// Hand-editing the text is respected (the user can fix a bad auto-split).
const manual = parseManualToc('Prologue 2\nPart One 10\nPart Two 44');
assert.deepEqual(manual.map((p) => p.title), ['Prologue', 'Part One', 'Part Two']);
assert.deepEqual(manual.map((p) => p.page), [2, 10, 44]);

console.log('tocWizard.demo: guided squashed-ToC parsing passed ✅');
