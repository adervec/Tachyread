import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { exportAllData, exportSummary, importAllData } from '../state/storage.js';
import { saveBlobToFile, pickFile, readFileText } from '../features/fileSystem.js';
import { SYNC_PROVIDERS, getSyncProvider } from '../features/sync/syncProviders.js';
import { backupToProvider, restoreFromProvider } from '../features/sync/syncManager.js';

// Backup & data — export everything (settings, library, reading progress, grabbed pages, typing
// history, audiobook clips) to a single JSON file you control, and restore it on any device. Two
// paths for every step: a real file (native Save dialog where supported, else a download) and a
// copy/paste box, so it works in any browser. Everything stays on your device.
export default function DataDialog({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [exportJson, setExportJson] = useState('');
  const [exportInfo, setExportInfo] = useState(null);
  const [importText, setImportText] = useState('');
  const [pending, setPending] = useState(null); // staged import summary awaiting confirm

  const { state, updateGlobal } = useApp();
  const sync = { provider: 'localFolder', driveClientId: '', lastSync: 0, ...(state.global.sync || {}) };
  function patchSync(p) { updateGlobal({ sync: { ...sync, ...p } }); }
  const provider = getSyncProvider(sync.provider);
  const providerOk = provider && provider.supported() && (provider.available(sync) === true);
  const providerReason = provider && provider.available(sync);

  async function cloudBackup() {
    setBusy(true);
    setMsg('Backing up to your sync target…');
    try {
      const r = await backupToProvider(sync.provider, sync);
      patchSync({ lastSync: r.at });
      setMsg(`Backed up to ${provider.label} (${Math.round(r.bytes / 1024)} KB).`);
    } catch (e) {
      setMsg('Sync backup failed: ' + (e?.message || e));
    }
    setBusy(false);
  }
  async function cloudRestore() {
    setBusy(true);
    setMsg('Restoring from your sync target…');
    try {
      const r = await restoreFromProvider(sync.provider, sync);
      setMsg(`Restored ${r.written} records — reloading…`);
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setBusy(false);
      setMsg('Sync restore failed: ' + (e?.message || e));
    }
  }

  async function doExport() {
    setBusy(true);
    setMsg('Gathering your data…');
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
      setMsg(
        res.canceled
          ? 'Save canceled — the backup JSON is below; you can copy it.'
          : `Backed up ${s.total} records (${Math.round(text.length / 1024)} KB)${res.method === 'download' ? ' to your downloads.' : ` to ${res.name}.`}`,
      );
    } catch (e) {
      setMsg('Export failed: ' + (e?.message || e));
    }
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
    try {
      bundle = JSON.parse(importText);
    } catch {
      setMsg('That is not valid backup JSON.');
      return;
    }
    if (bundle.app !== 'tachyread') {
      setMsg('That JSON is not a Tachyread backup.');
      return;
    }
    setPending(exportSummary(bundle));
    setMsg('');
  }

  async function confirmRestore() {
    setBusy(true);
    setMsg('Restoring…');
    try {
      const bundle = JSON.parse(importText);
      const r = await importAllData(bundle, { replace: true });
      setMsg(`Restored ${r.written} records — reloading…`);
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setBusy(false);
      setPending(null);
      setMsg('Import failed: ' + (e?.message || e));
    }
  }

  return (
    <Dialog title="Backup &amp; data" onClose={onClose} width={640} buttons={<button onClick={onClose}>Close</button>}>
      {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}

      <div className="field-section">Export a backup</div>
      <p className="settings-note">
        Saves <strong>everything</strong> — settings, your library and reading progress, grabbed/OCR
        pages, typing history, and audiobook clips — to one JSON file. Nothing leaves your device.
      </p>
      <div className="data-row">
        <button className="toggle-on" onClick={doExport} disabled={busy}>⬇ Export to file</button>
        <button
          onClick={() => navigator.clipboard?.writeText(exportJson).then(() => setMsg('Backup JSON copied to clipboard.')).catch(() => {})}
          disabled={!exportJson}
        >
          Copy JSON
        </button>
        {exportInfo && <span className="settings-note" style={{ margin: 0 }}>{exportInfo.total} records · {exportInfo.kb} KB</span>}
      </div>
      {exportJson && (
        <textarea className="data-json" readOnly value={exportJson} rows={5} onFocus={(e) => e.target.select()} />
      )}

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
            <button className="grab-trash" onClick={confirmRestore} disabled={busy}>
              ⚠ Confirm restore — replace {pending.total} records
            </button>
            <button onClick={() => setPending(null)} disabled={busy}>Cancel</button>
          </>
        )}
      </div>
      <textarea
        className="data-json"
        placeholder="…or paste backup JSON here"
        value={importText}
        onChange={(e) => { setImportText(e.target.value); setPending(null); }}
        rows={5}
      />

      <div className="field-section">Cloud sync (beta)</div>
      <p className="settings-note">
        Sync the same backup to a folder or to Google Drive — useful across devices. Easiest with no
        accounts: pick a <strong>local folder</strong> that your Google Drive / Dropbox / OneDrive
        desktop app already syncs.
      </p>
      <div className="field-row">
        <label>Sync target</label>
        <div>
          <select value={sync.provider} onChange={(e) => patchSync({ provider: e.target.value })}>
            {SYNC_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.supported()}>
                {p.label}{p.supported() ? '' : ' — unsupported here'}
              </option>
            ))}
          </select>
        </div>
      </div>
      {sync.provider === 'googleDrive' && (
        <>
          <div className="field-row">
            <label>Google OAuth client ID</label>
            <div>
              <input
                type="text"
                value={sync.driveClientId}
                onChange={(e) => patchSync({ driveClientId: e.target.value.trim() })}
                placeholder="xxxxx.apps.googleusercontent.com"
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <p className="settings-note">
            Drive needs your own OAuth client ID (kept on this device). In Google Cloud Console: create
            an <em>OAuth client ID → Web application</em>, add this app's origin to the authorized
            JavaScript origins, enable the <em>Drive API</em>, and paste the client ID above. Backups
            go to a private app-data folder — only this app can see them.
          </p>
        </>
      )}
      <div className="data-row">
        <button className="toggle-on" onClick={cloudBackup} disabled={busy || !providerOk}>☁ Back up now</button>
        <button onClick={cloudRestore} disabled={busy || !providerOk}>⬇ Restore from sync</button>
        {!providerOk && providerReason && providerReason.reason && (
          <span className="settings-note" style={{ margin: 0 }}>{providerReason.reason}</span>
        )}
        {!providerOk && provider && !provider.supported() && (
          <span className="settings-note" style={{ margin: 0 }}>Needs a Chromium browser.</span>
        )}
        {sync.lastSync > 0 && (
          <span className="settings-note" style={{ margin: 0 }}>Last sync: {new Date(sync.lastSync).toLocaleString()}</span>
        )}
      </div>
      <div className="data-row">
        <label className="inline-check">
          <input type="checkbox" checked={!!sync.autoBackup} onChange={(e) => patchSync({ autoBackup: e.target.checked })} />
          Auto-back up every
        </label>
        <input
          type="number"
          min={5}
          max={1440}
          value={sync.autoBackupMinutes}
          disabled={!sync.autoBackup}
          onChange={(e) => patchSync({ autoBackupMinutes: Math.max(5, Number(e.target.value) || 30) })}
          style={{ width: 64 }}
        />
        <span className="settings-note" style={{ margin: 0 }}>minutes, and when you disconnect.</span>
      </div>
      <p className="settings-note">
        Auto-backup only runs when the target is silently ready (a local folder you've already granted)
        — it never pops a folder picker or a sign-in on a timer. Use <strong>☁ Sync</strong> in the menu
        bar for a one-click backup any time.
      </p>
    </Dialog>
  );
}
