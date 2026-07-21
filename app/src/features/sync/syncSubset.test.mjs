// Runnable check for the cloud-sync settings subset: `node src/features/sync/syncSubset.test.mjs`.
// The subtle bug this guards against is the sync clock never advancing (lastSync churn keeping a
// device "newest" forever) and data/identity leaking into the synced application-settings slice.
import { defaultGlobalSettings, syncableGlobalSettings, isSyncedGlobalKey } from '../../state/settings.js';

const fails = [];
const ok = (cond, label) => { if (!cond) fails.push(label); };

const g = defaultGlobalSettings();
const sub = syncableGlobalSettings(g);

// Default Tab Settings + a real preference ARE synced.
ok('fileDefaults' in sub, 'fileDefaults (Default Tab Settings) must sync');
ok('comfort' in sub, 'a preference (comfort) must sync');

// Device-local / data-library / sync-metadata keys are NOT synced.
for (const k of ['sync', 'deviceName', 'recentFiles', 'remoteGrabs', 'settingsUpdatedAt', 'webcamCalib', 'bookGroups']) {
  ok(!(k in sub), `${k} must NOT be in the synced settings`);
}

// The sync-clock key is the critical exclusion: a `sync.lastSync` write (only touches `sync`) must
// not bump settingsUpdatedAt, or this device would always look newest and never adopt remote settings.
ok(isSyncedGlobalKey('sync') === false, 'sync must not be a synced key');
ok(isSyncedGlobalKey('settingsUpdatedAt') === false, 'settingsUpdatedAt must not be a synced key');
ok(isSyncedGlobalKey('fileDefaults') === true, 'fileDefaults must be a synced key');
ok(isSyncedGlobalKey('defaultSerifFamily') === true, 'defaultSerifFamily must be a synced key');

// Every application-preference added over time must ride the sync automatically (the allowlist is
// by-exclusion, so a new key syncs unless it's explicitly data/identity). Guards against a future
// preference accidentally landing in GLOBAL_DATA_KEYS and silently not syncing.
for (const k of ['nightShift', 'nightShiftStrength', 'scrollBreakWords', 'mobileCamera', 'handHoldMs', 'eyeGestures', 'clapOff', 'gestureHands', 'shakeFullscreen', 'tabBarMultiRow']) {
  ok(k in sub, `application preference ${k} must cloud-sync`);
}
// Reusable per-file (tab) settings sync through fileDefaults / fileSettings, stripped of progress by
// tabDefaultsFrom. A newly-added display setting must survive that strip (i.e. NOT be treated as a
// per-document/progress field).
import { defaultFileSettings, tabDefaultsFrom } from '../../state/settings.js';
const reusable = tabDefaultsFrom(defaultFileSettings());
for (const k of ['linesEntryEffect', 'linesEntrySecs', 'orpStyles', 'wallJoiner', 'currentWordFontDelta', 'currentLineHighlight']) {
  ok(k in reusable, `per-tab display setting ${k} must be part of the synced reusable settings`);
}
// …while genuine per-document/progress fields must NOT leak into the reusable (synced) slice.
for (const k of ['wordIndex', 'completions', 'dailyHistory', 'sourceChecks', 'properNames']) {
  ok(!(k in reusable), `${k} is per-document and must stay out of the synced reusable settings`);
}

if (fails.length) { console.log('FAIL\n' + fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
else console.log('ok — sync subset: fileDefaults + prefs (incl. new ones) in; data/identity/sync-clock/per-doc out');
