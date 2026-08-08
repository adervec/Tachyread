// Self-check for the non-browser half of Show File Location: the handle key and the two guards that
// must answer without touching IndexedDB or the picker. The picker path itself is browser-only.
import assert from 'node:assert/strict';

globalThis.window = {}; // no showOpenFilePicker → the "unsupported browser" branch
const { handleKey, revealSupported, revealFile } = await import('./revealFile.js');

assert.equal(handleKey('War and Peace.epub'), 'docFile:War and Peace.epub');
assert.notEqual(handleKey('a.txt'), handleKey('b.txt'));

assert.equal(revealSupported(), false);
assert.match((await revealFile('a.txt')).text, /Chromium/);

// No document open wins over everything, so the message is never about the browser.
assert.match((await revealFile('')).text, /No document open/);
assert.match((await revealFile(undefined)).text, /No document open/);

// Guards return before any IndexedDB read — proven by the fact that we got here with no fake DB.
globalThis.window = { showOpenFilePicker: () => { throw new Error('should not be called'); } };
assert.equal(revealSupported(), true);
assert.match((await revealFile(null)).text, /No document open/);

console.log('revealFile: all cases pass');
