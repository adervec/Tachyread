import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  displayCaptureSupported,
  startDisplayCapture,
  stopCapture,
  captureFrame,
  canvasToDataUrl,
  frameSignature,
  signatureDiff,
} from '../features/screenCapture.js';
import { recognizeImage, ocrSupported, loadImage } from '../features/ocr.js';
import { buildGrabbedDoc } from '../document/grab.js';

const uid = () => Math.random().toString(36).slice(2);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const DUP_THRESHOLD = 6;

// "Grab Text" wizard — the browser adaptation of TextGrabber. Acquire text from a shared
// screen/window region or from uploaded images via OCR, keeping the original images so they
// can be shown side-by-side while speed-reading (like the PDF source pane).
export default function GrabWizard({ onClose }) {
  const { openDoc, setStatus } = useApp();
  const [step, setStep] = useState('source'); // source | screen | review
  const [segments, setSegments] = useState([]); // {id, image, text}
  const [msg, setMsg] = useState('');

  // Screen capture state
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [crop, setCrop] = useState(null); // {fx,fy,fw,fh} fractions of the displayed video
  const drawRef = useRef(null);
  const [autoCount, setAutoCount] = useState(5);
  const [autoInterval, setAutoInterval] = useState(2.5);
  const [stopDupes, setStopDupes] = useState(2);
  const autoRef = useRef({ running: false });
  const [autoRunning, setAutoRunning] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, step]);

  useEffect(() => () => stopCapture(stream), [stream]);

  function cropVideoPx() {
    const v = videoRef.current;
    if (!v || !crop) return null;
    return { x: crop.fx * v.videoWidth, y: crop.fy * v.videoHeight, w: crop.fw * v.videoWidth, h: crop.fh * v.videoHeight };
  }

  async function startScreen() {
    if (!displayCaptureSupported()) {
      setMsg('Screen capture is not supported in this browser.');
      return;
    }
    try {
      const { stream: s } = await startDisplayCapture();
      setStream(s);
      setStep('screen');
      setMsg('Sharing started. Optionally drag a selection rectangle, then Grab.');
      s.getVideoTracks()[0].addEventListener('ended', () => setMsg('Screen sharing ended.'));
    } catch (e) {
      setMsg('Screen capture cancelled: ' + (e?.message || e));
    }
  }

  function grabOnce() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = captureFrame(v, cropVideoPx());
    setSegments((arr) => [...arr, { id: uid(), image: canvasToDataUrl(canvas), text: '' }]);
    setMsg(`Captured ${segments.length + 1} page(s).`);
  }

  async function runAuto() {
    const count = Math.max(1, Number(autoCount) || 1);
    const interval = Math.max(0.3, Number(autoInterval) || 2) * 1000;
    const limit = Number(stopDupes) || 0;
    autoRef.current.running = true;
    setAutoRunning(true);
    let lastSig = null;
    let consec = 0;
    let captured = 0;
    for (let i = 0; i < count && autoRef.current.running; i++) {
      const v = videoRef.current;
      if (!v || !v.videoWidth) break;
      const canvas = captureFrame(v, cropVideoPx());
      const sig = frameSignature(canvas);
      if (lastSig && signatureDiff(sig, lastSig) < DUP_THRESHOLD) {
        consec++;
        setMsg(`Grab ${i + 1}/${count}: duplicate page (${consec} in a row)`);
        if (limit > 0 && consec >= limit) {
          setMsg(`Auto-finished — ${consec} consecutive duplicates.`);
          break;
        }
      } else {
        lastSig = sig;
        consec = 0;
        captured++;
        const url = canvasToDataUrl(canvas);
        setSegments((arr) => [...arr, { id: uid(), image: url, text: '' }]);
        setMsg(`Auto-grab: captured ${captured} page(s)… (advance the page now)`);
      }
      if (i < count - 1 && autoRef.current.running) await delay(interval);
    }
    autoRef.current.running = false;
    setAutoRunning(false);
    setMsg(`Auto-grab done — ${captured} page(s).`);
  }

  function abortAuto() {
    autoRef.current.running = false;
    setAutoRunning(false);
  }

  // ── Crop drawing on the live preview ──
  function onCropDown(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    drawRef.current = { rect, x0: (e.clientX - rect.left) / rect.width, y0: (e.clientY - rect.top) / rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onCropMove(e) {
    const d = drawRef.current;
    if (!d) return;
    const x1 = (e.clientX - d.rect.left) / d.rect.width;
    const y1 = (e.clientY - d.rect.top) / d.rect.height;
    const fx = Math.max(0, Math.min(d.x0, x1));
    const fy = Math.max(0, Math.min(d.y0, y1));
    const fw = Math.min(1, Math.abs(x1 - d.x0));
    const fh = Math.min(1, Math.abs(y1 - d.y0));
    setCrop(fw > 0.02 && fh > 0.02 ? { fx, fy, fw, fh } : null);
  }
  function onCropUp() {
    drawRef.current = null;
  }

  // ── Upload ──
  async function addFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        setSegments((arr) => [...arr, { id: uid(), image: canvasToDataUrl(canvas), text: '' }]);
      } catch {
        /* skip bad image */
      }
    }
    setStep('review');
  }

  // ── Review actions ──
  async function recognizeAll() {
    if (!ocrSupported()) {
      setMsg('OCR is not supported in this browser.');
      return;
    }
    setOcrBusy(true);
    const list = segments;
    for (let i = 0; i < list.length; i++) {
      setMsg(`Recognizing ${i + 1}/${list.length}… (first run downloads the OCR engine)`);
      try {
        const { text } = await recognizeImage(list[i].image);
        setSegments((arr) => arr.map((s) => (s.id === list[i].id ? { ...s, text } : s)));
      } catch (e) {
        setMsg('OCR error: ' + (e?.message || e));
      }
    }
    setOcrBusy(false);
    setMsg('Recognition complete — review and edit the text, then open it.');
  }

  function setText(id, text) {
    setSegments((arr) => arr.map((s) => (s.id === id ? { ...s, text } : s)));
  }
  function remove(id) {
    setSegments((arr) => arr.filter((s) => s.id !== id));
  }
  function move(i, dir) {
    setSegments((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function openInReader() {
    const usable = segments.filter((s) => (s.text || '').trim());
    if (!usable.length) {
      setMsg('No recognized text yet — run “Recognize text” first.');
      return;
    }
    try {
      const doc = await buildGrabbedDoc(segments.filter((s) => (s.text || '').trim() || s.image));
      stopCapture(stream);
      await openDoc(doc);
      setStatus(`Opened grabbed text (${doc.words.length} words, ${doc.segmentCount} image(s))`);
      onClose();
    } catch (e) {
      setMsg('Failed to open: ' + (e?.message || e));
    }
  }

  const hasText = segments.some((s) => (s.text || '').trim());

  return (
    <Dialog
      title="Grab Text"
      onClose={() => {
        abortAuto();
        stopCapture(stream);
        onClose();
      }}
      width={760}
      buttons={
        <>
          {step !== 'source' && <button onClick={() => setStep('source')}>← Source</button>}
          {segments.length > 0 && step !== 'review' && <button onClick={() => setStep('review')}>Review ({segments.length}) →</button>}
          {step === 'review' && (
            <>
              <button onClick={recognizeAll} disabled={ocrBusy || !segments.length}>
                {ocrBusy ? 'Recognizing…' : 'Recognize text (OCR)'}
              </button>
              <button className="toggle-on" onClick={openInReader} disabled={!hasText}>Open in reader</button>
            </>
          )}
        </>
      }
    >
      {msg && <p className="settings-note">{msg}</p>}

      {step === 'source' && (
        <div className="grab-source">
          <p>Capture text from anything on screen, or from image files, then speed-read it with the originals beside you.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            <button style={{ flex: 1, padding: '16px' }} onClick={startScreen} disabled={!displayCaptureSupported()}>
              🖥️ Capture screen / window
              <div className="settings-note" style={{ margin: '6px 0 0' }}>Share a screen, draw a region, grab pages (you flip the pages).</div>
            </button>
            <label style={{ flex: 1, padding: '16px', textAlign: 'center', cursor: 'pointer' }} className="grab-upload-btn">
              🖼️ Upload image(s)
              <div className="settings-note" style={{ margin: '6px 0 0' }}>Screenshots or photos of pages (PNG/JPG).</div>
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addFiles([...e.target.files])} />
            </label>
          </div>
          {!ocrSupported() && <p className="settings-note">⚠ OCR (WebAssembly) is unavailable in this browser.</p>}
        </div>
      )}

      {step === 'screen' && (
        <div className="grab-screen">
          <div
            className="grab-preview"
            onPointerDown={onCropDown}
            onPointerMove={onCropMove}
            onPointerUp={onCropUp}
          >
            <video ref={videoRef} muted playsInline />
            {crop && (
              <div
                className="grab-crop"
                style={{ left: `${crop.fx * 100}%`, top: `${crop.fy * 100}%`, width: `${crop.fw * 100}%`, height: `${crop.fh * 100}%` }}
              />
            )}
          </div>
          <div className="grab-controls">
            <button onClick={grabOnce} disabled={autoRunning}>📸 Grab page</button>
            <button onClick={() => setCrop(null)} disabled={!crop}>Clear region</button>
            <span className="grab-sep" />
            <label>Auto: <input type="number" min={1} max={200} value={autoCount} onChange={(e) => setAutoCount(e.target.value)} style={{ width: 48 }} /> grabs</label>
            <label>every <input type="number" min={0.3} step={0.5} value={autoInterval} onChange={(e) => setAutoInterval(e.target.value)} style={{ width: 48 }} /> s</label>
            <label>stop after <input type="number" min={0} value={stopDupes} onChange={(e) => setStopDupes(e.target.value)} style={{ width: 40 }} /> dupes</label>
            {autoRunning ? <button onClick={abortAuto}>Abort</button> : <button onClick={runAuto}>▶ Auto-grab</button>}
            <span className="grab-sep" />
            <span className="settings-note" style={{ margin: 0 }}>{segments.length} captured</span>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="grab-review">
          {segments.length === 0 && <p>No captures yet. Go back to add some.</p>}
          {segments.map((s, i) => (
            <div key={s.id} className="grab-seg">
              <img src={s.image} alt={`capture ${i + 1}`} className="grab-thumb" />
              <textarea
                value={s.text}
                placeholder="(not recognized yet)"
                onChange={(e) => setText(s.id, e.target.value)}
                rows={4}
              />
              <div className="grab-seg-actions">
                <button title="Move up" onClick={() => move(i, -1)}>↑</button>
                <button title="Move down" onClick={() => move(i, 1)}>↓</button>
                <button title="Remove" onClick={() => remove(s.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
