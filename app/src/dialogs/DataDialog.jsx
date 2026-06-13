import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { exportAllData, exportSummary, importAllData } from '../state/storage.js';
import { saveBlobToFile, pickFile, readFileText } from '../features/fileSystem.js';

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
    </Dialog>
  );
}
