// Self-check for the collapsed-dock control chooser.
import assert from 'node:assert/strict';
import { DOCK_MINI_ITEMS, dockMiniShow, dockMiniIds } from './dockMini.js';

// Catalog sanity: unique ids, a label each, at least one on by default.
const ids = DOCK_MINI_ITEMS.map(([id]) => id);
assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
assert.ok(DOCK_MINI_ITEMS.every(([, label]) => typeof label === 'string' && label.length > 2));
assert.ok(DOCK_MINI_ITEMS.some(([, , on]) => on));

// Nothing stored → the defaults, in catalog order.
const def = dockMiniIds(null, { sourceAvailable: true });
assert.deepEqual(def, ['play', 'pageUp', 'prevLine', 'nextLine', 'pageDown', 'sourcePage', 'jump', 'counter']);
assert.deepEqual(dockMiniIds(undefined, { sourceAvailable: true }), def);
assert.deepEqual(dockMiniIds({}, { sourceAvailable: true }), def);

// A stored choice wins, and UNLISTED ids keep their default rather than vanishing — so a control
// added in a later release still shows up for someone with a saved setup.
const stored = { pageUp: false, prevWord: true };
const got = dockMiniIds(stored, { sourceAvailable: true });
assert.ok(!got.includes('pageUp'), 'explicitly hidden');
assert.ok(got.includes('prevWord'), 'explicitly shown');
assert.ok(got.includes('play'), 'unmentioned control keeps its default');
assert.deepEqual(got, ['play', 'prevLine', 'nextLine', 'pageDown', 'prevWord', 'sourcePage', 'jump', 'counter']);

// Source-page buttons need a source, whatever the preference says.
assert.ok(!dockMiniIds(null, { sourceAvailable: false }).includes('sourcePage'));
assert.ok(!dockMiniIds({ sourcePage: true }, { sourceAvailable: false }).includes('sourcePage'));
assert.ok(dockMiniIds({ sourcePage: true }, { sourceAvailable: true }).includes('sourcePage'));

// Everything off is allowed — an empty mini dock is a legitimate choice.
const allOff = Object.fromEntries(ids.map((id) => [id, false]));
assert.deepEqual(dockMiniIds(allOff, { sourceAvailable: true }), []);

// Order always follows the catalog, never the insertion order of the stored map. (Everything else
// is switched off explicitly here — an unmentioned id would correctly keep its default and appear.)
const onlyThree = { ...allOff, counter: true, play: true, jump: true };
assert.deepEqual(dockMiniIds(onlyThree, {}), ['play', 'jump', 'counter']);

// dockMiniShow reports every id, always.
const show = dockMiniShow({ play: false });
assert.equal(Object.keys(show).length, ids.length);
assert.equal(show.play, false);
assert.equal(show.counter, true);
assert.equal(dockMiniShow('nonsense').play, true, 'a corrupt value falls back to defaults');

console.log('dockMini: all cases pass');
