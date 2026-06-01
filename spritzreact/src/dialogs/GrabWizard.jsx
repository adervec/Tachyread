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
import { recognizeImageEx, ocrSupported, loadImage } from '../features/ocr.js';
import { buildGrabbedDoc } from '../document/grab.js';
import { playGrabClick } from '../features/clickSound.js';
import { speechRecognitionSupported } from '../features/speechRecognition.js';
import { saveGrabbed, allGrabbed, deleteGrabbed, saveGrabSession, allGrabSessions, deleteGrabSession } from '../state/storage.js';

const uid = () => Math.random().toString(36).slice(2);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const DUP_THRESHOLD = 6;
const VOICE_WORDS = ['GO', 'SHOOT', 'GRAB', 'HUT', 'CAP', 'TAKE'];

// Built-in layout templates: ordered regions OCR'd separately so columns don't interleave.
const BUILTIN_LAYOUTS = {
  'Single column': null,
  'Two columns': [{ fx: 0, fy: 0, fw: 0.5, fh: 1 }, { fx: 0.5, fy: 0, fw: 0.5, fh: 1 }],
  'Three columns': [
    { fx: 0, fy: 0, fw: 1 / 3, fh: 1 },
    { fx: 1 / 3, fy: 0, fw: 1 / 3, fh: 1 },
    { fx: 2 / 3, fy: 0, fw: 1 / 3, fh: 1 },
  ],
};

