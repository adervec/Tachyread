import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { alignTranscript, syncCoverage } from '../features/audioSync.js';
import { saveAudioSync, getAudioSync, deleteAudioSync } from '../state/storage.js';

// Audio → Sync My Audiobook: pick the audio files of this book's audiobook (MP3 / M4B / M4A / WAV…),
// in order. Whisper transcribes them on this device with word timings, the words are aligned to the
// book, and read-aloud (offline voice) then plays YOUR narration with the reading position following
// it. It's slow — roughly the length of the audio on a typical laptop with the fast model — so leave it
// running. Nothing is uploaded; only the model downloads (once).
const WINDOW_S = 300; // 5-minute pieces → the worker (keeps each message small)
const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export default function AudioSyncDialog({ tab, onClose }) {
  const { state, updateGlobal } = useApp();
  const doc = tab.doc;
  const cs = doc.contentChecksum;
  const en = (state.global.language || 'en').startsWith('en');
  const [files, setFiles] = useState([]);
  const [quality, setQuality] = useState('tiny');
  const [prog, setProg] = useState(null); // { label, done, total, eta }
  const [msg, setMsg] = useState('');
  const [existing, setExisting] = useState(null);
  const abort = useRef(false);
  const worker = useRef(null);
  useEffect(() => { getAudioSync(cs).then(setExisting).catch(() => {}); }, [cs]);
  useEffect(() => () => worker.current?.terminate(), []);

  const model = `onnx-community/whisper-${quality}${en ? '.en' : ''}_timestamped`;
  function transcribe(pcm, offsetMs) {
    if (!worker.current) {
      worker.current = new Worker(new URL('../features/whisperWorker.js', import.meta.url), { type: 'module' });
    }
    return new Promise((resolve, reject) => {
      const w = worker.current;
      const id = Math.random();
      w.onmessage = (e) => {
        if (e.data?.progress != null) { setProg({ label: `Downloading the speech model (once)… ${e.data.progress}%`, done: 0, total: 0 }); return; }
        if (e.data?.id !== id) return;
        if (e.data.ok) resolve(e.data.words); else reject(new Error(e.data.error));
      };
      w.postMessage({ id, model, pcm, offsetMs }, [pcm.buffer]);
    });
  }

  async function run() {
    abort.current = false;
    setMsg('');
    const ordered = [...files].sort(naturalSort);
    const decoded = [];
    let anchors = [], from = 0, doneS = 0;
    const t0 = Date.now();
    try {
      // decode everything first so the total (and the ETA) is known
      for (const f of ordered) {
        setProg({ label: `Reading “${f.name}”…`, done: 0, total: 1 });
        const ctx = new OfflineAudioContext(1, 16000, 16000); // decodes + resamples to 16 kHz
        const buf = await ctx.decodeAudioData(await f.arrayBuffer());
        decoded.push(buf);
      }
      const totalS = decoded.reduce((a, b) => a + b.duration, 0);
      for (let fi = 0; fi < decoded.length; fi++) {
        const buf = decoded[fi];
        const mono = buf.numberOfChannels === 1 ? buf.getChannelData(0) : (() => { const m = new Float32Array(buf.length); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) m[i] += d[i] / buf.numberOfChannels; } return m; })();
        const heard = [];
        for (let s = 0; s < mono.length; s += WINDOW_S * 16000) {
          if (abort.current) { setProg(null); setMsg('Stopped — nothing saved.'); return; }
          const piece = mono.slice(s, Math.min(mono.length, s + WINDOW_S * 16000));
          const words = await transcribe(piece, (s / 16000) * 1000);
          heard.push(...words);
          doneS += piece.length / 16000;
          const rate = doneS / Math.max(1, (Date.now() - t0) / 1000);
          setProg({ label: `Listening to “${ordered[fi].name}”`, done: doneS, total: totalS, eta: (totalS - doneS) / Math.max(0.01, rate) });
        }
        const r = alignTranscript(doc.words, heard, { fileIndex: fi, from });
        anchors = anchors.concat(r.anchors);
        from = r.next;
      }
      if (anchors.length < 10) { setProg(null); setMsg('Couldn’t line the audio up with this book’s text — is it the same book (and edition)?'); return; }
      const meta = ordered.map((f, i) => ({ name: f.name, type: f.type || 'audio/mpeg', durationMs: Math.round(decoded[i].duration * 1000) }));
      await saveAudioSync(cs, { files: meta, blobs: ordered, anchors, model });
      if (!state.global.offlineVoice) updateGlobal({ offlineVoice: true }); // read-aloud plays it through the offline driver
      setExisting(await getAudioSync(cs));
      setProg(null);
      setMsg(`Synced ✓ — ${Math.round(syncCoverage(anchors, doc.words.length) * 100)}% of the book is lined up with your audio. Turn on read-aloud (A) and press play: your audiobook plays and the text follows.`);
    } catch (e) { setProg(null); setMsg(`Sync failed: ${e?.message || e}`); }
  }

  const fmt = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);
  return (
    <Dialog title="Sync my audiobook to this book" onClose={onClose} width={620}
      buttons={prog
        ? <button onClick={() => { abort.current = true; }}>Stop</button>
        : <><button className="toggle-on" disabled={!files.length} onClick={run}>Sync {files.length || ''} file{files.length === 1 ? '' : 's'}</button><button onClick={onClose}>Close</button></>}>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Pick your own audiobook of <b>{tab.fileName || doc.fileName}</b> (MP3 / M4B / M4A… — all its files at once; they’re put in name order).
        A speech model listens to it on this device, works out where every word is, and lines that up with the text — then read-aloud plays your audiobook and the reading position follows it.
        Nothing is uploaded. It takes a while: roughly as long as the audio itself on a typical laptop with the fast model.
      </p>
      {existing && (
        <p className="settings-note">✓ Already synced: {existing.files.length} file(s), {Math.round(syncCoverage(existing.anchors, doc.words.length) * 100)}% of the book. <button className="link-btn" onClick={async () => { await deleteAudioSync(cs); setExisting(null); setMsg('Sync removed.'); }}>Remove</button></p>
      )}
      <div className="lj-inline">
        <input type="file" multiple accept="audio/*,.m4b" disabled={!!prog} onChange={(e) => setFiles([...(e.target.files || [])])} aria-label="Audiobook files" />
        <label>Model <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={!!prog}>
          <option value="tiny">Fast (~40 MB)</option><option value="base">More accurate (~80 MB)</option>
        </select></label>
      </div>
      {files.length > 0 && !prog && <p className="settings-note">{[...files].sort(naturalSort).map((f) => f.name).join(' → ')}</p>}
      {prog && (
        <div>
          <p className="settings-note">{prog.label}{prog.eta != null ? ` · ${fmt(prog.done)} of ${fmt(prog.total)} · about ${fmt(prog.eta)} left` : ''}</p>
          {prog.total > 0 && <div className="imp-bar"><div className="imp-fill" style={{ width: `${Math.min(100, (prog.done / prog.total) * 100)}%` }} /></div>}
        </div>
      )}
      {msg && <p className="settings-note" role="status">{msg}</p>}
    </Dialog>
  );
}
