import { useEffect, useRef, useState } from 'react';
import { lookupIsbn, validIsbn } from '../features/openLibrary.js';

// Library → "＋ Add by ISBN": type an ISBN or scan the barcode on the back of the book — the
// browser's own BarcodeDetector where it has one (Android, ChromeOS, macOS), else the zxing-wasm
// stand-in (barcode-detector/ponyfill), loaded only when you press Scan. Open Library fills in the details and
// the new-book editor opens pre-filled, so nothing is saved until you press Save.
const canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const detectorClass = async () => window.BarcodeDetector || (await import('barcode-detector/ponyfill')).BarcodeDetector;

function Scanner({ onIsbn, onClose }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream, timer, dead = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        const Det = await detectorClass();
        if (dead) return;
        const det = new Det({ formats: ['ean_13'] });
        timer = setInterval(async () => {
          try {
            for (const c of await det.detect(v)) {
              const isbn = validIsbn(c.rawValue);
              if (isbn) { clearInterval(timer); onIsbn(isbn); return; }
            }
          } catch { /* frame not ready */ }
        }, 300);
      } catch (e) { setErr(e?.name === 'NotAllowedError' ? 'Camera blocked — allow it, or type the ISBN.' : `No camera: ${e?.message || e}`); }
    })();
    return () => { dead = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onIsbn]);
  return (
    <div className="isbn-scan">
      {err ? <p className="settings-note">{err}</p> : <video ref={videoRef} muted playsInline aria-label="Camera — point it at the barcode" />}
      <button onClick={onClose}>Stop scanning</button>
    </div>
  );
}

export default function IsbnAdd({ books = [], onFound, onOpenExisting }) {
  const [open, setOpen] = useState(false);
  const [isbn, setIsbn] = useState('');
  const [msg, setMsg] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  async function find(raw) {
    const clean = validIsbn(raw);
    if (!clean) { setMsg('That isn’t a valid ISBN — check the digits.'); return; }
    const have = books.find((b) => !b.deleted && String(b.isbn || '').replace(/[^0-9Xx]/g, '') === clean);
    if (have) { setMsg(`Already in your library: “${have.title}”.`); onOpenExisting?.(have.id); return; }
    setBusy(true); setMsg('Looking it up on Open Library…');
    try {
      const b = await lookupIsbn(clean);
      if (!b) { setMsg('Open Library doesn’t know that ISBN — opening a blank book with it filled in.'); onFound({ title: '', author: '', isbn: clean, fnf: 'F', type: 'long', genre: '' }); }
      else { setMsg(''); onFound(b); setOpen(false); setIsbn(''); }
    } catch (e) { setMsg(String(e?.message || e)); }
    setBusy(false);
  }
  if (!open) return <button onClick={() => setOpen(true)} title="Add a book from its ISBN — typed, or scanned from the barcode where your browser supports it">＋ Add by ISBN</button>;
  return (
    <span className="isbn-add">
      <form className="lj-inline" onSubmit={(e) => { e.preventDefault(); find(isbn); }}>
        <input value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN (10 or 13 digits)" aria-label="ISBN" autoFocus inputMode="numeric" />
        <button type="submit" className="toggle-on" disabled={busy || !isbn.trim()}>Look up</button>
        {canScan && <button type="button" onClick={() => setScan(true)} title="Scan the barcode on the back cover">📷 Scan</button>}
        <button type="button" onClick={() => { setOpen(false); setScan(false); setMsg(''); }}>Cancel</button>
      </form>
      {scan && <Scanner onIsbn={(v) => { setScan(false); setIsbn(v); find(v); }} onClose={() => setScan(false)} />}
      {msg && <span className="settings-note" role="status">{msg}</span>}
    </span>
  );
}
