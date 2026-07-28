// ponytail: the focus-panel catalog + ordered-list helpers (fold defaults, reorder, show-set).
// Run: node src/features/focusWidgets.test.mjs
import assert from 'node:assert';
import { FOCUS_WIDGET_ITEMS, FOCUS_WIDGET_LABEL, focusPanelList, reorderPanels, focusPanelsToShow } from './focusWidgets.js';

// catalog integrity
const ids = FOCUS_WIDGET_ITEMS.map((w) => w[0]);
assert.equal(new Set(ids).size, ids.length, 'widget ids are unique');
assert.ok(FOCUS_WIDGET_ITEMS.every(([, label]) => label && typeof label === 'string'), 'every widget has a label');
assert.ok(ids.includes('faces') && ids.includes('nowWpm') && ids.includes('goal'), 'core widgets present');
assert.equal(FOCUS_WIDGET_LABEL.faces, 'Reader faces', 'label lookup works');

// focusPanelList([]) → full catalog in catalog order with default on-flags
const full = focusPanelList([]);
assert.deepEqual(full.map((e) => e.id), ids, 'empty stored → full catalog in order');
assert.equal(full.find((e) => e.id === 'faces').on, true, 'faces on by default');
assert.equal(full.find((e) => e.id === 'clock').on, false, 'clock off by default');
assert.deepEqual(focusPanelList(null).map((e) => e.id), ids, 'null stored → full catalog');

// a partial stored list keeps user order + on-flags, appends new ids at end, drops unknown ids
const stored = [
  { id: 'goal', on: false },     // user turned goal off + moved it first
  { id: 'faces', on: true },
  { id: 'bogus', on: true },     // unknown → dropped
];
const folded = focusPanelList(stored);
assert.equal(folded[0].id, 'goal', 'user order preserved (goal first)');
assert.equal(folded[0].on, false, 'user on-flag preserved (goal off)');
assert.equal(folded[1].id, 'faces', 'faces second, as saved');
assert.ok(!folded.some((e) => e.id === 'bogus'), 'unknown id dropped');
assert.equal(folded.length, ids.length, 'all catalog ids present exactly once');
assert.equal(folded.filter((e) => e.id === 'goal').length, 1, 'no duplicates');
// newly-added catalog ids land at the end with their default
const appended = folded.slice(2);
assert.ok(appended.every((e) => e.id !== 'goal' && e.id !== 'faces'), 'the rest are appended catalog ids');
assert.equal(appended.find((e) => e.id === 'clock')?.on, false, 'appended clock keeps its default (off)');

// reorderPanels moves by id
const moved = reorderPanels([], 'nowWpm', 'faces'); // move nowWpm to where faces is (front)
assert.equal(moved[0].id, 'nowWpm', 'nowWpm moved to front');
assert.equal(moved.length, ids.length, 'reorder preserves the set');
assert.deepEqual(reorderPanels([], 'faces', 'faces').map((e) => e.id), ids, 'same id → no-op');
assert.deepEqual(reorderPanels([], 'faces', 'nope').map((e) => e.id), ids, 'missing target → no-op');

// focusPanelsToShow: ordered enabled ids, or [] when master off
const show = focusPanelsToShow([], true);
assert.deepEqual(show, full.filter((e) => e.on).map((e) => e.id), 'shows the default-on widgets in order');
assert.ok(show.includes('faces') && !show.includes('clock'), 'on/off respected');
assert.deepEqual(focusPanelsToShow([], false), [], 'master off → nothing shows');
assert.deepEqual(focusPanelsToShow([{ id: 'clock', on: true }, { id: 'faces', on: false }], true)[0], 'clock', 'custom order + on wins');

console.log('focusWidgets: all cases pass');
