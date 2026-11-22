import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { fmtDateTime } from '../features/dateFmt.js';
import { useApp } from '../state/AppContext.jsx';
import {
  exportSummary, importAllData, exportBackup, importBackupStream,
  storeCounts, clearStore, wipeAllData, getAppLog, clearAppLog, getSpeechLog,
} from '../state/storage.js';
import { saveBlobToFile, pickFile, readFileText, fsSaveSupported } from '../features/fileSystem.js';
import { blobLines, readBackup, isStreamableHeader } from '../features/backupStream.js';
import { SPEECH_LOG_FIELDS } from '../features/speechLog.js';
import { getSyncProvider, getDriveProfile } from '../features/sync/syncProviders.js';
import { syncWithProvider } from '../features/sync/syncManager.js';
import { getSyncStamps } from '../state/storage.js';
import { compressAllClips } from '../features/clipCodec.js';
import { t, fmtNum } from '../i18n.js';

// Where each kind of data goes and when it last moved — the honest answer to "is it syncing?".
// Book files and audio have no cloud copy at all today; saying so beats letting people assume.
function SyncStatus({ sync }) {
  const [stamps, setStamps] = useState({});
  useEffect(() => {
    getSyncStamps().then(setStamps).catch(() => {});
  }, [sync.lastSync, sync.lastLibrarySync]);
  const where = t('{cloud} › private app folder', { cloud: getSyncProvider()?.label || 'Google Drive' });
  const cell = (s, k) => (s ? (s[k] ? fmtDateTime(s[k]) : t('never')) : '—'); // null = this data never syncs
  const rows = [
    [t('Reading progress & tab settings'), where, stamps.progress || {}],
    [t('Trackyread library'), where, stamps.library || {}],
    [t('Book files'), t('This device only — open each book on every device (or keep the files in a synced folder)'), null],
    [t('Audiobook audio (clips, synced audiobooks)'), t('This device only — no cloud copy yet'), null],
  ];
  return (
    <table className="history-table">
      <thead><tr><th>{t('Data')}</th><th>{t('Where it goes')}</th><th>{t('Last pushed')}</th><th>{t('Last pulled')}</th></tr></thead>
      <tbody>
        {rows.map(([what, to, s]) => (
          <tr key={what}>
            <td>{what}</td><td>{to}</td><td>{cell(s, 'pushedAt')}</td>
            <td>{cell(s, 'pulledAt')}{s?.pulledAt && s.pulledFrom ? <> {t('— written by {device}', { device: s.pulledFrom })}</> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Friendly names + display order for the object stores shown in the Overview.
const STORE_LABELS = {
  files: t('Library & reading progress'), readstate: t('Reading masks'), docs: t('Document cache'),
  grabbed: t('Grabbed (OCR) books'), grabSessions: t('Unfinished grabs'), typingRuns: t('Typing runs'),
  focusSessions: t('Focus sessions'), audiobook: t('Audiobook clips'), audiobookManifest: t('Audiobook index'),
  global: t('Settings & session'), fsHandles: t('Saved folder handles'),
};
const fmtMB = (chars) => (chars >= 1048576 ? `${fmtNum(chars / 1048576, chars >= 1073741824 ? 0 : 1, chars >= 1073741824 ? 0 : 1)} MB` : `${Math.max(1, Math.round(chars / 1024))} KB`);
// Buffer many small writes into ~1 MB pieces (the file writer is slow per call).
function bufferedWriter(sink) {
  let buf = '';
  return {
    write: async (str) => { buf += str; if (buf.length >= 1 << 20) { const b = buf; buf = ''; await sink(b); } },
    flush: async () => { if (buf) { const b = buf; buf = ''; await sink(b); } },
  };
}
const STORE_ORDER = ['files', 'readstate', 'docs', 'grabbed', 'grabSessions', 'typingRuns', 'focusSessions', 'audiobook', 'audiobookManifest'];
// Stores the Maintenance tab can clear individually (button text + the message once it is done).
const CLEARABLE = [
  { store: 'typingRuns', label: t('Clear typing-run history'), done: t('Cleared typing-run history.') },
  { store: 'focusSessions', label: t('Clear focus / look-away sessions'), done: t('Cleared focus / look-away sessions.') },
  { store: 'grabbed', label: t('Clear grabbed (OCR) book cache'), done: t('Cleared grabbed (OCR) book cache.') },
  { store: 'grabSessions', label: t('Clear unfinished grab sessions'), done: t('Cleared unfinished grab sessions.') },
  { store: 'docs', label: t('Clear document cache (rebuilt on reopen)'), done: t('Cleared document cache.') },
];

const TABS = [
  { id: 'overview', label: t('Overview') },
  { id: 'backup', label: t('Backup & restore') },
  { id: 'cloud', label: t('Cloud sync') },
  { id: 'maintenance', label: t('Maintenance') },
  { id: 'log', label: t('Diagnostic log') },
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

  const sync = { provider: 'googleDrive', lastSync: 0, autoBackupMinutes: 30, ...(state.global.sync || {}) };
  function patchSync(p) { updateGlobal({ sync: { ...sync, ...p } }); }
  const provider = getSyncProvider(sync.provider);
  const providerOk = provider && provider.supported() && (provider.available(sync) === true);
  const providerReason = provider && provider.available(sync);

  const refreshCounts = () => storeCounts().then(setCounts).catch(() => setCounts({}));
  useEffect(() => { refreshCounts(); }, []);
  const totalRecords = counts ? STORE_ORDER.reduce((a, k) => a + (counts[k] || 0), 0) : 0;

  // The signed-in Google account (live token's profile, or the last one we persisted for display).
  const account = getDriveProfile() || sync.profile || null;


  // Re-encode stored WAV clips to AAC (clipCodec.js) — the one-off catch-up; new clips get it on save.
  async function compressClips() {
    setBusy(true); setMsg(t('Compressing clips…'));
    try {
      const r = await compressAllClips((p) => setMsg(t('Compressing clip {done}/{total}… {before} → {after} so far', { done: p.done, total: p.total, before: fmtMB(p.before), after: fmtMB(p.after) })));
      setMsg(r.changed
        ? t.n('Compressed {changed} of {n} clip: {before} → {after}.', 'Compressed {changed} of {n} clips: {before} → {after}.', r.total, { changed: r.changed, before: fmtMB(r.before), after: fmtMB(r.after) })
        : typeof AudioEncoder === 'undefined'
          ? t.n('Nothing to compress — {n} clip is already compact (this browser has no audio encoder).', 'Nothing to compress — {n} clips are already compact (this browser has no audio encoder).', r.total)
          : t.n('Nothing to compress — {n} clip is already compact.', 'Nothing to compress — {n} clips are already compact.', r.total));
    } catch (e) { setMsg(t('Compression failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }

  // ── cloud ──
  // Two-way sync (pull-merge-push), then reload so merged settings/progress apply to open tabs.
  // Turning this on flips `auto`, which arms boot-pull + push-on-change (App.jsx).
  async function cloudSyncNow() {
    setBusy(true); setMsg(t('Syncing…'));
    try {
      await syncWithProvider(sync.provider, sync);
      patchSync({ lastSync: Date.now(), auto: true, profile: getDriveProfile() || sync.profile });
      setMsg(t('Synced — reloading to apply…'));
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) { setBusy(false); setMsg(t('Sync failed: {error}', { error: e?.message || e })); }
  }
  // Sign in to Google without syncing yet — verifies OAuth and loads the account name/photo.
  async function connectGoogle() {
    setBusy(true); setMsg(t('Opening Google sign-in…'));
    try {
      await provider.connect(sync);
      patchSync({ profile: getDriveProfile() });
      setMsg(t('Signed in to Google.'));
    } catch (e) { setMsg(t('Google sign-in failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }
  async function signOutGoogle() {
    try { await provider.disconnect(); } catch { /* ignore */ }
    patchSync({ profile: null });
    setMsg(t('Signed out of Google on this device.'));
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
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: t('Tachyread backup'), accept: { 'application/json': ['.json'] } }] });
      } catch (e) { if (e?.name === 'AbortError') { setMsg(t('Save canceled.')); return; } }
    }
    setBusy(true); setMsg(t('Writing your backup…')); setExportInfo(null);
    try {
      let sizes, where;
      if (handle) {
        const w = await handle.createWritable();
        const out = bufferedWriter((b) => w.write(b));
        try { sizes = await exportBackup(out.write, { includeAudio: withAudio }); await out.flush(); await w.close(); }
        catch (e) { try { await w.abort(); } catch { /* */ } throw e; }
        where = handle.name;
      } else {
        const parts = [];
        const out = bufferedWriter(async (b) => { parts.push(b); });
        sizes = await exportBackup(out.write, { includeAudio: withAudio });
        await out.flush();
        const url = URL.createObjectURL(new Blob(parts, { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        where = '';
      }
      const total = Object.values(sizes).reduce((sum, x) => sum + x.count, 0);
      const bytes = Object.values(sizes).reduce((sum, x) => sum + x.bytes, 0);
      setExportInfo({ total, bytes, sizes });
      const vals = { count: fmtNum(total), size: fmtMB(bytes), file: where };
      setMsg(where
        ? t.n('Backed up {count} record ({size}) to {file}.', 'Backed up {count} records ({size}) to {file}.', total, vals)
        : t.n('Backed up {count} record ({size}) to your downloads.', 'Backed up {count} records ({size}) to your downloads.', total, vals));
    } catch (e) { setMsg(t('Export failed: {error}', { error: e?.message || e })); }
    setBusy(false);
  }
  // A streamable backup is restored straight from the file (never read into one string); an older
  // single-line backup still goes through the text box as before.
  async function loadFromFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    const head = await f.slice(0, 4 << 20).text();
    if (isStreamableHeader(head.split('\n')[0])) {
      setBusy(true); setMsg(t('Reading {file}…', { file: f.name })); setImportText(''); setPending(null);
      try {
        const counts = {};
        let total = 0;
        await readBackup(blobLines(f), { onRecord: async (store) => { counts[store] = (counts[store] || 0) + 1; total++; } });
        setImportFile(f);
        setPending({ total, counts });
        setMsg(t('Loaded {file} ({size}) — confirm to restore.', { file: f.name, size: fmtMB(f.size) }) + (counts.audiobook == null ? ' ' + t('It has no audiobook audio, so the audio on this device is kept.') : ''));
      } catch (e) { setMsg(t('That file is not a readable Tachyread backup: {error}', { error: e?.message || e })); }
      setBusy(false);
      return;
    }
    setImportFile(null);
    setImportText(await readFileText(f));
    setMsg(t('Loaded {file} — review, then Restore.', { file: f.name }));
  }
  function stageImport() {
    let bundle;
    try { bundle = JSON.parse(importText); } catch { setMsg(t('That is not valid backup JSON.')); return; }
    if (bundle.app !== 'tachyread') { setMsg(t('That JSON is not a Tachyread backup.')); return; }
    setPending(exportSummary(bundle));
    setMsg('');
  }
  async function confirmRestore() {
    setBusy(true); setMsg(t('Restoring…'));
    try {
      const r = importFile
        ? await importBackupStream(blobLines(importFile), { replace: true, onProgress: (n) => setMsg(t.n('Restoring… {count} record', 'Restoring… {count} records', n, { count: fmtNum(n) })) })
        : await importAllData(JSON.parse(importText), { replace: true });
      setMsg(t.n('Restored {n} record — reloading…', 'Restored {n} records — reloading…', r.written));
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) { setBusy(false); setPending(null); setMsg(t('Import failed: {error}', { error: e?.message || e })); }
  }

  // ── maintenance ──
  async function clearOne(store, done) {
    setBusy(true);
    try { await clearStore(store); await refreshCounts(); setMsg(done); }
    catch (e) { setMsg(t('Could not clear: {error}', { error: e?.message || e })); }
    setBusy(false);
  }
  async function wipeEverything() {
    setBusy(true); setMsg(t('Deleting all data…'));
    try { await wipeAllData(); setMsg(t('All data deleted — reloading…')); setTimeout(() => window.location.reload(), 900); }
    catch (e) { setBusy(false); setMsg(t('Wipe failed: {error}', { error: e?.message || e })); }
  }

  return (
    <Dialog title={t('Data management')} onClose={onClose} width={660} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <div className="rh-tabs">
        {TABS.map((tb) => (
          <button key={tb.id} className={`rh-tab${tab === tb.id ? ' on' : ''}`} onClick={() => { setTab(tb.id); setWipeArm(false); }}>{tb.label}</button>
        ))}
      </div>
      {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}

      {tab === 'overview' && (
        <>
          <p className="settings-note" style={{ marginTop: 0 }}>
            {t('Everything Tachyread stores lives in this browser, on this device.')}{' '}
            {t('Below is what’s here now.')}
          </p>
          <table className="history-table">
            <thead><tr><th>{t('Stored data')}</th><th style={{ textAlign: 'end' }}>{t('Records')}</th></tr></thead>
            <tbody>
              {STORE_ORDER.map((k) => (
                <tr key={k}><td>{STORE_LABELS[k] || k}</td><td style={{ textAlign: 'end' }}>{counts ? fmtNum(counts[k] || 0) : '…'}</td></tr>
              ))}
              <tr><td><strong>{t('Total')}</strong></td><td style={{ textAlign: 'end' }}><strong>{counts ? fmtNum(totalRecords) : '…'}</strong></td></tr>
            </tbody>
          </table>
          <div className="data-row">
            <button className="toggle-on" onClick={cloudSyncNow} disabled={busy || !providerOk} title={providerOk ? '' : t('Set up a sync target on the Cloud sync tab')}>☁ {t('Back up now')}</button>
            <button onClick={() => { setTab('backup'); doExport(); }} disabled={busy}>⬇ {t('Export to file')}</button>
            {sync.lastSync > 0 && <span className="settings-note" style={{ margin: 0 }}>{t('Last cloud sync: {date}', { date: fmtDateTime(sync.lastSync) })}</span>}
          </div>
        </>
      )}

      {tab === 'backup' && (
        <>
          <div className="field-section">{t('Export a backup')}</div>
          <p className="settings-note">
            {t('Saves everything — settings, library and reading progress, grabbed/OCR pages, typing & focus history, and audiobook clips — to one JSON file.')}{' '}
            {t('Nothing leaves your device.')}
          </p>
          <div className="data-row">
            <button className="toggle-on" onClick={doExport} disabled={busy}>⬇ {t('Export to file')}</button>
            <label className="settings-note" style={{ margin: 0 }} title={t('Audiobook clips are usually most of a backup’s size. Without them the file is small; restoring it leaves the audio on the device you restore to untouched.')}>
              <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} disabled={busy} /> {t('Include audiobook audio')}
            </label>
          </div>
          {exportInfo && (
            <p className="settings-note data-sizes" title={t('Approximate size of each part of the backup')}>
              {t('What’s in it: {list}', { list: Object.entries(exportInfo.sizes).filter(([, x]) => x.count).sort((a, b) => b[1].bytes - a[1].bytes)
                .map(([k, x]) => `${STORE_LABELS[k] || k} ${fmtMB(x.bytes)} (${fmtNum(x.count)})`).join(' · ') })}
            </p>
          )}

          <div className="field-section">{t('Restore from a backup')}</div>
          <p className="settings-note" style={{ color: 'var(--danger, #c0392b)' }}>
            {t('Restoring replaces all current Tachyread data on this device, then reloads.')}
          </p>
          <div className="data-row">
            <button onClick={loadFromFile} disabled={busy}>📂 {t('Load from file…')}</button>
            {!pending ? (
              <button onClick={stageImport} disabled={busy || !importText.trim()}>{t('Restore (replace all)…')}</button>
            ) : (
              <>
                <button className="grab-trash" onClick={confirmRestore} disabled={busy}>⚠ {t.n('Confirm restore — replace {n} record', 'Confirm restore — replace {n} records', pending.total)}</button>
                <button onClick={() => { setPending(null); setImportFile(null); }} disabled={busy}>{t('Cancel')}</button>
              </>
            )}
          </div>
          {!importFile && <textarea className="data-json" placeholder={t('…or paste backup JSON here')} value={importText} onChange={(e) => { setImportText(e.target.value); setPending(null); }} rows={5} />}
        </>
      )}

      {tab === 'cloud' && (
        <>
          <div className="field-section">{t('Cloud sync (beta)')}</div>
          <p className="settings-note">
            {t('Syncs your reading progress and tab settings across your devices — reading position per file (keyed by content), your Default Tab Settings, and per-file display — plus the Trackyread library.')}{' '}
            {t('Your application & biometric settings are device-specific and stay put (they’re tuned to each device’s screen, camera and habits).')}{' '}
            {t('Tabs also show a small 🖥 badge when the same file is open on another synced device (as of the last sync).')}{' '}
            <strong>{t('Book files, document text, grabbed pages and audiobook audio never leave this device — there is no cloud copy of them.')}</strong>{' '}
            {t('Nothing goes through our servers: it’s your browser talking to your own cloud’s private app folder, the one every app here shares (chosen once, in the hub).')}{' '}
            {t('Each sync reads the cloud copy first and merges it item by item, so a device that was offline never overwrites newer reading from another.')}
          </p>
          <SyncStatus sync={sync} />
          <div className="field-row">
            <label>{t('This device’s name')}</label>
            <div>
              <input type="text" value={state.global.deviceName || ''} onChange={(e) => updateGlobal({ deviceName: e.target.value })} placeholder={t('e.g. Laptop, Phone')} style={{ width: 200 }} />
              <span className="settings-note" style={{ margin: '0 0 0 8px' }}>{t('Shown to your other devices on grabs made here.')}</span>
            </div>
          </div>
          {account && (
            <div className="gsync-account">
              {account.picture
                ? <img className="gsync-pfp" src={account.picture} alt="" referrerPolicy="no-referrer" />
                : <span className="gsync-pfp gsync-pfp-fallback">{(account.name || '?').charAt(0).toUpperCase()}</span>}
              <div className="gsync-id">
                <div>{t('Signed in as {name}', { name: account.name })}</div>
                {account.email && <div className="settings-note" style={{ margin: 0 }}>{account.email}</div>}
              </div>
              <button onClick={signOutGoogle} disabled={busy}>{t('Sign out')}</button>
            </div>
          )}
          {!account && providerOk && (
            <div className="data-row">
              <button className="toggle-on" onClick={connectGoogle} disabled={busy || !providerOk}> {t('Sign in with Google')}</button>
              <span className="settings-note" style={{ margin: 0 }}>{t('Connect your Google account, then Sync now.')} {t('Data goes to a private Drive app-data folder only this app can see.')}</span>
            </div>
          )}
          <div className="data-row">
            <button className="toggle-on" onClick={cloudSyncNow} disabled={busy || !providerOk}>🔄 {t('Sync now')}</button>
            {!providerOk && providerReason && providerReason.reason && <span className="settings-note" style={{ margin: 0 }}>{providerReason.reason}</span>}
            {!providerOk && provider && !provider.supported() && <span className="settings-note" style={{ margin: 0 }}>{t('Needs a Chromium browser.')}</span>}
            {sync.lastSync > 0 && <span className="settings-note" style={{ margin: 0 }}>{t('Last sync: {date}', { date: fmtDateTime(sync.lastSync) })}</span>}
          </div>
          <div className="data-row">
            <label className="inline-check">
              <input type="checkbox" checked={!!sync.auto} onChange={(e) => patchSync({ auto: e.target.checked })} /> {t('Keep synced automatically')}
            </label>
            <span className="settings-note" style={{ margin: 0 }}>{t('Pull on launch and push shortly after each change (when the target is silently ready — never pops a sign-in on a timer).')}</span>
          </div>
        </>
      )}

      {tab === 'maintenance' && (
        <>
          <div className="field-section">{t('Organize')}</div>
          <div className="data-row">
            <button onClick={() => openDialog({ kind: 'book-groups' })}>📚 {t('Book groups…')}</button>
            <span className="settings-note" style={{ margin: 0 }}>{t('Group editions of the same book so progress syncs across them.')}</span>
          </div>

          <div className="field-section">{t('Audiobook clips')}</div>
          <div className="data-row">
            <button onClick={compressClips} disabled={busy || !(counts && counts.audiobook)}>🗜 {t('Compress audiobook clips')}</button>
            <span className="settings-note" style={{ margin: 0 }}>{t('Re-encodes WAV clips (Piper, Kokoro, mic takes) to Opus — 15–30× smaller, same playback.')} {t('New clips are compressed as they are made.')}</span>
          </div>

          <div className="field-section">{t('Clear specific data')}</div>
          <p className="settings-note">{t('Free up space or reset a feature without touching the rest.')} {t('This can’t be undone.')}</p>
          {CLEARABLE.map((c) => (
            <div key={c.store} className="data-row">
              <button onClick={() => clearOne(c.store, c.done)} disabled={busy || !(counts && counts[c.store])}>{c.label}</button>
              <span className="settings-note" style={{ margin: 0 }}>{counts ? t.n('{count} record', '{count} records', counts[c.store] || 0, { count: fmtNum(counts[c.store] || 0) }) : ''}</span>
            </div>
          ))}

          <div className="field-section" style={{ color: '#c0392b' }}>{t('Danger zone')}</div>
          <p className="settings-note" style={{ color: 'var(--danger, #c0392b)' }}>
            {t('Deletes all Tachyread data on this device — library, progress, history, grabs, settings — then reloads.')}{' '}
            {t('Export a backup first if you might want it back.')}{' '}
            {t('Only Tachyread’s own data goes: the other apps on this site keep theirs.')}{' '}
            <strong>{t('Your synced copy (Google Drive app folder or the Tachyread folder) is not touched — remove it there if you want it gone.')}</strong>
          </p>
          <div className="data-row">
            {!wipeArm ? (
              <button className="grab-trash" onClick={() => setWipeArm(true)} disabled={busy}>🗑 {t('Delete everything…')}</button>
            ) : (
              <>
                <button className="grab-trash" onClick={wipeEverything} disabled={busy}>⚠ {t.n('Confirm — delete everything ({count} record)', 'Confirm — delete everything ({count} records)', totalRecords, { count: fmtNum(totalRecords) })}</button>
                <button onClick={() => setWipeArm(false)} disabled={busy}>{t('Cancel')}</button>
              </>
            )}
          </div>
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="field-section">{t('Diagnostic log')}</div>
          <p className="settings-note">
            {t('A local, capped record of errors and notable events (audiobook generation failures, translation errors, …) — the place to look when something “fails for unclear reasons”.')}{' '}
            {t('Never leaves this device.')}
          </p>
          <div className="data-row">
            <button
              disabled={!logEntries?.length}
              onClick={async () => {
                const txt = [...(logEntries || [])].reverse().map((e) => `${new Date(e.ts).toISOString()} [${e.tag}] ${e.message}`).join('\n');
                await saveBlobToFile(new Blob([txt], { type: 'text/plain' }), 'tachyread-log.txt', [{ description: t('Log'), accept: { 'text/plain': ['.txt'] } }]);
              }}
            >⬇ {t('Download {ext}', { ext: '.txt' })}</button>
            <button className="grab-trash" disabled={!logEntries?.length} onClick={async () => { await clearAppLog(); setLogEntries([]); }}>🗑 {t('Clear log')}</button>
            <span className="settings-note" style={{ margin: 0 }}>{logEntries ? t.n('{n} entry (newest first, capped at {max})', '{n} entries (newest first, capped at {max})', logEntries.length, { max: 500 }) : t('Loading…')}</span>
          </div>
          <div className="field-section">{t('Speech log')}</div>
          <p className="settings-note">
            {t('One compact record per reading-aloud session: words advanced, how exactly they were read, average voice scores and a per-minute trend (no audio, no transcripts).')}{' '}
            {t('Field meanings are in the file’s {field} entry.', { field: 'fields' })}{' '}
            {t('Kept on this device (last {max} sessions) and in full backups.', { max: 2000 })}
          </p>
          <div className="data-row">
            <button onClick={async () => {
              const sessions = await getSpeechLog();
              if (!sessions.length) { setMsg(t('No reading-aloud sessions logged yet.')); return; }
              const body = JSON.stringify({ app: 'tachyread', kind: 'speechLog', v: 1, fields: SPEECH_LOG_FIELDS, sessions });
              await saveBlobToFile(new Blob([body], { type: 'application/json' }), 'tachyread-speech-log.json', [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]);
            }}>⬇ {t('Download speech log ({ext})', { ext: '.json' })}</button>
          </div>
          <div className="app-log">
            {(logEntries || []).map((e, i) => (
              <div key={i} className="app-log-row">
                <span className="app-log-ts">{fmtDateTime(e.ts, true)}</span>
                <span className={`app-log-tag tag-${e.tag}`}>{e.tag}</span>
                <span className="app-log-msg">{e.message}</span>
              </div>
            ))}
            {logEntries && logEntries.length === 0 && <p className="settings-note">{t('Log is empty — nothing has gone wrong lately.')} 🎉</p>}
          </div>
        </>
      )}
    </Dialog>
  );
}
