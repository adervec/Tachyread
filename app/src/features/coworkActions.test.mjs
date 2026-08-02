// Self-check: cowork sync action catalog, schedules, device role, run history + calendar.
// Run: node src/features/coworkActions.test.mjs
import assert from 'node:assert/strict';
import {
  SYNC_ACTION_GROUPS, SYNC_ACTIONS, actionById, combineCoworkInstruction,
  SCHEDULE_OPTS, nextDueAt, dueActions, syncRole, recordRun, mergedHistory,
  dayKey, calendarCells, fmtAgo, HISTORY_CAP,
} from './coworkActions.js';
import { LIGHT_INSTRUCTION, HEAVY_PLACEHOLDER } from './journeyAi.js';

// Catalog shape: unique ids, every action carries group/kind, the API group is key-gated.
const ids = SYNC_ACTIONS.map((a) => a.id);
assert.equal(new Set(ids).size, ids.length, 'action ids unique');
assert.ok(SYNC_ACTIONS.length >= 8, 'a rich action set');
assert.ok(SYNC_ACTION_GROUPS.find((g) => g.id === 'api')?.needsKey, 'API group gated on the key');
assert.equal(actionById('cw-tree').kind, 'cowork');
assert.equal(actionById('cloud-library').kind, 'cloud');
assert.equal(actionById('nope'), null);

// Instruction combining: none → null; light only → light; any heavy → heavy; custom text rides along.
assert.equal(combineCoworkInstruction([]), null);
assert.equal(combineCoworkInstruction(['api-light']), null, 'non-cowork ids ignored');
const li = combineCoworkInstruction(['cw-light']);
assert.equal(li.mode, 'light');
assert.equal(li.text, LIGHT_INSTRUCTION);
const hv = combineCoworkInstruction(['cw-light', 'cw-tree', 'cw-custom'], 'Also cross-check translations.');
assert.equal(hv.mode, 'heavy');
assert.ok(hv.text.includes(LIGHT_INSTRUCTION) && hv.text.includes(HEAVY_PLACEHOLDER) && hv.text.includes('cross-check translations'), 'texts concatenate in order');
assert.equal(combineCoworkInstruction(['cw-custom'], '   ').text, LIGHT_INSTRUCTION, 'blank custom falls back');

// Schedules: manual → never due; scheduled-but-never-run → due immediately; due exactly at last+period.
assert.equal(nextDueAt('off', 5), null);
assert.equal(nextDueAt(undefined, 5), null);
assert.equal(nextDueAt('hourly', 0), 3600e3, 'never run → due one period after epoch (i.e. long past)');
assert.equal(nextDueAt('daily', 1000), 1000 + 86400e3);
const NOW = 10 * 86400e3;
const scheds = { 'cw-light': 'hourly', 'cloud-progress': 'daily', 'cw-tree': 'off', 'api-light': 'weekly' };
const runs = {
  'cw-light': { at: NOW - 30 * 60e3 },        // ran 30 min ago → hourly NOT due
  'cloud-progress': { at: NOW - 2 * 86400e3 }, // 2 days ago → daily due
  // api-light never ran → weekly due immediately
};
assert.deepEqual(dueActions(scheds, runs, NOW), ['api-light', 'cloud-progress'], 'due list in catalog order');
assert.deepEqual(dueActions({}, {}, NOW), [], 'no schedules → nothing due');
assert.ok(SCHEDULE_OPTS.some((o) => o.id === '30m') && SCHEDULE_OPTS.some((o) => o.id === 'weekly'), 'range of cadences');

// Role: open until designated; machine on the designated device; viewer elsewhere.
assert.equal(syncRole(null, 'dev-a').role, 'open');
assert.equal(syncRole({ syncMachine: null }, 'dev-a').role, 'open');
const withM = { syncMachine: { deviceId: 'dev-a', name: 'Desktop', at: 1 } };
assert.equal(syncRole(withM, 'dev-a').role, 'machine');
assert.equal(syncRole(withM, 'dev-b').role, 'viewer');
assert.equal(syncRole(withM, 'dev-b').machine.name, 'Desktop');

// recordRun: stamps every id, appends one history entry, caps the log.
let ai = recordRun({}, ['cw-light', 'cw-tree'], { at: 111, kind: 'cowork', target: 'D:\\Cowork\\Tachyread', ok: true, note: 'wrote request' });
assert.equal(ai.actionRuns['cw-light'].at, 111);
assert.equal(ai.actionRuns['cw-tree'].target, 'D:\\Cowork\\Tachyread');
assert.equal(ai.syncHistory.length, 1);
ai = recordRun(ai, ['cloud-progress'], { at: 222, kind: 'cloud', target: 'Google Drive', ok: false, note: 'offline', auto: true });
assert.equal(ai.syncHistory.length, 2);
assert.equal(ai.actionRuns['cloud-progress'].ok, false);
assert.equal(ai.actionRuns['cw-light'].at, 111, 'other runs untouched');
let capped = { syncHistory: Array.from({ length: HISTORY_CAP }, (_, i) => ({ at: i, ids: [], kind: 'cloud', ok: true })) };
capped = recordRun(capped, ['cw-light'], { at: 9999, kind: 'cowork' });
assert.equal(capped.syncHistory.length, HISTORY_CAP, 'history capped');
assert.equal(capped.syncHistory.at(-1).at, 9999, 'newest kept');

// mergedHistory folds the legacy activity feed in, newest first.
const merged = mergedHistory({
  syncHistory: [{ at: 50, ids: ['cw-light'], kind: 'cowork', ok: true }],
  activity: [{ at: 70, kind: 'digest', text: 'Copied digest' }, { at: 10, kind: 'apply', text: 'Applied' }],
});
assert.deepEqual(merged.map((h) => h.at), [70, 50, 10]);
assert.ok(merged[0].legacy && merged[0].note === 'Copied digest');

// Calendar: 42 Monday-first cells, counts + error counts land on the right local day.
const feb10 = new Date(2026, 1, 10, 12).getTime();
const cells = calendarCells(2026, 1, [
  { at: feb10, ok: true }, { at: feb10 + 3600e3, ok: false }, { at: new Date(2026, 0, 31, 8).getTime(), ok: true },
]);
assert.equal(cells.length, 42);
const d10 = cells.find((c) => c.key === '2026-02-10');
assert.equal(d10.count, 2);
assert.equal(d10.errs, 1);
assert.ok(d10.inMonth);
const jan31 = cells.find((c) => c.key === '2026-01-31');
assert.ok(jan31 && !jan31.inMonth && jan31.count === 1, 'lead-in day carries its count, flagged out-of-month');
assert.equal(cells[0].key, '2026-01-26', 'grid starts on the Monday before Feb 1 (a Sunday)');
assert.equal(dayKey(feb10), '2026-02-10');

// fmtAgo buckets.
const now = 1_000_000_000_000;
assert.equal(fmtAgo(0, now), 'never');
assert.equal(fmtAgo(now - 20e3, now), 'just now');
assert.equal(fmtAgo(now - 5 * 60e3, now), '5m ago');
assert.equal(fmtAgo(now - 3 * 3600e3, now), '3h ago');
assert.equal(fmtAgo(now - 5 * 86400e3, now), '5d ago');

console.log('coworkActions: all checks passed');
