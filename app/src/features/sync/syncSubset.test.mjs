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

if (fails.length) { console.log('FAIL\n' + fails.map((f) => ' - ' + f).join('\n')); }
else console.log('ok — sync subset: fileDefaults + prefs in; data/identity/sync-clock out');
