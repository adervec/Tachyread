import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  exportAllData, exportSummary, importAllData,
  storeCounts, clearStore, wipeAllData, getAppLog, clearAppLog,
} from '../state/storage.js';
import { saveBlobToFile, pickFile, readFileText } from '../features/fileSystem.js';
import { SYNC_PROVIDERS, getSyncProvider, driveOriginAllowed, getDriveProfile } from '../features/sync/syncProviders.js';
import { backupToProvider, restoreFromProvider, syncWithProvider } from '../features/sync/syncManager.js';

// Friendly names + display order for the object stores shown in the Overview.
const STORE_LABELS = {
  files: 'Library & reading progress', readstate: 'Reading masks', docs: 'Document cache',
  grabbed: 'Grabbed (OCR) books', grabSessions: 'Unfinished grabs', typingRuns: 'Typing runs',
  focusSessions: 'Focus sessions', audiobook: 'Audiobook clips', audiobookManifest: 'Audiobook index',
  global: 'Settings & session', fsHandles: 'Saved folder handles',
};
const STORE_ORDER = ['files', 'readstate', 'docs', 'grabbed', 'grabSessions', 'typingRuns', 'focusSessions', 'audiobook', 'audiobookManifest'];
// Stores the Maintenance tab can clear individually (with a friendly label).
const CLEARABLE = [
  { store: 'typingRuns', label: 'typing-run history' },
  { store: 'focusSessions', label: 'focus / look-away sessions' },
  { store: 'grabbed', label: 'grabbed (OCR) book cache' },
  { store: 'grabSessions', label: 'unfinished grab sessions' },
  { store: 'docs', label: 'document cache (rebuilt on reopen)' },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'backup', label: 'Backup & restore' },
  { id: 'cloud', label: 'Cloud sync' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'log', label: 'Diagnostic log' },
];

