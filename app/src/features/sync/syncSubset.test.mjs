// Runnable check for the cloud-sync settings subset: `node src/features/sync/syncSubset.test.mjs`.
// The subtle bug this guards against is the sync clock never advancing (lastSync churn keeping a
// device "newest" forever) and data/identity leaking into the synced application-settings slice.
import { defaultGlobalSettings, syncableGlobalSettings, isSyncedGlobalKey, appProfileSettings, resetGlobalToDefaults, GLOBAL_DATA_KEYS } from '../../state/settings.js';

const fails = [];
const ok = (cond, label) => { if (!cond) fails.push(label); };

const g = defaultGlobalSettings();
const sub = syncableGlobalSettings(g);

// Only the Default Tab Settings sync at the global level — reading/display defaults follow you.
ok('fileDefaults' in sub, 'fileDefaults (Default Tab Settings) must sync');
ok(Object.keys(sub).length === 1, `ONLY fileDefaults syncs globally, got: ${Object.keys(sub).join(', ')}`);

// Application preferences are now DEVICE-SPECIFIC — they must NOT sync (nor a preference like comfort).
for (const k of ['comfort', 'sync', 'deviceName', 'recentFiles', 'remoteGrabs', 'settingsUpdatedAt', 'webcamCalib', 'bookGroups',
  'nightShift', 'nightShiftStrength', 'scrollBreakWords', 'shakeFullscreen', 'tabBarMultiRow', 'language', 'ljView', 'startOnLanding']) {
  ok(!(k in sub), `${k} is device-specific and must NOT be in the synced settings`);
}

// Biometric settings are device-specific too (tuned to a device's camera/setup) — none may sync.
for (const k of ['mobileCamera', 'handHoldMs', 'eyeGestures', 'clapOff', 'gestureHands', 'handGestures', 'gestureMap', 'voiceCommands', 'holdPauseGesture', 'triggerSeqs']) {
  ok(!(k in sub), `biometric setting ${k} is device-specific and must NOT sync`);
}

// The sync-clock key stays excluded (a `sync.lastSync` write must not look like a settings change),
// and the ONLY synced global key is fileDefaults.
ok(isSyncedGlobalKey('sync') === false, 'sync must not be a synced key');
ok(isSyncedGlobalKey('settingsUpdatedAt') === false, 'settingsUpdatedAt must not be a synced key');
ok(isSyncedGlobalKey('fileDefaults') === true, 'fileDefaults must be a synced key');
ok(isSyncedGlobalKey('nightShift') === false, 'an application preference must NOT be a synced key');
ok(isSyncedGlobalKey('gestureMap') === false, 'a biometric setting must NOT be a synced key');
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

// ── application-settings PROFILES still capture the full preference set (regression: after sync was
// narrowed to fileDefaults, the "app" profile capture must NOT collapse to just fileDefaults). ──
const g2 = { ...defaultGlobalSettings(), nightShift: true, language: 'hr', gestureMap: { fist: 'pause' }, recentFiles: [{ n: 1 }], anthropicKey: 'secret', deviceName: 'PC', settingsUpdatedAt: 123 };
const prof = appProfileSettings(g2);
for (const k of ['fileDefaults', 'nightShift', 'language', 'gestureMap', 'idleGraceSecs']) ok(k in prof, `app profile must snapshot preference ${k}`);
ok(Object.keys(prof).length > 5, `app profile captures the whole preference set, not just fileDefaults (got ${Object.keys(prof).length} keys)`);
for (const k of ['recentFiles', 'anthropicKey', 'deviceName', 'settingsProfiles', 'settingsUpdatedAt', 'sync']) ok(!(k in prof), `app profile must NOT include data/identity key ${k}`);

// ── reset preserves user DATA + calibration it promises to keep (regression: ocrProfiles + handCalib
// were being wiped). ──
for (const k of ['ocrProfiles', 'handCalib', 'webcamCalib', 'ocrTemplates', 'fileDefaults']) ok(GLOBAL_DATA_KEYS.has(k), `${k} must be preserved on reset (in GLOBAL_DATA_KEYS)`);
const withData = { ...defaultGlobalSettings(), nightShift: true, ocrProfiles: [{ id: 'x' }], handCalib: { centerY: 0.5 }, recentFiles: [{ n: 1 }] };
const afterReset = resetGlobalToDefaults(withData);
ok(afterReset.nightShift === false, 'reset restores a preference to default');
ok(Array.isArray(afterReset.ocrProfiles) && afterReset.ocrProfiles.length === 1, 'reset KEEPS ocrProfiles (saved OCR layouts)');
ok(afterReset.handCalib && afterReset.handCalib.centerY === 0.5, 'reset KEEPS handCalib (hand calibration)');
ok(afterReset.recentFiles.length === 1, 'reset keeps recentFiles');

if (fails.length) { console.log('FAIL\n' + fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
else console.log('ok — sync subset: ONLY fileDefaults syncs; app profile snapshots ALL prefs; reset keeps data+calibration; per-file display still syncs');