// Inline editor for drawing ordered OCR regions over a page image (and saving as a template).
function RegionEditor({ image, regions, onApply, onClose, onSaveTemplate }) {
  const [rects, setRects] = useState(regions ? [...regions] : []);
  const [tmp, setTmp] = useState(null);
  const [tplName, setTplName] = useState('');
  const draw = useRef(null);

  function rel(e) {
    const r = draw.current.r;
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  function down(e) {
    draw.current = { r: e.currentTarget.getBoundingClientRect() };
    const { x, y } = rel(e);
    draw.current.x0 = x;
    draw.current.y0 = y;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (!draw.current) return;
    const { x, y } = rel(e);
    setTmp({ fx: Math.min(draw.current.x0, x), fy: Math.min(draw.current.y0, y), fw: Math.abs(x - draw.current.x0), fh: Math.abs(y - draw.current.y0) });
  }
  function up() {
    if (tmp && tmp.fw > 0.02 && tmp.fh > 0.02) setRects((r) => [...r, tmp]);
    setTmp(null);
    draw.current = null;
  }

  const box = (r) => ({ left: `${r.fx * 100}%`, top: `${r.fy * 100}%`, width: `${r.fw * 100}%`, height: `${r.fh * 100}%` });

  return (
    <div className="grab-regioned">
      <div className="grab-regioned-head">
        <span>Drag rectangles in <b>reading order</b>. {rects.length} region(s).</span>
        <button onClick={() => setRects((r) => r.slice(0, -1))} disabled={!rects.length}>Undo</button>
        <button onClick={() => setRects([])} disabled={!rects.length}>Clear</button>
      </div>
      <div className="grab-regioned-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <img src={image} alt="page" draggable={false} />
        {rects.map((r, i) => (
          <div key={i} className="grab-region" style={box(r)}><span>{i + 1}</span></div>
        ))}
        {tmp && <div className="grab-region grab-region-tmp" style={box(tmp)} />}
      </div>
      <div className="grab-regioned-foot">
        <input placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} style={{ width: 130 }} />
        <button disabled={!rects.length || !tplName.trim()} onClick={() => { onSaveTemplate(tplName.trim(), rects); setTplName(''); }}>Save as template</button>
        <span className="grab-sep" />
        <button disabled={!rects.length} onClick={() => onApply(rects, false)}>Apply to this page</button>
        <button disabled={!rects.length} onClick={() => onApply(rects, true)}>Apply to all pages</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// "Grab Text" wizard — capture from screen/window (manual / timer / voice) or images, OCR with
// per-page layout templates and colour assist, then open beside the originals. Grabs are saved
// so they reopen without repeating the process.
export default function GrabWizard({ onClose }) {
  const { openDoc, setStatus, state, updateGlobal } = useApp();
  const [step, setStep] = useState('source'); // source | screen | review
  const [segments, setSegments] = useState([]); // {id, image, text, layout, regions, ocrMode}
  const [msg, setMsg] = useState('');
  const shotsRef = useRef(null);
  // Keep the captured-shots preview scrolled to the newest grab.
  useEffect(() => {
    const el = shotsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments.length]);

  // Screen capture state
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [crop, setCrop] = useState(null);
  const drawRef = useRef(null);
  const [autoCount, setAutoCount] = useState(5);
  const [autoInterval, setAutoInterval] = useState(2.5);
  const [stopDupes, setStopDupes] = useState(2);
  const autoRef = useRef({ running: false });
  const [autoRunning, setAutoRunning] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  // Voice-command grab
  const [voiceWord, setVoiceWord] = useState('GRAB');
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceLog, setVoiceLog] = useState([]); // recent heard phrases / matches / errors
  const [heardNow, setHeardNow] = useState(''); // live interim transcript
  const recogRef = useRef(null);
  const lastVoiceGrab = useRef(0);
  const voiceLogId = useRef(0);
  const voiceWordRef = useRef(voiceWord);
  voiceWordRef.current = voiceWord;
  const pushVoiceLog = (text, matched = false, error = false) =>
    setVoiceLog((l) => [...l.slice(-11), { id: ++voiceLogId.current, text, matched, error, t: new Date().toLocaleTimeString() }]);

  // Resumable / abandoned grab sessions + accidental-close protection
  const [sessions, setSessions] = useState([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const sessionIdRef = useRef(uid());
  const createdAtRef = useRef(Date.now());
  const closingRef = useRef(false);

  // OCR config (doc-wide) + region editor + recent grabs
  const [docLayout, setDocLayout] = useState('Single column');
  const [ocrInvert, setOcrInvert] = useState('auto');
  const [ocrContrast, setOcrContrast] = useState(1.6);
  const [useColors, setUseColors] = useState(false);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#111111');
  const [fontHint, setFontHint] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [recent, setRecent] = useState([]);

  const savedTemplates = state.global.ocrTemplates || [];
  const layoutNames = [...Object.keys(BUILTIN_LAYOUTS), ...savedTemplates.map((t) => t.name)];

  function regionsForLayout(name) {
    if (name in BUILTIN_LAYOUTS) return BUILTIN_LAYOUTS[name];
    const t = savedTemplates.find((x) => x.name === name);
    return t ? t.regions : null;
  }
  function segRegions(seg) {
    if (seg.regions) return seg.regions; // custom drawn regions win
    return regionsForLayout(seg.layout || docLayout);
  }
  function docConfig() {
    return { invert: ocrInvert, contrast: Number(ocrContrast) || 1.6, bgColor: useColors ? bgColor : null, textColor: useColors ? textColor : null };
  }
  function segConfig(seg) {
    if (seg.ocrMode === 'exempt') return { invert: 'off', contrast: 1 };
    if (seg.ocrMode === 'invert') return { invert: 'on', contrast: Number(ocrContrast) || 1.6 };
    return docConfig();
  }

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, step]);

  useEffect(() => () => stopCapture(stream), [stream]);

  useEffect(() => {
    allGrabbed().then((list) => setRecent(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)))).catch(() => {});
  }, []);

  // Voice recognition lifecycle — only while listening on the capture step. Chrome's
  // SpeechRecognition stops itself after each utterance / on silence, so the key to
  // reliability is restarting it (recreating the instance if a restart throws) and scanning
  // every result segment — interim included — for the trigger word.
  useEffect(() => {
    if (!voiceOn || step !== 'screen') { setHeardNow(''); return; }
    if (!speechRecognitionSupported()) {
      setMsg('Voice grab needs Chrome/Edge (Web Speech API).');
      setVoiceOn(false);
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const handle = { stopped: false, rec: null, timer: null };
    function start() {
      let rec;
      try { rec = new Ctor(); } catch { return; }
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (ev) => {
        let interim = '', finalText = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const seg = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += seg + ' '; else interim += seg + ' ';
        }
        setHeardNow(interim.trim());
        const word = voiceWordRef.current.toLowerCase();
        const toks = (finalText + ' ' + interim).toLowerCase().match(/[a-z']+/g) || [];
        const matched = toks.includes(word);
        if (finalText.trim()) pushVoiceLog(finalText.trim(), matched, false);
        if (matched) {
          const now = Date.now();
          if (now - lastVoiceGrab.current > 800) {
            lastVoiceGrab.current = now;
            grabOnce();
            pushVoiceLog(`✓ grabbed on “${voiceWordRef.current}”`, true, false);
            setHeardNow('');
          }
        }
      };
      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          setMsg('Microphone blocked — allow mic access, then toggle Listen.');
          handle.stopped = true;
          setVoiceOn(false);
        } else if (ev.error && ev.error !== 'no-speech' && ev.error !== 'aborted') {
          pushVoiceLog(`(mic: ${ev.error})`, false, true);
        }
      };
      rec.onend = () => {
        if (handle.stopped) return;
        handle.timer = setTimeout(() => { if (!handle.stopped) start(); }, 300); // auto-restart
      };
      try { rec.start(); handle.rec = rec; }
      catch { handle.timer = setTimeout(() => { if (!handle.stopped) start(); }, 400); }
    }
    recogRef.current = handle;
    setVoiceLog([]);
    setMsg(`Listening… say “${voiceWordRef.current}” to grab.`);
    start();
    return () => {
      handle.stopped = true;
      clearTimeout(handle.timer);
      try { handle.rec?.stop(); } catch { /* noop */ }
      try { handle.rec?.abort(); } catch { /* noop */ }
      setHeardNow('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, step]);

  // Load resumable (abandoned) sessions when the wizard opens.
  useEffect(() => {
    allGrabSessions().then((list) => setSessions(list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)))).catch(() => {});
  }, []);

  // Auto-cache the in-progress capture (debounced) so an abandoned grab can be resumed even
  // after a hard browser close. Empty captures aren't saved.
  useEffect(() => {
    if (!segments.length || closingRef.current) return;
    const t = setTimeout(() => { if (!closingRef.current) saveGrabSession(sessionRecord()).catch(() => {}); }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, docLayout, ocrInvert, ocrContrast, useColors, bgColor, textColor, fontHint, voiceWord]);

  function cropVideoPx() {
    const v = videoRef.current;
    if (!v || !crop) return null;
    return { x: crop.fx * v.videoWidth, y: crop.fy * v.videoHeight, w: crop.fw * v.videoWidth, h: crop.fh * v.videoHeight };
  }

  async function startScreen() {
    if (!displayCaptureSupported()) { setMsg('Screen capture is not supported in this browser.'); return; }
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

  const newSeg = (image) => ({ id: uid(), image, text: '', layout: null, regions: null, ocrMode: 'default' });

  function grabOnce() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    playGrabClick();
    const url = canvasToDataUrl(captureFrame(v, cropVideoPx()));
    setSegments((arr) => { setMsg(`Captured ${arr.length + 1} page(s).`); return [...arr, newSeg(url)]; });
  }

  async function runAuto() {
    const count = Math.max(1, Number(autoCount) || 1);
    const interval = Math.max(0.3, Number(autoInterval) || 2) * 1000;
    const limit = Number(stopDupes) || 0;
    autoRef.current.running = true;
    setAutoRunning(true);
    let lastSig = null, consec = 0, captured = 0;
    for (let i = 0; i < count && autoRef.current.running; i++) {
      const v = videoRef.current;
      if (!v || !v.videoWidth) break;
      const canvas = captureFrame(v, cropVideoPx());
      const sig = frameSignature(canvas);
      if (lastSig && signatureDiff(sig, lastSig) < DUP_THRESHOLD) {
        consec++;
        setMsg(`Grab ${i + 1}/${count}: duplicate page (${consec} in a row)`);
        if (limit > 0 && consec >= limit) { setMsg(`Auto-finished — ${consec} consecutive duplicates.`); break; }
      } else {
        lastSig = sig; consec = 0; captured++;
        playGrabClick();
        const url = canvasToDataUrl(canvas);
        setSegments((arr) => [...arr, newSeg(url)]);
        setMsg(`Auto-grab: captured ${captured} page(s)… (advance the page now)`);
      }
      if (i < count - 1 && autoRef.current.running) await delay(interval);
    }
    autoRef.current.running = false;
    setAutoRunning(false);
    setMsg(`Auto-grab done — ${captured} page(s).`);
  }

  function abortAuto() { autoRef.current.running = false; setAutoRunning(false); }

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
  function onCropUp() { drawRef.current = null; }

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
        setSegments((arr) => [...arr, newSeg(canvasToDataUrl(canvas))]);
      } catch { /* skip bad image */ }
    }
    setStep('review');
  }

  // ── Review actions ──
  async function recognizeAll() {
    if (!ocrSupported()) { setMsg('OCR is not supported in this browser.'); return; }
    setOcrBusy(true);
    const list = segments;
    for (let i = 0; i < list.length; i++) {
      setMsg(`Recognizing ${i + 1}/${list.length}… (first run downloads the OCR engine)`);
      try {
        const { text } = await recognizeImageEx(list[i].image, { regions: segRegions(list[i]), config: segConfig(list[i]) });
        setSegments((arr) => arr.map((s) => (s.id === list[i].id ? { ...s, text } : s)));
      } catch (e) {
        setMsg('OCR error: ' + (e?.message || e));
      }
    }
    setOcrBusy(false);
    setMsg('Recognition complete — review and edit the text, then open it.');
  }

  function setText(id, text) { setSegments((arr) => arr.map((s) => (s.id === id ? { ...s, text } : s))); }
  function patchSeg(id, patch) { setSegments((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s))); }
  function remove(id) { setSegments((arr) => arr.filter((s) => s.id !== id)); }
  function move(i, dir) {
    setSegments((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function saveTemplate(name, regions) {
    const next = [...savedTemplates.filter((t) => t.name !== name), { name, regions }];
    updateGlobal({ ocrTemplates: next });
    setMsg(`Saved layout template “${name}”.`);
  }
  function applyRegions(regions, all) {
    if (all) setSegments((arr) => arr.map((s) => ({ ...s, regions, layout: null })));
    else patchSeg(editingId, { regions });
    setEditingId(null);
  }

  async function openInReader() {
    const usable = segments.filter((s) => (s.text || '').trim());
    if (!usable.length) { setMsg('No recognized text yet — run “Recognize text” first.'); return; }
    closingRef.current = true; // stop the auto-save from re-creating the session
    try {
      const keep = segments.filter((s) => (s.text || '').trim() || s.image);
      const name = `Grab — ${new Date().toLocaleString()}`;
      const doc = await buildGrabbedDoc(keep, name);
      // Persist so the grab reopens later without re-capturing / re-OCR.
      await saveGrabbed({
        checksum: doc.contentChecksum,
        name,
        createdAt: Date.now(),
        segments: keep.map((s) => ({ text: s.text || '', image: s.image, layout: s.layout, regions: s.regions, ocrMode: s.ocrMode })),
        ocr: { docLayout, invert: ocrInvert, contrast: ocrContrast, useColors, bgColor, textColor, font: fontHint },
      }).catch(() => {});
      stopCapture(stream);
      await deleteGrabSession(sessionIdRef.current).catch(() => {}); // no longer abandoned
      await openDoc(doc);
      setStatus(`Opened grabbed text (${doc.words.length} words, ${doc.segmentCount} image(s))`);
      onClose();
    } catch (e) {
      closingRef.current = false;
      setMsg('Failed to open: ' + (e?.message || e));
    }
  }

  async function openRecent(rec) {
    try {
      const doc = await buildGrabbedDoc(rec.segments.map((s) => ({ text: s.text, image: s.image })), rec.name);
      stopCapture(stream);
      await openDoc(doc);
      setStatus(`Reopened ${rec.name} (${doc.words.length} words)`);
      onClose();
    } catch (e) {
      setMsg('Failed to reopen: ' + (e?.message || e));
    }
  }
  async function removeRecent(rec) {
    await deleteGrabbed(rec.checksum).catch(() => {});
    setRecent((r) => r.filter((x) => x.checksum !== rec.checksum));
  }

  // ── Resumable sessions + accidental-close protection ──
  function sessionRecord() {
    return {
      id: sessionIdRef.current,
      createdAt: createdAtRef.current,
      updatedAt: Date.now(),
      step: step === 'screen' ? 'review' : step,
      voiceWord,
      segments: segments.map((s) => ({ text: s.text || '', image: s.image, layout: s.layout || null, regions: s.regions || null, ocrMode: s.ocrMode || 'default' })),
      ocr: { docLayout, invert: ocrInvert, contrast: ocrContrast, useColors, bgColor, textColor, font: fontHint },
      pageCount: segments.length,
    };
  }
  function resumeSession(sess) {
    setSegments((sess.segments || []).map((s) => ({ id: uid(), image: s.image, text: s.text || '', layout: s.layout || null, regions: s.regions || null, ocrMode: s.ocrMode || 'default' })));
    const o = sess.ocr || {};
    if (o.docLayout) setDocLayout(o.docLayout);
    if (o.invert) setOcrInvert(o.invert);
    if (o.contrast != null) setOcrContrast(o.contrast);
    setUseColors(!!o.useColors);
    if (o.bgColor) setBgColor(o.bgColor);
    if (o.textColor) setTextColor(o.textColor);
    if (o.font != null) setFontHint(o.font);
    if (sess.voiceWord) setVoiceWord(sess.voiceWord);
    sessionIdRef.current = sess.id;
    createdAtRef.current = sess.createdAt || Date.now();
    setStep('review');
    setMsg(`Resumed session — ${(sess.segments || []).length} page(s). Continue OCR/editing, or go back to capture more.`);
  }
  async function discardSession(sess) {
    await deleteGrabSession(sess.id).catch(() => {});
    setSessions((s) => s.filter((x) => x.id !== sess.id));
  }

  function doClose() {
    closingRef.current = true;
    abortAuto();
    setVoiceOn(false);
    stopCapture(stream);
    onClose();
  }
  function requestClose() {
    if (segments.length > 0) { setConfirmClose(true); return; }
    doClose();
  }
  async function saveAndClose() {
    await saveGrabSession(sessionRecord()).catch(() => {});
    doClose();
  }
  async function discardAndClose() {
    closingRef.current = true;
    await deleteGrabSession(sessionIdRef.current).catch(() => {});
    doClose();
  }

  const hasText = segments.some((s) => (s.text || '').trim());
  const voiceSupported = speechRecognitionSupported();
  const editingSeg = editingId ? segments.find((s) => s.id === editingId) : null;

  return (
    <Dialog
      title="Grab Text"
      onClose={requestClose}
      dismissable={false}
      width={1280}
      buttons={
        <>
          {step !== 'source' && <button onClick={() => setStep('source')}>← Source</button>}
          {segments.length > 0 && step !== 'review' && <button onClick={() => setStep('review')}>Review &amp; OCR ({segments.length}) →</button>}
          {step === 'review' && !editingId && (
            <>
              <button onClick={recognizeAll} disabled={ocrBusy || !segments.length}>{ocrBusy ? 'Recognizing…' : 'Recognize text (OCR)'}</button>
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
              <div className="settings-note" style={{ margin: '6px 0 0' }}>Share a screen, draw a region, grab pages by button, timer, or voice.</div>
            </button>
            <label style={{ flex: 1, padding: '16px', textAlign: 'center', cursor: 'pointer' }} className="grab-upload-btn">
              🖼️ Upload image(s)
              <div className="settings-note" style={{ margin: '6px 0 0' }}>Screenshots or photos of pages (PNG/JPG).</div>
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addFiles([...e.target.files])} />
            </label>
          </div>
          {!ocrSupported() && <p className="settings-note">⚠ OCR (WebAssembly) is unavailable in this browser.</p>}

          {sessions.length > 0 && (
            <div className="grab-recent grab-sessions">
              <div className="grab-recent-head">Resume an unfinished grab session</div>
              {sessions.map((s) => (
                <div key={s.id} className="grab-recent-row">
                  <button className="grab-recent-open" onClick={() => resumeSession(s)} title="Resume this session">
                    ▶ {(s.pageCount ?? s.segments?.length) || 0} page(s)
                    <span className="settings-note" style={{ margin: 0 }}> · {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ''}</span>
                  </button>
                  <button onClick={() => discardSession(s)} title="Discard this session">🗑</button>
                </div>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <div className="grab-recent">
              <div className="grab-recent-head">Recent grabs — reopen without re-capturing</div>
              {recent.map((r) => (
                <div key={r.checksum} className="grab-recent-row">
                  <button className="grab-recent-open" onClick={() => openRecent(r)} title="Reopen">
                    📄 {r.name} <span className="settings-note" style={{ margin: 0 }}>· {r.segments?.length || 0} page(s)</span>
                  </button>
                  <button onClick={() => removeRecent(r)} title="Delete saved grab">🗑</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'screen' && (
        <div className="grab-screen grab-screen-2col">
          <div className="grab-capture-col">
            <div className="grab-preview" onPointerDown={onCropDown} onPointerMove={onCropMove} onPointerUp={onCropUp}>
              <video ref={videoRef} muted playsInline />
              {crop && <div className="grab-crop" style={{ left: `${crop.fx * 100}%`, top: `${crop.fy * 100}%`, width: `${crop.fw * 100}%`, height: `${crop.fh * 100}%` }} />}
            </div>
            <div className="grab-controls">
              <button onClick={grabOnce} disabled={autoRunning}>📸 Grab page</button>
              <button onClick={() => setCrop(null)} disabled={!crop}>Clear region</button>
              <span className="grab-sep" />
              <label>Auto: <input type="number" min={1} max={200} value={autoCount} onChange={(e) => setAutoCount(e.target.value)} style={{ width: 48 }} /> grabs</label>
              <label>every <input type="number" min={0.3} step={0.5} value={autoInterval} onChange={(e) => setAutoInterval(e.target.value)} style={{ width: 48 }} /> s</label>
              <label>stop after <input type="number" min={0} value={stopDupes} onChange={(e) => setStopDupes(e.target.value)} style={{ width: 40 }} /> dupes</label>
              {autoRunning ? <button onClick={abortAuto}>Abort</button> : <button onClick={runAuto}>▶ Auto-grab</button>}
            </div>
            <div className="grab-voice">
              <label>🎙 Voice word
                <select value={voiceWord} onChange={(e) => setVoiceWord(e.target.value)} disabled={voiceOn}>
                  {VOICE_WORDS.map((w) => <option key={w}>{w}</option>)}
                </select>
              </label>
              <button className={voiceOn ? 'toggle-on' : ''} onClick={() => setVoiceOn((v) => !v)} disabled={!voiceSupported} title={voiceSupported ? `Say “${voiceWord}” to grab` : 'Voice needs Chrome/Edge'}>
                {voiceOn ? '■ Stop listening' : '🎙 Listen'}
              </button>
              {!voiceSupported && <span className="settings-note" style={{ margin: 0 }}>Voice needs Chrome/Edge.</span>}
              {voiceOn && (
                <div className="grab-voice-log">
                  <div className="gvl-head">
                    <span className="gvl-live">● listening for “{voiceWord}”</span>
                    {heardNow && <em className="gvl-now">“{heardNow}”</em>}
                  </div>
                  {voiceLog.length === 0 && <div className="settings-note" style={{ margin: 0 }}>Heard speech shows here. If nothing appears, check the mic permission.</div>}
                  {[...voiceLog].reverse().map((e) => (
                    <div key={e.id} className={`gvl-row${e.matched ? ' match' : ''}${e.error ? ' err' : ''}`}>
                      <span className="gvl-ts">{e.t}</span> {e.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="grab-shots-col">
            <div className="grab-shots-head">{segments.length} captured</div>
            <div className="grab-shots" ref={shotsRef}>
              {segments.length === 0 && <div className="settings-note">Grabbed pages appear here.</div>}
              {segments.map((s, i) => (
                <div key={s.id} className="grab-shot">
                  <span className="grab-shot-n">{i + 1}</span>
                  <img src={s.image} alt={`page ${i + 1}`} />
                  <button className="grab-shot-x" onClick={() => remove(s.id)} title="Remove">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'review' && editingSeg && (
        <RegionEditor
          image={editingSeg.image}
          regions={editingSeg.regions}
          onApply={applyRegions}
          onClose={() => setEditingId(null)}
          onSaveTemplate={saveTemplate}
        />
      )}

      {step === 'review' && !editingSeg && (
        <div className="grab-review">
          <div className="grab-ocr-bar">
            <label>Layout (all pages):
              <select value={docLayout} onChange={(e) => setDocLayout(e.target.value)}>
                {layoutNames.map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label>Invert:
              <select value={ocrInvert} onChange={(e) => setOcrInvert(e.target.value)}>
                <option value="auto">Auto</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label>Contrast
              <input type="range" min={1} max={2.6} step={0.1} value={ocrContrast} onChange={(e) => setOcrContrast(Number(e.target.value))} />
            </label>
            <label title="Binarize using known background/text colours (best for coloured pages)">
              <input type="checkbox" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} /> Colours
            </label>
            {useColors && (
              <>
                <label>BG <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} /></label>
                <label>Text <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} /></label>
              </>
            )}
            <label title="Stored hint only — the OCR engine can't select a font">Font <input type="text" value={fontHint} onChange={(e) => setFontHint(e.target.value)} placeholder="(hint)" style={{ width: 90 }} /></label>
          </div>

          {segments.length === 0 && <p>No captures yet. Go back to add some.</p>}
          {segments.map((s, i) => (
            <div key={s.id} className="grab-seg">
              <img src={s.image} alt={`capture ${i + 1}`} className="grab-thumb" />
              <div className="grab-seg-main">
                <div className="grab-seg-ctl">
                  <label>Layout:
                    <select
                      value={s.regions ? '(custom)' : (s.layout || '(default)')}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '(custom)') return;
                        patchSeg(s.id, { layout: v === '(default)' ? null : v, regions: null });
                      }}
                    >
                      <option value="(default)">(use default)</option>
                      {s.regions && <option value="(custom)">(custom {s.regions.length})</option>}
                      {layoutNames.map((n) => <option key={n}>{n}</option>)}
                    </select>
                  </label>
                  <button onClick={() => setEditingId(s.id)}>Draw regions{s.regions ? ` (${s.regions.length})` : ''}</button>
                  <label>OCR:
                    <select value={s.ocrMode} onChange={(e) => patchSeg(s.id, { ocrMode: e.target.value })}>
                      <option value="default">Default</option>
                      <option value="exempt">Exempt (raw)</option>
                      <option value="invert">Invert</option>
                    </select>
                  </label>
                </div>
                <textarea value={s.text} placeholder="(not recognized yet)" onChange={(e) => setText(s.id, e.target.value)} rows={4} />
              </div>
              <div className="grab-seg-actions">
                <button title="Move up" onClick={() => move(i, -1)}>↑</button>
                <button title="Move down" onClick={() => move(i, 1)}>↓</button>
                <button title="Remove" onClick={() => remove(s.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmClose && (
        <div className="grab-close-confirm">
          <div className="gcc-box">
            <h3>Close Grab Text?</h3>
            <p>You have <b>{segments.length}</b> captured page(s) that haven’t been opened yet.</p>
            <div className="gcc-actions">
              <button onClick={() => setConfirmClose(false)}>← Keep working</button>
              <button className="toggle-on" onClick={saveAndClose}>💾 Save session &amp; close</button>
              <button className="gcc-discard" onClick={discardAndClose}>🗑 Discard &amp; close</button>
            </div>
            <p className="settings-note">Saved sessions can be resumed next time from the Grab Text window.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
