// Self-check for the pure half of keyboard tracking: ids, the catalog, and the per-keyboard rollup.
// The WebHID / getLayoutMap calls are browser-only and stay unexercised here.
import assert from 'node:assert/strict';
import {
  hash32, hidId, layoutId, layoutLabel,
  keyboardList, upsertKeyboard, renameKeyboard, removeKeyboard, labelFor, keyboardRows,
  activeKeyboard, setActiveKeyboard,
} from './keyboards.js';

// Ids are stable and distinguish devices.
assert.equal(hash32('abc'), hash32('abc'));
assert.notEqual(hash32('abc'), hash32('abd'));
assert.equal(hidId({ vendorId: 0x3434, productId: 0x0121 }), 'hid:0x3434:0x0121');
assert.equal(hidId({ vendorId: 5, productId: 6 }), 'hid:0x0005:0x0006');

// Layout ids come from what the keys produce, so QWERTY ≠ AZERTY ≠ QWERTZ but QWERTY == QWERTY.
const qwerty = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyY: 'y' };
const azerty = { ...qwerty, KeyQ: 'a', KeyW: 'z' };
assert.equal(layoutId(qwerty), layoutId({ ...qwerty }));
assert.notEqual(layoutId(qwerty), layoutId(azerty));
assert.equal(layoutLabel(qwerty), 'QWERTY keyboard');
assert.equal(layoutLabel(azerty), 'AZERTY keyboard');
assert.equal(layoutLabel({}), 'Keyboard');
// A real getLayoutMap() is a Map, not a plain object — both must work.
assert.equal(layoutId(new Map(Object.entries(qwerty))), layoutId(qwerty));

// Catalog: add once, renames stick, re-detecting must not overwrite a user's label.
let list = keyboardList(undefined);
assert.deepEqual(list, []);
list = upsertKeyboard(list, { id: 'hid:0x1:0x2', label: 'K2' });
list = upsertKeyboard(list, { id: 'hid:0x1:0x2', label: 'K2' });
assert.equal(list.length, 1, 'upsert must not duplicate');
list = renameKeyboard(list, 'hid:0x1:0x2', 'Keychron on the desk');
list = upsertKeyboard(list, { id: 'hid:0x1:0x2', label: 'K2' });
assert.equal(labelFor(list, 'hid:0x1:0x2'), 'Keychron on the desk', 'detection must not clobber a rename');
list = upsertKeyboard(list, { id: 'layout:zzz', label: 'QWERTZ keyboard' });
assert.equal(list.length, 2);
assert.equal(removeKeyboard(list, 'layout:zzz').length, 1);
assert.equal(upsertKeyboard(list, { label: 'no id' }).length, 2, 'an entry with no id is dropped');

// Rollup: grouped per keyboard, labelled from the catalog, busiest first, legacy runs kept.
const rows = keyboardRows([
  { keyboard: 'hid:0x1:0x2', netWpm: 60, accuracy: 97, words: 100 },
  { keyboard: 'hid:0x1:0x2', netWpm: 70, accuracy: 95, words: 120 },
  { keyboard: 'layout:zzz', netWpm: 40, accuracy: 90, words: 50 },
  { netWpm: 30, accuracy: 88, words: 10 },
], list);
assert.equal(rows.length, 3);
assert.equal(rows[0].id, 'hid:0x1:0x2');
assert.equal(rows[0].label, 'Keychron on the desk');
assert.equal(rows[0].runs, 2);
assert.equal(rows[0].avgNet, 65);
assert.equal(rows[0].best, 70);
assert.equal(rows[0].avgAcc, 96);
assert.equal(rows[0].words, 220);
assert.equal(rows.find((r) => r.id === 'unknown').label, 'Unrecorded');
assert.deepEqual(keyboardRows([], list), []);

// A run stamped by a keyboard the user has since deleted still shows its own snapshot label.
assert.equal(keyboardRows([{ keyboard: 'hid:0x9:0x9', keyboardLabel: 'Old board', netWpm: 1 }], list)[0].label, 'Old board');

// The active-keyboard slot the run recorder reads.
assert.equal(activeKeyboard(), null);
setActiveKeyboard({ id: 'hid:0x1:0x2', label: 'K2' });
assert.equal(activeKeyboard().id, 'hid:0x1:0x2');
setActiveKeyboard(null);
assert.equal(activeKeyboard(), null);

console.log('keyboards: all cases pass');
