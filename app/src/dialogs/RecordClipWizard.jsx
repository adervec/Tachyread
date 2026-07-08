import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getStream } from '../features/audioRecorder.js';
import { encodeTrimmedWav } from '../features/audioClipEdit.js';
import { addAudioClip } from '../state/storage.js';
import { pickFile } from '../features/fileSystem.js';

const AC = () => new (window.AudioContext || window.webkitAudioContext)();
const pickMime = () =>
  (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
const fmtT = (ms) => { const s = Math.max(0, ms) / 1000; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const fmtS = (sec) => `${(Math.round((sec || 0) * 10) / 10).toFixed(1)}s`;
// Turn a getUserMedia rejection into something the user can act on (always say what's blocking it).
function micErr(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone blocked — allow mic access for this site in your browser, then Record again.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No microphone found — plug one in (or use Import file instead).';
  if (n === 'NotReadableError') return 'The microphone is busy in another app. Close it and try again.';
  return 'Could not open the microphone: ' + (e?.message || e);
}

// Waveform with a shaded "kept" region. Peaks computed once per buffer; the overlay is a plain div so
// dragging the trim sliders doesn't force a canvas redraw.
function Waveform({ buffer, trim }) {
  const ref = useRef(null);
  const peaks = useMemo(() => {
    if (!buffer) return null;
    const W = 520, d = buffer.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
    const out = new Array(W);
    for (let x = 0; x < W; x++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) { const v = d[x * step + j] || 0; if (v < min) min = v; if (v > max) max = v; }
      out[x] = [min, max];
    }
    return out;
  }, [buffer]);
  useEffect(() => {
    const cv = ref.current; if (!cv || !peaks) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, mid = H / 2;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = getComputedStyle(cv).getPropertyValue('color') || '#3a86ff';
    g.globalAlpha = 0.9;
    g.beginPath();
    for (let x = 0; x < W; x++) { const [mn, mx] = peaks[x]; g.moveTo(x, mid + mn * mid); g.lineTo(x, mid + mx * mid); }
    g.stroke();
  }, [peaks]);
  const dur = buffer?.duration || 1;
  const [a, b] = trim;
  return (
    <div className="rcw-wave">
      <canvas ref={ref} width={520} height={72} />
      <div className="rcw-wave-cut left" style={{ width: `${(a / dur) * 100}%` }} />
      <div className="rcw-wave-cut right" style={{ width: `${(1 - b / dur) * 100}%` }} />
    </div>
  );
}

// Record / import / trim / save one narration clip for a chunk. Robust vs the old one-shot Rec button:
// mic permission + level meter + pause/resume, file import, waveform trim, and preview before saving.
export default function RecordClipWizard({ checksum, chunk, onClose, onSaved }) {
  // phase: setup → requesting → recording ↔ paused → decoding → review → saving
  const [phase, setPhase] = useState('setup');
  const [err, setErr] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState([0, 0]);
  const [previewing, setPreviewing] = useState(false);
  const [buffer, setBuffer] = useState(null); // decoded AudioBuffer (drives the review UI)

  const recRef = useRef(null), chunksRef = useRef([]), mimeRef = useRef('audio/webm');
  const startedAtRef = useRef(0), baseMsRef = useRef(0), timerRef = useRef(0);
  const ctxRef = useRef(null), analyserRef = useRef(null), meterSrcRef = useRef(null), rafRef = useRef(0);
  const meterFillRef = useRef(null);
  const origBlobRef = useRef(null), previewSrcRef = useRef(null);

  const ctx = () => (ctxRef.current ||= AC());

  // ── meter (rAF; writes DOM width directly, no re-render) ──
  function startMeter() {
    const an = analyserRef.current; if (!an) return;
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      if (meterFillRef.current) meterFillRef.current.style.width = `${Math.min(100, rms * 220)}%`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  function stopMeter() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (meterFillRef.current) meterFillRef.current.style.width = '0%';
  }

  // ── elapsed timer ──
  const startTimer = () => { timerRef.current = setInterval(() => setElapsed(baseMsRef.current + (Date.now() - startedAtRef.current)), 200); };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = 0; };

  function pickMimeSafe() { try { return pickMime(); } catch { return ''; } }

  async function startRec() {
    setErr(''); setPhase('requesting');
    let stream;
    try { stream = await getStream(); } catch (e) { setPhase('setup'); setErr(micErr(e)); return; }
    try {
      const c = ctx(); if (c.state === 'suspended') c.resume().catch(() => {});
      const an = c.createAnalyser(); an.fftSize = 512;
      const src = c.createMediaStreamSource(stream); src.connect(an);
      analyserRef.current = an; meterSrcRef.current = src;
      const mime = pickMimeSafe();
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
      rec.onstop = () => finishBlob(new Blob(chunksRef.current, { type: mime || 'audio/webm' }));
      recRef.current = rec; mimeRef.current = mime || 'audio/webm';
      // eslint-disable-next-line react-hooks/purity -- event handler, not render (anchors the timer)
      baseMsRef.current = 0; startedAtRef.current = Date.now(); setElapsed(0);
      rec.start(); setPhase('recording'); startTimer(); startMeter();
    } catch (e) { setPhase('setup'); setErr('Could not start recording: ' + (e?.message || e)); }
  }
  function pauseRec() {
    const rec = recRef.current; if (!rec || rec.state !== 'recording') return;
    rec.pause(); baseMsRef.current += Date.now() - startedAtRef.current; stopTimer(); stopMeter(); setPhase('paused');
  }
  function resumeRec() {
    const rec = recRef.current; if (!rec || rec.state !== 'paused') return;
    startedAtRef.current = Date.now(); rec.resume(); setPhase('recording'); startTimer(); startMeter();
  }
  function stopRec() {
    const rec = recRef.current; if (!rec) return;
    if (rec.state === 'recording') baseMsRef.current += Date.now() - startedAtRef.current;
    stopTimer(); stopMeter(); setPhase('decoding');
    try { meterSrcRef.current?.disconnect(); } catch { /* */ }
    try { rec.stop(); } catch (e) { setErr('Stop failed: ' + (e?.message || e)); }
  }

  async function importFile() {
    setErr('');
    const f = await pickFile('audio/*');
    if (!f) return;
    await finishBlob(f);
  }

  // Decode any captured/imported blob → AudioBuffer, then land in review with a full-length trim.
  async function finishBlob(blob) {
    setPhase('decoding'); setErr('');
    try {
      const buf = await ctx().decodeAudioData(await blob.arrayBuffer());
      origBlobRef.current = blob; setBuffer(buf);
      setDuration(buf.duration); setTrim([0, buf.duration]); setPhase('review');
    } catch (e) {
      origBlobRef.current = null; setBuffer(null);
      setErr(`Couldn't read that audio (${e?.message || e}). Try a WAV/MP3/WebM/M4A file.`);
      setPhase('setup');
    }
  }

  // ── preview the trimmed region (Web Audio, exact — no re-encode) ──
  function stopPreview() {
    const s = previewSrcRef.current; if (s) { try { s.onended = null; s.stop(); } catch { /* */ } previewSrcRef.current = null; }
    setPreviewing(false);
  }
  function playPreview() {
    if (previewing) { stopPreview(); return; }
    const buf = buffer; if (!buf) return;
    const c = ctx(); if (c.state === 'suspended') c.resume().catch(() => {});
    const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination);
    src.onended = () => { previewSrcRef.current = null; setPreviewing(false); };
    const [a, b] = trim;
    src.start(0, a, Math.max(0.03, b - a));
    previewSrcRef.current = src; setPreviewing(true);
  }

  async function save() {
    const buf = buffer; if (!buf) return;
    stopPreview(); setPhase('saving'); setErr('');
    const [a, b] = trim;
    const untrimmed = a <= 0.02 && b >= buf.duration - 0.02;
    let blob, durationMs;
    if (untrimmed && origBlobRef.current) {
      blob = origBlobRef.current; durationMs = Math.round(buf.duration * 1000);
    } else {
      const channels = []; for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i));
      blob = new Blob([encodeTrimmedWav(channels, buf.sampleRate, a, b)], { type: 'audio/wav' });
      durationMs = Math.round((b - a) * 1000);
    }
    try {
      await addAudioClip(checksum, chunk.startLine, blob, { source: 'mic', durationMs, spanEndLine: chunk.endLine });
      onSaved?.();
    } catch (e) { setErr('Save failed: ' + (e?.message || e)); setPhase('review'); }
  }

  function discard() {
    stopPreview(); setBuffer(null); origBlobRef.current = null;
    setDuration(0); setTrim([0, 0]); setElapsed(0); setErr(''); setPhase('setup');
  }

  // cleanup on unmount
  useEffect(() => () => {
    stopTimer(); stopMeter(); stopPreview();
    try { recRef.current?.state !== 'inactive' && recRef.current?.stop(); } catch { /* */ }
    try { meterSrcRef.current?.disconnect(); } catch { /* */ }
    try { ctxRef.current?.close(); } catch { /* */ }
    // NB: we deliberately don't stopStream() — the mic stream is shared (voice commands etc.).
  }, []);

  const lineLabel = chunk.endLine > chunk.startLine ? `${chunk.startLine + 1}–${chunk.endLine + 1}` : `${chunk.startLine + 1}`;
  const setA = (v) => setTrim(([, b]) => [Math.min(v, b - 0.05), b]);
  const setB = (v) => setTrim(([a]) => [a, Math.max(v, a + 0.05)]);

  const footer = phase === 'review'
    ? <>
        <button className="toggle-on" onClick={save}>Save clip</button>
        <button onClick={discard}>Record again</button>
        <button onClick={() => { stopPreview(); onClose(); }}>Cancel</button>
      </>
    : <button onClick={() => { stopRec(); onClose(); }}>Cancel</button>;

  return (
    <Dialog title={`Record clip — chunk ${lineLabel}`} onClose={() => { stopRec(); onClose(); }} width={600} buttons={footer}>
      <p className="rcw-text" title="What this clip narrates">{chunk.text.slice(0, 220)}{chunk.text.length > 220 ? '…' : ''}</p>
      {err && <p className="rcw-err">⚠ {err}</p>}

      {(phase === 'setup' || phase === 'requesting') && (
        <div className="rcw-panel">
          <div className="rcw-controls">
            <button className="rcw-rec" onClick={startRec} disabled={phase === 'requesting'}>
              {phase === 'requesting' ? '…opening mic' : '● Record'}
            </button>
            <span className="grab-sep" />
            <button onClick={importFile} disabled={phase === 'requesting'}>📂 Import file…</button>
          </div>
          <p className="settings-note" style={{ marginBottom: 0 }}>
            {phase === 'requesting' ? 'Waiting for microphone permission…' : 'Record with your mic, or import an existing audio file (WAV / MP3 / M4A / WebM). You can trim it before saving.'}
          </p>
        </div>
      )}

      {(phase === 'recording' || phase === 'paused') && (
        <div className="rcw-panel">
          <div className="rcw-recstate">
            <span className={`rcw-dot${phase === 'recording' ? ' live' : ''}`} />
            <strong>{phase === 'recording' ? 'Recording' : 'Paused'}</strong>
            <span className="rcw-time">{fmtT(elapsed)}</span>
          </div>
          <div className="rcw-meter" title="Input level"><div ref={meterFillRef} className="rcw-meter-fill" /></div>
          <div className="rcw-controls">
            {phase === 'recording'
              ? <button onClick={pauseRec}>❚❚ Pause</button>
              : <button className="toggle-on" onClick={resumeRec}>▶ Resume</button>}
            <button className="rcw-stop" onClick={stopRec}>■ Stop</button>
          </div>
        </div>
      )}

      {phase === 'decoding' && <p className="settings-note">Decoding audio…</p>}

      {(phase === 'review' || phase === 'saving') && buffer && (
        <div className="rcw-panel">
          <Waveform buffer={buffer} trim={trim} />
          <div className="rcw-trim">
            <label>Start
              <input type="range" min={0} max={duration} step={0.05} value={trim[0]} onChange={(e) => setA(Number(e.target.value))} />
              <span className="range-val">{fmtS(trim[0])}</span>
            </label>
            <label>End
              <input type="range" min={0} max={duration} step={0.05} value={trim[1]} onChange={(e) => setB(Number(e.target.value))} />
              <span className="range-val">{fmtS(trim[1])}</span>
            </label>
          </div>
          <div className="rcw-controls">
            <button className={previewing ? 'toggle-on' : ''} onClick={playPreview}>{previewing ? '■ Stop' : '▶ Preview'}</button>
            <span className="settings-note" style={{ margin: 0 }}>
              Kept: <strong>{fmtS(trim[1] - trim[0])}</strong> of {fmtS(duration)}
              {(trim[0] > 0.02 || trim[1] < duration - 0.02) ? ' · saved as trimmed WAV' : ''}
            </span>
            {phase === 'saving' && <span className="settings-note" style={{ margin: 0 }}>Saving…</span>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