// Data management suite — storage overview, full backup/restore, cloud progress-sync, and
// maintenance (clear specific caches or wipe everything). Everything stays on your device.
export default function DataDialog({ onClose }) {
  const { state, updateGlobal, openDialog } = useApp();
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [counts, setCounts] = useState(null);

  const [exportJson, setExportJson] = useState('');
  const [exportInfo, setExportInfo] = useState(null);
  const [importText, setImportText] = useState('');
  const [pending, setPending] = useState(null); // staged import summary awaiting confirm
  const [wipeArm, setWipeArm] = useState(false);
  const [logEntries, setLogEntries] = useState(null);
  useEffect(() => { if (tab === 'log') getAppLog().then((l) => setLogEntries([...l].reverse())); }, [tab]);

  const sync = { provider: 'localFolder', driveClientId: '', lastSync: 0, autoBackupMinutes: 30, ...(state.global.sync || {}) };
  function patchSync(p) { updateGlobal({ sync: { ...sync, ...p } }); }
  const provider = getSyncProvider(sync.provider);
  const providerOk = provider && provider.supported() && (provider.available(sync) === true);
  const providerReason = provider && provider.available(sync);

  const refreshCounts = () => storeCounts().then(setCounts).catch(() => setCounts({}));
  useEffect(() => { refreshCounts(); }, []);
  const totalRecords = counts ? STORE_ORDER.reduce((a, k) => a + (counts[k] || 0), 0) : 0;

  // The signed-in Google account (live token's profile, or the last one we persisted for display).
  const account = (sync.provider === 'googleDrive' && (getDriveProfile() || sync.profile)) || null;

  // ── cloud ──
  // Two-way sync (pull-merge-push), then reload so merged settings/progress apply to open tabs.
  // Turning this on flips `auto`, which arms boot-pull + push-on-change (App.jsx).
  async function cloudSyncNow() {
    setBusy(true); setMsg('Syncing…');
    try {
      await syncWithProvider(sync.provider, sync);
      patchSync({ lastSync: Date.now(), auto: true, profile: getDriveProfile() || sync.profile });
      setMsg('Synced — reloading to apply…');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) { setBusy(false); setMsg('Sync failed: ' + (e?.message || e)); }
  }
  async function cloudBackup() {
    setBusy(true); setMsg('Backing up to your sync target…');
    try {
      const r = await backupToProvider(sync.provider, sync);
      patchSync({ lastSync: r.at, auto: true, profile: getDriveProfile() || sync.profile });
      setMsg(`Backed up to ${provider.label} (${Math.round(r.bytes / 1024)} KB).`);
    } catch (e) { setMsg('Sync backup failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function cloudRestore() {
    setBusy(true); setMsg('Restoring from your sync target…');
    try {
      const r = await restoreFromProvider(sync.provider, sync);
      patchSync({ auto: true, profile: getDriveProfile() || sync.profile });
      setMsg(`Merged ${r.merged} item(s) — reloading…`);
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) { setBusy(false); setMsg('Sync restore failed: ' + (e?.message || e)); }
  }
  // Sign in to Google without syncing yet — verifies OAuth and loads the account name/photo.
  async function connectGoogle() {
    setBusy(true); setMsg('Opening Google sign-in…');
    try {
      await provider.connect(sync);
      patchSync({ profile: getDriveProfile() });
      setMsg('Signed in to Google.');
    } catch (e) { setMsg('Google sign-in failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function signOutGoogle() {
    try { await provider.disconnect(); } catch { /* ignore */ }
    patchSync({ profile: null });
    setMsg('Signed out of Google on this device.');
  }

  // ── file backup / restore ──
  async function doExport() {
    setBusy(true); setMsg('Gathering your data…');
    try {
      const bundle = await exportAllData();
      const text = JSON.stringify(bundle);
      const s = exportSummary(bundle);
      setExportJson(text);
      setExportInfo({ total: s.total, kb: Math.max(1, Math.round(text.length / 1024)) });
      const name = `tachyread-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const res = await saveBlobToFile(new Blob([text], { type: 'application/json' }), name, [
        { description: 'Tachyread backup', accept: { 'application/json': ['.json'] } },
      ]);
      setMsg(res.canceled
        ? 'Save canceled — the backup JSON is below; you can copy it.'
        : `Backed up ${s.total} records (${Math.round(text.length / 1024)} KB)${res.method === 'download' ? ' to your downloads.' : ` to ${res.name}.`}`);
    } catch (e) { setMsg('Export failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function loadFromFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    setImportText(await readFileText(f));
    setMsg(`Loaded ${f.name} — review, then Restore.`);
  }
  function stageImport() {
    let bundle;
    try { bundle = JSON.parse(importText); } catch { setMsg('That is not valid backup JSON.'); return; }
    if (bundle.app !== 'tachyread') { setMsg('That JSON is not a Tachyread backup.'); return; }
    setPending(exportSummary(bundle));
    setMsg('');
  }
  async function confirmRestore() {
    setBusy(true); setMsg('Restoring…');
    try {
      const bundle = JSON.parse(importText);
      const r = await importAllData(bundle, { replace: true });
      setMsg(`Restored ${r.written} records — reloading…`);
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) { setBusy(false); setPending(null); setMsg('Import failed: ' + (e?.message || e)); }
  }

  // ── maintenance ──
  async function clearOne(store, label) {
    setBusy(true);
    try { await clearStore(store); await refreshCounts(); setMsg(`Cleared ${label}.`); }
    catch (e) { setMsg('Could not clear: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function wipeEverything() {
    setBusy(true); setMsg('Deleting all data…');
    try { await wipeAllData(); setMsg('All data deleted — reloading…'); setTimeout(() => window.location.reload(), 900); }
    catch (e) { setBusy(false); setMsg('Wipe failed: ' + (e?.message || e)); }
  }

  return (
    <Dialog title="Data management" onClose={onClose} width={660} buttons={<button onClick={onClose}>Close</button>}>
      <div className="rh-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`rh-tab${tab === t.id ? ' on' : ''}`} onClick={() => { setTab(t.id); setWipeArm(false); }}>{t.label}</button>
        ))}
      </div>
      {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}

      {tab === 'overview' && (
        <>
          <p className="settings-note" style={{ marginTop: 0 }}>
            Everything Tachyread stores lives in this browser, on this device. Below is what's here now.
          </p>
          <table className="history-table">
            <thead><tr><th>Stored data</th><th style={{ textAlign: 'right' }}>Records</th></tr></thead>
            <tbody>
              {STORE_ORDER.map((k) => (
                <tr key={k}><td>{STORE_LABELS[k] || k}</td><td style={{ textAlign: 'right' }}>{counts ? (counts[k] || 0).toLocaleString() : '…'}</td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{counts ? totalRecords.toLocaleString() : '…'}</strong></td></tr>
            </tbody>
          </table>
          <div className="data-row">
            <button className="toggle-on" onClick={cloudBackup} disabled={busy || !providerOk} title={providerOk ? '' : 'Set up a sync target on the Cloud sync tab'}>☁ Back up now</button>
            <button onClick={() => { setTab('backup'); doExport(); }} disabled={busy}>⬇ Export to file</button>
            {sync.lastSync > 0 && <span className="settings-note" style={{ margin: 0 }}>Last cloud sync: {new Date(sync.lastSync).toLocaleString()}</span>}
          </div>
        </>
      )}

      {tab === 'backup' && (
        <>
          <div className="field-section">Export a backup</div>
          <p className="settings-note">
            Saves <strong>everything</strong> — settings, library and reading progress, grabbed/OCR pages,
            typing &amp; focus history, and audiobook clips — to one JSON file. Nothing leaves your device.
          </p>
          <div className="data-row">
            <button className="toggle-on" onClick={doExport} disabled={busy}>⬇ Export to file</button>
            <button onClick={() => navigator.clipboard?.writeText(exportJson).then(() => setMsg('Backup JSON copied to clipboard.')).catch(() => {})} disabled={!exportJson}>Copy JSON</button>
            {exportInfo && <span className="settings-note" style={{ margin: 0 }}>{exportInfo.total} records · {exportInfo.kb} KB</span>}
          </div>
          {exportJson && <textarea className="data-json" readOnly value={exportJson} rows={5} onFocus={(e) => e.target.select()} />}

          <div className="field-section">Restore from a backup</div>
          <p className="settings-note" style={{ color: 'var(--danger, #c0392b)' }}>
            Restoring <strong>replaces</strong> all current Tachyread data on this device, then reloads.
          </p>
          <div className="data-row">
            <button onClick={loadFromFile} disabled={busy}>📂 Load from file…</button>
            {!pending ? (
              <button onClick={stageImport} disabled={busy || !importText.trim()}>Restore (replace all)…</button>
            ) : (
              <>
                <button className="grab-trash" onClick={confirmRestore} disabled={busy}>⚠ Confirm restore — replace {pending.total} records</button>
                <button onClick={() => setPending(null)} disabled={busy}>Cancel</button>
              </>
            )}
          </div>
          <textarea className="data-json" placeholder="…or paste backup JSON here" value={importText} onChange={(e) => { setImportText(e.target.value); setPending(null); }} rows={5} />
        </>
      )}

      {tab === 'cloud' && (
        <>
          <div className="field-section">Cloud sync (beta)</div>
          <p className="settings-note">
            Syncs your <strong>reading progress, tab settings, and application settings</strong> across your
            devices — reading position per file (keyed by content), your Default Tab Settings, and your
            preferences. Your files, document text, and grabbed pages <strong>never leave this device</strong>,
            and nothing goes through our servers: it's your browser talking to your own Google Drive (a private
            app-data folder) or a local folder your Drive / Dropbox / OneDrive desktop app already syncs.
          </p>
          <div className="field-row">
            <label>This device's name</label>
            <div>
              <input type="text" value={state.global.deviceName || ''} onChange={(e) => updateGlobal({ deviceName: e.target.value })} placeholder="e.g. Laptop, Phone" style={{ width: 200 }} />
              <span className="settings-note" style={{ margin: '0 0 0 8px' }}>Shown to your other devices on grabs made here.</span>
            </div>
          </div>
          <div className="field-row">
            <label>Sync target</label>
            <div>
              <select value={sync.provider} onChange={(e) => patchSync({ provider: e.target.value })}>
                {SYNC_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.supported()}>{p.label}{p.supported() ? '' : ' — unsupported here'}</option>
                ))}
              </select>
            </div>
          </div>
          {sync.provider === 'googleDrive' && account && (
            <div className="gsync-account">
              {account.picture
                ? <img className="gsync-pfp" src={account.picture} alt="" referrerPolicy="no-referrer" />
                : <span className="gsync-pfp gsync-pfp-fallback">{(account.name || '?').charAt(0).toUpperCase()}</span>}
              <div className="gsync-id">
                <div>Signed in as <strong>{account.name}</strong></div>
                {account.email && <div className="settings-note" style={{ margin: 0 }}>{account.email}</div>}
              </div>
              <button onClick={signOutGoogle} disabled={busy}>Sign out</button>
            </div>
          )}
          {sync.provider === 'googleDrive' && !account && driveOriginAllowed() && (
            <div className="data-row">
              <button className="toggle-on" onClick={connectGoogle} disabled={busy || !providerOk}> Sign in with Google</button>
              <span className="settings-note" style={{ margin: 0 }}>Connect your Google account, then Sync now. Data goes to a private Drive app-data folder only this app can see.</span>
            </div>
          )}
          {sync.provider === 'googleDrive' && (
            driveOriginAllowed() ? null : (
              <>
                <div className="field-row">
                  <label>Google OAuth client ID</label>
                  <div>
                    <input type="text" value={sync.driveClientId} onChange={(e) => patchSync({ driveClientId: e.target.value.trim() })} placeholder="xxxxx.apps.googleusercontent.com" style={{ width: '100%' }} />
                  </div>
                </div>
                <p className="settings-note">
                  This isn't the authorized deployment, so Drive needs your own OAuth client ID (kept on this device):
                  in Google Cloud Console create an <em>OAuth client ID → Web application</em>, add this page's origin to
                  the authorized JavaScript origins, enable the <em>Drive API</em>, and paste the client ID.
                </p>
              </>
            )
          )}
          <div className="data-row">
            <button className="toggle-on" onClick={cloudSyncNow} disabled={busy || !providerOk}>🔄 Sync now</button>
            <button onClick={cloudBackup} disabled={busy || !providerOk}>☁ Back up only</button>
            <button onClick={cloudRestore} disabled={busy || !providerOk}>⬇ Restore from sync</button>
            {!providerOk && providerReason && providerReason.reason && <span className="settings-note" style={{ margin: 0 }}>{providerReason.reason}</span>}
            {!providerOk && provider && !provider.supported() && <span className="settings-note" style={{ margin: 0 }}>Needs a Chromium browser.</span>}
            {sync.lastSync > 0 && <span className="settings-note" style={{ margin: 0 }}>Last sync: {new Date(sync.lastSync).toLocaleString()}</span>}
          </div>
          <div className="data-row">
            <label className="inline-check">
              <input type="checkbox" checked={!!sync.auto} onChange={(e) => patchSync({ auto: e.target.checked })} /> Keep synced automatically
            </label>
            <span className="settings-note" style={{ margin: 0 }}>Pull on launch and push shortly after each change (when the target is silently ready — never pops a sign-in on a timer).</span>
          </div>
        </>
      )}

      {tab === 'maintenance' && (
        <>
          <div className="field-section">Organize</div>
          <div className="data-row">
            <button onClick={() => openDialog({ kind: 'book-groups' })}>📚 Book groups…</button>
            <span className="settings-note" style={{ margin: 0 }}>Group editions of the same book so progress syncs across them.</span>
          </div>

          <div className="field-section">Clear specific data</div>
          <p className="settings-note">Free up space or reset a feature without touching the rest. This can't be undone.</p>
          {CLEARABLE.map((c) => (
            <div key={c.store} className="data-row">
              <button onClick={() => clearOne(c.store, c.label)} disabled={busy || !(counts && counts[c.store])}>Clear {c.label}</button>
              <span className="settings-note" style={{ margin: 0 }}>{counts ? `${(counts[c.store] || 0).toLocaleString()} record(s)` : ''}</span>
            </div>
          ))}

          <div className="field-section" style={{ color: '#c0392b' }}>Danger zone</div>
          <p className="settings-note" style={{ color: 'var(--danger, #c0392b)' }}>
            Deletes <strong>all</strong> Tachyread data on this device — library, progress, history, grabs,
            settings — then reloads. Export a backup first if you might want it back.
          </p>
          <div className="data-row">
            {!wipeArm ? (
              <button className="grab-trash" onClick={() => setWipeArm(true)} disabled={busy}>🗑 Delete everything…</button>
            ) : (
              <>
                <button className="grab-trash" onClick={wipeEverything} disabled={busy}>⚠ Confirm — delete everything ({totalRecords.toLocaleString()} records)</button>
                <button onClick={() => setWipeArm(false)} disabled={busy}>Cancel</button>
              </>
            )}
          </div>
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="field-section">Diagnostic log</div>
          <p className="settings-note">
            A local, capped record of errors and notable events (audiobook generation failures,
            translation errors, …) — the place to look when something “fails for unclear reasons”.
            Never leaves this device.
          </p>
          <div className="data-row">
            <button
              disabled={!logEntries?.length}
              onClick={async () => {
                const txt = [...(logEntries || [])].reverse().map((e) => `${new Date(e.ts).toISOString()} [${e.tag}] ${e.message}`).join('\n');
                await saveBlobToFile(new Blob([txt], { type: 'text/plain' }), 'tachyread-log.txt', [{ description: 'Log', accept: { 'text/plain': ['.txt'] } }]);
              }}
            >⬇ Download .txt</button>
            <button className="grab-trash" disabled={!logEntries?.length} onClick={async () => { await clearAppLog(); setLogEntries([]); }}>🗑 Clear log</button>
            <span className="settings-note" style={{ margin: 0 }}>{logEntries ? `${logEntries.length} entr${logEntries.length === 1 ? 'y' : 'ies'} (newest first, capped at 500)` : 'Loading…'}</span>
          </div>
          <div className="app-log">
            {(logEntries || []).map((e, i) => (
              <div key={i} className="app-log-row">
                <span className="app-log-ts">{new Date(e.ts).toLocaleString()}</span>
                <span className={`app-log-tag tag-${e.tag}`}>{e.tag}</span>
                <span className="app-log-msg">{e.message}</span>
              </div>
            ))}
            {logEntries && logEntries.length === 0 && <p className="settings-note">Log is empty — nothing has gone wrong lately. 🎉</p>}
          </div>
        </>
      )}
    </Dialog>
  );
}
