import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { fmtDateTime } from '../features/dateFmt.js';
import { useApp } from '../state/AppContext.jsx';
import {
  exportSummary, importAllData, exportBackup, importBackupStream,
  storeCounts, clearStore, wipeAllData, getAppLog, clearAppLog,
} from '../state/storage.js';
import { saveBlobToFile, pickFile, readFileText, fsSaveSupported } from '../features/fileSystem.js';
import { blobLines, readBackup, isStreamableHeader } from '../features/backupStream.js';
import { SYNC_PROVIDERS, getSyncProvider, driveOriginAllowed, getDriveProfile } from '../features/sync/syncProviders.js';
import { backupToProvider, restoreFromProvider, syncWithProvider } from '../features/sync/syncManager.js';

// Friendly names + display order for the object stores shown in the Overview.
const STORE_LABELS = {
  files: 'Library & reading progress', readstate: 'Reading masks', docs: 'Document cache',
  grabbed: 'Grabbed (OCR) books', grabSessions: 'Unfinished grabs', typingRuns: 'Typing runs',
  focusSessions: 'Focus sessions', audiobook: 'Audiobook clips', audiobookManifest: 'Audiobook index',
  global: 'Settings & session', fsHandles: 'Saved folder handles',
};
const fmtMB = (chars) => (chars >= 1048576 ? `${(chars / 1048576).toFixed(chars >= 1073741824 ? 0 : 1)} MB` : `${Math.max(1, Math.round(chars / 1024))} KB`);
// Buffer many small writes into ~1 MB pieces (the file writer is slow per call).
function bufferedWriter(sink) {
  let buf = '';
  return {
    write: async (str) => { buf += str; if (buf.length >= 1 << 20) { const b = buf; buf = ''; await sink(b); } },
    flush: async () => { if (buf) { const b = buf; buf = ''; await sink(b); } },
  };
}
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

  const [exportInfo, setExportInfo] = useState(null);
  const [withAudio, setWithAudio] = useState(true);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState(null); // a streamable backup file, restored record by record
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
  // Written one record at a time — straight to the file where the browser allows it (no copy of
  // the whole backup in memory), otherwise gathered as pieces into a Blob and downloaded. Either
  // way no single string ever holds the whole backup, which is what used to fail on big libraries.
  async function doExport() {
    const name = `tachyread-backup-${new Date().toISOString().slice(0, 10)}${withAudio ? '' : '-no-audio'}.json`;
    let handle = null;
    if (fsSaveSupported()) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Tachyread backup', accept: { 'application/json': ['.json'] } }] });
      } catch (e) { if (e?.name === 'AbortError') { setMsg('Save canceled.'); return; } }
    }
    setBusy(true); setMsg('Writing your backup…'); setExportInfo(null);
    try {
      let sizes, how;
      if (handle) {
        const w = await handle.createWritable();
        const out = bufferedWriter((b) => w.write(b));
        try { sizes = await exportBackup(out.write, { includeAudio: withAudio }); await out.flush(); await w.close(); }
        catch (e) { try { await w.abort(); } catch { /* */ } throw e; }
        how = ` to ${handle.name}`;
      } else {
        const parts = [];
        const out = bufferedWriter(async (b) => { parts.push(b); });
        sizes = await exportBackup(out.write, { includeAudio: withAudio });
        await out.flush();
        const url = URL.createObjectURL(new Blob(parts, { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        how = ' to your downloads';
      }
      const total = Object.values(sizes).reduce((t, x) => t + x.count, 0);
      const bytes = Object.values(sizes).reduce((t, x) => t + x.bytes, 0);
      setExportInfo({ total, bytes, sizes });
      setMsg(`Backed up ${total.toLocaleString()} records (${fmtMB(bytes)})${how}.`);
    } catch (e) { setMsg('Export failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  // A streamable backup is restored straight from the file (never read into one string); an older
  // single-line backup still goes through the text box as before.
  async function loadFromFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    const head = await f.slice(0, 4 << 20).text();
    if (isStreamableHeader(head.split('\n')[0])) {
      setBusy(true); setMsg(`Reading ${f.name}…`); setImportText(''); setPending(null);
      try {
        const counts = {};
        let total = 0;
        await readBackup(blobLines(f), { onRecord: async (store) => { counts[store] = (counts[store] || 0) + 1; total++; } });
        setImportFile(f);
        setPending({ total, counts });
        setMsg(`Loaded ${f.name} (${fmtMB(f.size)}) — confirm to restore.${counts.audiobook == null ? ' It has no audiobook audio, so the audio on this device is kept.' : ''}`);
      } catch (e) { setMsg('That file is not a readable Tachyread backup: ' + (e?.message || e)); }
      setBusy(false);
      return;
    }
    setImportFile(null);
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
      const r = importFile
        ? await importBackupStream(blobLines(importFile), { replace: true, onProgress: (n) => setMsg(`Restoring… ${n.toLocaleString()} records`) })
        : await importAllData(JSON.parse(importText), { replace: true });
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
            {sync.lastSync > 0 && <span className="settings-note" style={{ margin: 0 }}>Last cloud sync: {fmtDateTime(sync.lastSync)}</span>}
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
            <label className="settings-note" style={{ margin: 0 }} title="Audiobook clips are usually most of a backup's size. Without them the file is small; restoring it leaves the audio on the device you restore to untouched.">
              <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} disabled={busy} /> Include audiobook audio
            </label>
          </div>
          {exportInfo && (
            <p className="settings-note data-sizes" title="Approximate size of each part of the backup">
              What's in it: {Object.entries(exportInfo.sizes).filter(([, x]) => x.count).sort((a, b) => b[1].bytes - a[1].bytes)
                .map(([k, x]) => `${STORE_LABELS[k] || k} ${fmtMB(x.bytes)} (${x.count.toLocaleString()})`).join(' · ')}
            </p>
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
                <button className="grab-trash" onClick={confirmRestore} disabled={busy}>⚠ Confirm restore — replace {pending.total} records</button>
                <button onClick={() => { setPending(null); setImportFile(null); }} disabled={busy}>Cancel</button>
              </>
            )}
          </div>
          {!importFile && <textarea className="data-json" placeholder="…or paste backup JSON here" value={importText} onChange={(e) => { setImportText(e.target.value); setPending(null); }} rows={5} />}
        </>
      )}

      {tab === 'cloud' && (
        <>
          <div className="field-section">Cloud sync (beta)</div>
          <p className="settings-note">
            Syncs your <strong>reading progress and tab settings</strong> across your devices — reading
            position per file (keyed by content), your Default Tab Settings, and per-file display. Your
            <strong> application &amp; biometric settings are device-specific</strong> and stay put (they’re
            tuned to each device’s screen, camera and habits). Tabs also show a small 🖥 badge when the
            same file is open on another synced device (as of the last sync). Your files, document text,
            and grabbed pages <strong>never leave this device</strong>,
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
            {sync.lastSync > 0 && <span className="settings-note" style={{ margin: 0 }}>Last sync: {fmtDateTime(sync.lastSync)}</span>}
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
                <span className="app-log-ts">{fmtDateTime(e.ts, true)}</span>
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
