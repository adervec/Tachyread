import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  displayCaptureSupported,
  startDisplayCapture,
  cameraCaptureSupported,
  startCameraCapture,
  stopCapture,
  captureFrame,
  canvasToDataUrl,
  frameSignature,
  signatureDiff,
  signatureBandDiff,
  signatureBandVariance,
} from '../features/screenCapture.js';
import { recognizeImageEx, ocrSupported, loadImage, glyphCategory } from '../features/ocr.js';
import { buildGrabbedDoc } from '../document/grab.js';
import { playGrabClick } from '../features/clickSound.js';
import { speechRecognitionSupported } from '../features/speechRecognition.js';
import { saveTextToFile } from '../features/fileSystem.js';
import { saveGrabbed, allGrabbed, deleteGrabbed, saveGrabSession, allGrabSessions, deleteGrabSession } from '../state/storage.js';

const uid = () => Math.random().toString(36).slice(2);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const DUP_THRESHOLD = 6;
const STILL_EPS = 2.5; // frame-to-frame diff below this = the page is holding still (settled)
const BLANK_STD = 8;   // signature std-dev below this = a blank / near-uniform page
const BAND_EPS = 11;   // a single row-band changing more than this = a real (often edge-localised) change
                       // that the global mean would dilute; below it is sub-cell noise (cursor, jitter)
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
// Downscale a dropped sample to a small dataURL so a profile stays light in stored settings.
function shrinkSample(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 72;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Editor for OCR profiles: a profile is a set of characters, each with user-supplied image samples.
// It drives a tesseract character whitelist + a sample-matching correction pass (see features/ocr.js).
const CAT_LABEL = { alpha: 'A–Z', num: '0–9', punct: '.,!?', symbol: '§' };
function OcrProfileEditor({ profiles, onSave, onClose }) {
  const [list, setList] = useState(() => profiles.map((p) => ({ ...p, glyphs: (p.glyphs || []).map((g) => ({ ...g, samples: [...(g.samples || [])] })) })));
  const [sel, setSel] = useState(profiles[0]?.id || null);
  const cur = list.find((p) => p.id === sel) || null;
  const patchCur = (patch) => setList((l) => l.map((p) => (p.id === sel ? { ...p, ...patch } : p)));
  const patchGlyph = (gi, patch) => patchCur({ glyphs: cur.glyphs.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });

  function addProfile() {
    const id = uid();
    setList((l) => [...l, { id, name: `Profile ${l.length + 1}`, glyphs: [], whitelist: true, templates: true, confThreshold: 70, matchThreshold: 0.6 }]);
    setSel(id);
  }
  function deleteProfile() { setList((l) => l.filter((p) => p.id !== sel)); setSel(null); }
  function addGlyph() { patchCur({ glyphs: [...cur.glyphs, { ch: '', cat: 'alpha', samples: [] }] }); }
  function setChar(gi, ch) { const c = ch.slice(0, 1); patchGlyph(gi, { ch: c, cat: c ? glyphCategory(c) : 'alpha' }); }
  function removeGlyph(gi) { patchCur({ glyphs: cur.glyphs.filter((_, i) => i !== gi) }); }
  async function addSamples(gi, files) {
    const urls = [];
    for (const f of files) { if (!f.type.startsWith('image/')) continue; try { urls.push(await shrinkSample(f)); } catch { /* skip */ } }
    if (urls.length) patchGlyph(gi, { samples: [...cur.glyphs[gi].samples, ...urls] });
  }
  function removeSample(gi, si) { patchGlyph(gi, { samples: cur.glyphs[gi].samples.filter((_, i) => i !== si) }); }

  return (
    <div className="grab-close-confirm">
      <div className="gcc-box ocr-prof-box">
        <h3>OCR profiles — teach the recognizer your characters</h3>
        <p className="settings-note">Add cropped image samples of the characters in your source. Priority order: letters → digits → punctuation → symbols. A profile constrains OCR to exactly these characters and fixes shaky glyphs by matching your samples.</p>
        <div className="ocr-prof-bar">
          <select value={sel || ''} onChange={(e) => setSel(e.target.value || null)}>
            <option value="">— choose a profile —</option>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addProfile}>+ New profile</button>
          {cur && <button className="gcc-discard" onClick={deleteProfile}>Delete profile</button>}
        </div>
        {cur && (
          <div className="ocr-prof-edit">
            <div className="ocr-prof-meta">
              <label>Name <input value={cur.name} onChange={(e) => patchCur({ name: e.target.value })} /></label>
              <label title="Constrain OCR output to exactly these characters"><input type="checkbox" checked={cur.whitelist !== false} onChange={(e) => patchCur({ whitelist: e.target.checked })} /> Whitelist</label>
              <label title="Correct low-confidence glyphs by matching your samples"><input type="checkbox" checked={cur.templates !== false} onChange={(e) => patchCur({ templates: e.target.checked })} /> Sample match</label>
              <label title="Only correct glyphs the engine is less sure about than this">conf&lt; <input type="number" min={0} max={100} value={cur.confThreshold ?? 70} onChange={(e) => patchCur({ confThreshold: Number(e.target.value) })} style={{ width: 48 }} /></label>
              <label title="How close a sample must match to substitute (0–1)">match≥ <input type="number" min={0.3} max={0.95} step={0.05} value={cur.matchThreshold ?? 0.6} onChange={(e) => patchCur({ matchThreshold: Number(e.target.value) })} style={{ width: 52 }} /></label>
            </div>
            <div className="ocr-prof-glyphs">
              {cur.glyphs.length === 0 && <div className="settings-note" style={{ margin: 0 }}>No characters yet — add the ones OCR gets wrong.</div>}
              {cur.glyphs.map((g, gi) => (
                <div key={gi} className="ocr-prof-glyph">
                  <input className="opg-char" value={g.ch} maxLength={1} placeholder="?" onChange={(e) => setChar(gi, e.target.value)} />
                  <span className="opg-cat" title={g.cat}>{CAT_LABEL[g.cat] || g.cat}</span>
                  <div className="opg-samples">
                    {g.samples.map((s, si) => (
                      <span key={si} className="opg-sample"><img src={s} alt="" /><button onClick={() => removeSample(gi, si)} title="Remove sample">×</button></span>
                    ))}
                    <label className="opg-add" title="Add sample image(s) of this character">+<input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addSamples(gi, [...e.target.files])} /></label>
                  </div>
                  <button className="opg-del" onClick={() => removeGlyph(gi)} title="Remove character">🗑</button>
                </div>
              ))}
              <button onClick={addGlyph}>+ Add character</button>
            </div>
          </div>
        )}
        <div className="gcc-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="toggle-on" onClick={() => onSave(list)}>Save profiles</button>
        </div>
      </div>
    </div>
  );
}

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
  const [streamKind, setStreamKind] = useState(null); // 'screen' | 'camera'
  const [cameraFacing, setCameraFacing] = useState('environment'); // rear camera by default (document cam)
  const [crop, setCrop] = useState(null);
  const drawRef = useRef(null);
  const [autoCount, setAutoCount] = useState(5);
  const [autoInterval, setAutoInterval] = useState(2.5);
  const [stopDupes, setStopDupes] = useState(2);
  const autoRef = useRef({ running: false });
  const [autoRunning, setAutoRunning] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [autoOcr, setAutoOcr] = useState(true); // recognize each page in the background the moment it's captured

  // Advanced "watch" mode — continuously grab each settled new page; skip blanks/loading screens.
  const [captureMode, setCaptureMode] = useState('timed'); // 'timed' | 'watch'
  const [watchDwell, setWatchDwell] = useState(0.6); // seconds a page must hold still before it's grabbed
  const [watching, setWatching] = useState(false);
  const watchRef = useRef({ running: false });
  const skipSigsRef = useRef([]); // signatures of frames to ignore (loading screens / blanks the user marked)
  const [skipCount, setSkipCount] = useState(0);

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
  const [lightbox, setLightbox] = useState(null); // image data-URL shown full-screen, or null
  const [recent, setRecent] = useState([]);
  const [ocrProfileId, setOcrProfileId] = useState(null);
  const [editingProfiles, setEditingProfiles] = useState(false);

  const savedTemplates = state.global.ocrTemplates || [];
  const ocrProfiles = state.global.ocrProfiles || [];
  const activeProfile = ocrProfiles.find((p) => p.id === ocrProfileId) || null;
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

  // Live mirrors so the background OCR worker (a long-running async chain) always reads the latest
  // segments, settings, and toggle rather than the values captured when it was queued.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const autoOcrRef = useRef(autoOcr);
  autoOcrRef.current = autoOcr;
  const ocrParamsRef = useRef(null);
  ocrParamsRef.current = { segRegions, segConfig, activeProfile };
  const ocrChainRef = useRef(Promise.resolve()); // serializes background OCR (one page at a time)

  // Recognize one page in the background. Chained so pages OCR one at a time while the user keeps
  // capturing; result is patched back by id and never clobbers text the user has already edited.
  function ocrSeg(seg) {
    ocrChainRef.current = ocrChainRef.current
      .then(async () => {
        if (!seg || !ocrSupported()) return;
        const params = ocrParamsRef.current;
        patchSeg(seg.id, { ocrStatus: 'doing' });
        try {
          const { text } = await recognizeImageEx(seg.image, {
            regions: params.segRegions(seg),
            config: params.segConfig(seg),
            profile: params.activeProfile,
          });
          setSegments((arr) => arr.map((s) => (s.id === seg.id ? { ...s, text: s.text || text, ocrStatus: 'done' } : s)));
        } catch {
          patchSeg(seg.id, { ocrStatus: 'error' });
        }
      })
      .catch(() => {});
  }

  // Add a captured page, kicking off background OCR immediately when the option is on.
  function addSeg(image) {
    const seg = newSeg(image);
    setSegments((arr) => [...arr, seg]);
    if (autoOcrRef.current && ocrSupported()) ocrSeg(seg);
    return seg;
  }

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, step]);

  useEffect(() => () => stopCapture(stream), [stream]);

  // Stop the watch loop when leaving the capture step.
  useEffect(() => { if (step !== 'screen' && watchRef.current.running) { watchRef.current.running = false; setWatching(false); } }, [step]);

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
    if (!v || !crop || !v.videoWidth || !v.videoHeight) return null;
    // The <video> uses object-fit: contain, so the frame is letter/pillar-boxed inside the
    // element. crop.* are fractions of the *element* box; map them onto the actual displayed
    // content rect (not the whole element) before scaling to video pixels — otherwise a
    // selection captures a narrower/shorter area than what was drawn.
    const elW = v.clientWidth, elH = v.clientHeight;
    if (!elW || !elH) return null;
    const scale = Math.min(elW / v.videoWidth, elH / v.videoHeight); // object-fit: contain
    const contentW = v.videoWidth * scale;
    const contentH = v.videoHeight * scale;
    const offX = (elW - contentW) / 2;
    const offY = (elH - contentH) / 2;
    const fx = Math.max(0, Math.min(1, (crop.fx * elW - offX) / contentW));
    const fy = Math.max(0, Math.min(1, (crop.fy * elH - offY) / contentH));
    const fw = Math.max(0, Math.min(1 - fx, (crop.fw * elW) / contentW));
    const fh = Math.max(0, Math.min(1 - fy, (crop.fh * elH) / contentH));
    if (fw <= 0 || fh <= 0) return null;
    return { x: fx * v.videoWidth, y: fy * v.videoHeight, w: fw * v.videoWidth, h: fh * v.videoHeight };
  }

  async function startScreen() {
    if (!displayCaptureSupported()) { setMsg('Screen capture is not supported in this browser.'); return; }
    try {
      const { stream: s } = await startDisplayCapture();
      setStream(s);
      setStreamKind('screen');
      setStep('screen');
      setMsg('Sharing started. Optionally drag a selection rectangle, then Grab.');
      s.getVideoTracks()[0].addEventListener('ended', () => setMsg('Screen sharing ended.'));
    } catch (e) {
      setMsg('Screen capture cancelled: ' + (e?.message || e));
    }
  }

  // Document camera — point a device camera at a physical page. Reuses the whole capture step
  // (grab/crop/auto/watch/voice/background-OCR); only the video source differs.
  async function startCamera(facing = cameraFacing) {
    if (!cameraCaptureSupported()) { setMsg('Camera capture is not supported in this browser.'); return; }
    try {
      stopCapture(stream); // free any current stream first (a camera can't open twice)
      const { stream: s } = await startCameraCapture(facing);
      setStream(s);
      setStreamKind('camera');
      setCameraFacing(facing);
      setStep('screen');
      setMsg('Camera ready — fill the frame with a page, hold steady, then Grab. Draw a region to crop.');
      s.getVideoTracks()[0].addEventListener('ended', () => setMsg('Camera stopped.'));
    } catch (e) {
      setMsg('Could not start the camera: ' + (e?.message || e) + ' — allow camera access and try again.');
    }
  }
  function flipCamera() {
    startCamera(cameraFacing === 'environment' ? 'user' : 'environment');
  }

  const newSeg = (image) => ({ id: uid(), image, text: '', layout: null, regions: null, ocrMode: 'default', ocrStatus: null, flagged: false });

  function grabOnce() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    playGrabClick();
    const canvas = captureFrame(v, cropVideoPx());
    // If the watcher is running, mark this frame as the last-captured page so it doesn't grab the
    // same one again a moment later.
    if (watchRef.current.running) {
      const sig = frameSignature(canvas);
      watchRef.current.lastCapSig = sig;
      watchRef.current.decidedSig = sig;
    }
    addSeg(canvasToDataUrl(canvas));
    setMsg(`Captured ${segmentsRef.current.length + 1} page(s).`);
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
      if (lastSig && signatureDiff(sig, lastSig) < DUP_THRESHOLD && signatureBandDiff(sig, lastSig) < BAND_EPS) {
        consec++;
        setMsg(`Grab ${i + 1}/${count}: duplicate page (${consec} in a row)`);
        if (limit > 0 && consec >= limit) { setMsg(`Auto-finished — ${consec} consecutive duplicates.`); break; }
      } else {
        lastSig = sig; consec = 0; captured++;
        playGrabClick();
        addSeg(canvasToDataUrl(canvas));
        setMsg(`Auto-grab: captured ${captured} page(s)… (advance the page now)`);
      }
      if (i < count - 1 && autoRef.current.running) await delay(interval);
    }
    autoRef.current.running = false;
    setAutoRunning(false);
    setMsg(`Auto-grab done — ${captured} page(s).`);
  }

  function abortAuto() { autoRef.current.running = false; setAutoRunning(false); }

  // Continuous "watch" capture: poll the shared region; when a NEW page settles (holds still for the
  // dwell) and isn't blank / a marked loading screen / the page already grabbed, capture it once. The
  // user just pages through — page-turn animations, blank flashes and loading screens are skipped.
  async function runWatch() {
    watchRef.current.running = true;
    setWatching(true);
    setMsg('👁 Watching — page through your document; each new page grabs itself.');
    const dwellMs = Math.max(150, (Number(watchDwell) || 0.6) * 1000);
    const POLL = 250;
    let holdSig = null, holdStart = 0, handled = false;
    // lastCapSig / decidedSig live on watchRef so a manual "Grab page" during watch can update them
    // and stop the watcher from re-grabbing that same page.
    watchRef.current.lastCapSig = null;
    watchRef.current.decidedSig = null;
    let captured = 0, skipped = 0;
    while (watchRef.current.running) {
      const v = videoRef.current;
      if (!v || !v.videoWidth) { await delay(POLL); continue; }
      const canvas = captureFrame(v, cropVideoPx());
      const sig = frameSignature(canvas);
      const now = Date.now();
      // A transition is whole-frame motion (global diff) OR — once we've already decided on a page —
      // a strong change in any single row band vs. that decided frame. The band check is what catches
      // a NEW page whose only difference is text along the top/bottom edge: it barely moves the global
      // mean, so without it we'd stay stuck on the previous page and never grab the new one.
      const decidedSig = watchRef.current.decidedSig;
      const lastCapSig = watchRef.current.lastCapSig;
      const moved = !holdSig || signatureDiff(sig, holdSig) > STILL_EPS;
      const newEdge = handled && decidedSig &&
        (signatureDiff(sig, decidedSig) > STILL_EPS || signatureBandDiff(sig, decidedSig) > BAND_EPS);
      if (moved || newEdge) {
        holdSig = sig; holdStart = now; handled = false; // (re)start the settle timer
      } else if (!handled && now - holdStart >= dwellMs) {
        handled = true; watchRef.current.decidedSig = sig; // the page settled — decide once
        if (signatureBandVariance(sig) < BLANK_STD) {
          skipped++; setMsg(`👁 Skipped a blank page (${captured} grabbed · ${skipped} skipped).`);
        } else if (skipSigsRef.current.some((s) => signatureDiff(sig, s) < DUP_THRESHOLD)) {
          skipped++; setMsg(`👁 Skipped a loading / ignored screen (${captured} grabbed · ${skipped} skipped).`);
        } else if (lastCapSig && signatureDiff(sig, lastCapSig) < DUP_THRESHOLD && signatureBandDiff(sig, lastCapSig) < BAND_EPS) {
          /* same page already grabbed — keep watching for the next one */
        } else {
          watchRef.current.lastCapSig = sig; captured++;
          playGrabClick();
          addSeg(canvasToDataUrl(canvas));
          setMsg(`👁 Grabbed page ${captured} — advance to the next (${skipped} skipped).`);
        }
      }
      await delay(POLL);
    }
    setWatching(false);
    setMsg(`👁 Watch stopped — ${captured} page(s) grabbed, ${skipped} skipped.`);
  }
  function stopWatch() { watchRef.current.running = false; setWatching(false); }
  // Mark the frame currently on the preview as a pattern to ignore (e.g. a loading spinner / splash).
  function markSkipPattern() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setMsg('Nothing on the preview to ignore yet.'); return; }
    const sig = frameSignature(captureFrame(v, cropVideoPx()));
    skipSigsRef.current = [...skipSigsRef.current, sig];
    setSkipCount(skipSigsRef.current.length);
    setMsg(`👁 Will skip frames like this one — ${skipSigsRef.current.length} ignore pattern(s). Use for loading screens.`);
  }
  function clearSkipPatterns() { skipSigsRef.current = []; setSkipCount(0); setMsg('Cleared ignore patterns.'); }

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
        addSeg(canvasToDataUrl(canvas));
      } catch { /* skip bad image */ }
    }
    setStep('review');
  }

  // ── Review actions ──
  // Recognize a specific set of pages (by id), serially, marking each one in-progress so the review
  // list can show exactly which page is being worked on. A successful scan clears that page's re-scan
  // flag. Shared by "recognize remaining/flagged" and "re-OCR all".
  async function runOcrOver(ids) {
    if (!ocrSupported()) { setMsg('OCR is not supported in this browser.'); return; }
    if (!ids.length) { setMsg('Nothing to recognize.'); return; }
    setOcrBusy(true);
    await ocrChainRef.current; // let any in-flight background OCR finish so we never run two at once
    for (let i = 0; i < ids.length; i++) {
      const seg = segmentsRef.current.find((s) => s.id === ids[i]);
      if (!seg) continue;
      patchSeg(seg.id, { ocrStatus: 'doing' });
      setMsg(`Recognizing page ${i + 1} of ${ids.length}… (first run downloads the OCR engine)`);
      try {
        const { text } = await recognizeImageEx(seg.image, { regions: segRegions(seg), config: segConfig(seg), profile: activeProfile });
        setSegments((arr) => arr.map((s) => (s.id === seg.id ? { ...s, text, ocrStatus: 'done', flagged: false } : s)));
      } catch (e) {
        patchSeg(seg.id, { ocrStatus: 'error' });
        setMsg('OCR error on a page: ' + (e?.message || e));
      }
    }
    setOcrBusy(false);
    setMsg('Recognition complete — review and edit the text, then open it.');
  }
  // Re-OCR everything (e.g. after changing OCR settings) — overwrites existing text.
  function recognizeAll() { runOcrOver(segmentsRef.current.map((s) => s.id)); }
  // Recognize only what needs it: pages with no text yet, pages that errored, and pages flagged for
  // re-scan. The everyday button — it won't clobber text you've already edited.
  function recognizeNeeded() {
    const ids = segmentsRef.current
      .filter((s) => s.flagged || s.ocrStatus === 'error' || !(s.text || '').trim())
      .map((s) => s.id);
    if (!ids.length) { setMsg('Every page is recognized. Flag a page (🚩) to re-scan it.'); return; }
    runOcrOver(ids);
  }
  function toggleFlag(id) { setSegments((arr) => arr.map((s) => (s.id === id ? { ...s, flagged: !s.flagged } : s))); }

  // Save the recognized text to an external file. Where supported this opens a native Save dialog
  // (pick the folder AND the name); otherwise it downloads. Pages are separated by a blank line.
  function joinText(segs) {
    return (segs || []).map((s) => (s.text || '').trim()).filter(Boolean).join('\n\n');
  }
  async function saveToFile() {
    const text = joinText(segmentsRef.current);
    if (!text) { setMsg('No recognized text yet — recognize the pages first.'); return; }
    const name = `grab-${new Date().toISOString().slice(0, 10)}.txt`;
    const res = await saveTextToFile(text, name);
    setMsg(res.canceled ? 'Save canceled.' : `Saved ${res.name}${res.method === 'download' ? ' to your downloads' : ''}.`);
  }
  async function saveRecentToFile(r) {
    const text = joinText(r.segments);
    if (!text) { setMsg('That saved grab has no recognized text to export.'); return; }
    const base = (r.name || 'grab').replace(/\.[^.]+$/, '');
    const res = await saveTextToFile(text, `${base}.txt`);
    setMsg(res.canceled ? 'Save canceled.' : `Saved ${res.name}${res.method === 'download' ? ' to your downloads' : ''}.`);
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
  function saveProfiles(updated) {
    updateGlobal({ ocrProfiles: updated });
    if (!updated.some((p) => p.id === ocrProfileId)) setOcrProfileId(null);
    setEditingProfiles(false);
    setMsg(`Saved ${updated.length} OCR profile(s).`);
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
    watchRef.current.running = false;
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
  const ocrDoneCount = segments.filter((s) => (s.text || '').trim()).length;
  const flaggedCount = segments.filter((s) => s.flagged).length;
  const scanningSeg = segments.find((s) => s.ocrStatus === 'doing');
  const needCount = segments.filter((s) => s.flagged || s.ocrStatus === 'error' || !(s.text || '').trim()).length;
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
              <span className="settings-note" style={{ margin: '0 4px 0 0' }}>
                {ocrBusy && scanningSeg
                  ? `⏳ recognizing page ${segments.indexOf(scanningSeg) + 1}/${segments.length}…`
                  : `${ocrDoneCount}/${segments.length} recognized${flaggedCount ? ` · ${flaggedCount} flagged` : ''}`}
              </span>
              <button
                onClick={recognizeNeeded}
                disabled={ocrBusy || !needCount}
                title="Recognize pages with no text yet, pages that errored, and pages flagged for re-scan"
              >
                {ocrBusy ? 'Recognizing…' : needCount ? `Recognize ${needCount} page${needCount > 1 ? 's' : ''}` : 'All recognized'}
              </button>
              <button onClick={recognizeAll} disabled={ocrBusy || !segments.length} title="Re-OCR every page (overwrites existing text)">Re-OCR all</button>
              <button onClick={saveToFile} disabled={!hasText} title="Save the recognized text to a file — pick the name and location">💾 Save to file…</button>
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
          <p className="settings-note">⚠ You are responsible for respecting the copyright of anything you capture. Only grab works you own or are permitted to copy.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <button style={{ flex: '1 1 180px', padding: '16px' }} onClick={startScreen} disabled={!displayCaptureSupported()}>
              🖥️ Capture screen / window
              <div className="settings-note" style={{ margin: '6px 0 0' }}>Share a screen, draw a region, grab pages by button, timer, or voice.</div>
            </button>
            <button style={{ flex: '1 1 180px', padding: '16px' }} onClick={() => startCamera()} disabled={!cameraCaptureSupported()}>
              📷 Document camera
              <div className="settings-note" style={{ margin: '6px 0 0' }}>Point your camera at a physical page and snap pages (great on a phone).</div>
            </button>
            <label style={{ flex: '1 1 180px', padding: '16px', textAlign: 'center', cursor: 'pointer' }} className="grab-upload-btn">
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
                  <button onClick={() => saveRecentToFile(r)} title="Save this grab's text to a file">💾</button>
                  <button className="grab-trash" onClick={() => removeRecent(r)} title="Delete saved grab">🗑</button>
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
              <button onClick={grabOnce} disabled={autoRunning} title={watching ? 'Force-capture the current frame even while watching' : 'Capture the current frame'}>📸 Grab page</button>
              {streamKind === 'camera' && (
                <button onClick={flipCamera} disabled={autoRunning || watching} title="Switch between the front and rear camera">🔄 Flip camera</button>
              )}
              <button onClick={() => setCrop(null)} disabled={!crop}>Clear region</button>
              <label className="inline-check" title="Recognize each page in the background the moment it's captured, so the text is ready by the time you finish">
                <input type="checkbox" checked={autoOcr} onChange={(e) => setAutoOcr(e.target.checked)} />
                OCR in background
              </label>
              <span className="grab-sep" />
              <label>Mode:
                <select value={captureMode} onChange={(e) => setCaptureMode(e.target.value)} disabled={autoRunning || watching}>
                  <option value="timed">Auto (timed)</option>
                  <option value="watch">Watch (continuous)</option>
                </select>
              </label>
              {captureMode === 'timed' ? (
                <>
                  <label>Auto: <input type="number" min={1} max={200} value={autoCount} onChange={(e) => setAutoCount(e.target.value)} style={{ width: 48 }} /> grabs</label>
                  <label>every <input type="number" min={0.3} step={0.5} value={autoInterval} onChange={(e) => setAutoInterval(e.target.value)} style={{ width: 48 }} /> s</label>
                  <label>stop after <input type="number" min={0} value={stopDupes} onChange={(e) => setStopDupes(e.target.value)} style={{ width: 40 }} /> dupes</label>
                  {autoRunning ? <button onClick={abortAuto}>Abort</button> : <button onClick={runAuto}>▶ Auto-grab</button>}
                </>
              ) : (
                <>
                  <label title="How long a page must hold still before it's grabbed — skips page-turn animations and scrolling">settle <input type="number" min={0.2} step={0.1} value={watchDwell} onChange={(e) => setWatchDwell(e.target.value)} style={{ width: 46 }} /> s</label>
                  {watching
                    ? <button onClick={stopWatch}>■ Stop watching</button>
                    : <button className="toggle-on" onClick={runWatch}>👁 Start watching</button>}
                  <button onClick={markSkipPattern} title="Mark the frame on screen now as a loading/blank pattern to ignore">🚫 Ignore this frame</button>
                  {skipCount > 0 && <button onClick={clearSkipPatterns} title="Clear ignore patterns">clear {skipCount} ignored</button>}
                </>
              )}
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
            <div className="grab-shots-head">
              {segments.length} captured
              {autoOcr && segments.length > 0 && (
                <span className="settings-note" style={{ margin: '0 0 0 6px' }}>
                  · {segments.filter((s) => s.text).length}/{segments.length} OCR&rsquo;d
                </span>
              )}
            </div>
            <div className="grab-shots" ref={shotsRef}>
              {segments.length === 0 && <div className="settings-note">Grabbed pages appear here.</div>}
              {segments.map((s, i) => (
                <div key={s.id} className="grab-shot">
                  <span className="grab-shot-n">{i + 1}</span>
                  <img src={s.image} alt={`page ${i + 1}`} />
                  {s.ocrStatus === 'doing' && <span className="grab-shot-ocr" title="Recognizing…">⏳</span>}
                  {s.ocrStatus === 'done' && s.text && <span className="grab-shot-ocr done" title="Recognized">✓</span>}
                  {s.ocrStatus === 'error' && <span className="grab-shot-ocr err" title="OCR failed — recognize again on the review step">⚠</span>}
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
            <label title="Use a saved OCR profile — character whitelist + sample matching">Profile
              <select value={ocrProfileId || ''} onChange={(e) => setOcrProfileId(e.target.value || null)}>
                <option value="">None</option>
                {ocrProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button onClick={() => setEditingProfiles(true)} title="Create or edit OCR profiles from character samples">Edit profiles…</button>
          </div>

          {segments.length === 0 && <p>No captures yet. Go back to add some.</p>}
          {segments.map((s, i) => (
            <div key={s.id} className={`grab-seg${s.flagged ? ' flagged' : ''}`}>
              <img src={s.image} alt={`capture ${i + 1}`} className="grab-thumb" title="Click to enlarge" onClick={() => setLightbox(s.image)} />
              <div className="grab-seg-main">
                <div className="grab-seg-ctl">
                  {s.ocrStatus === 'doing' ? (
                    <span className="grab-seg-status doing">⏳ scanning…</span>
                  ) : s.ocrStatus === 'error' ? (
                    <span className="grab-seg-status err">⚠ failed</span>
                  ) : (s.text || '').trim() ? (
                    <span className="grab-seg-status done">✓ recognized</span>
                  ) : (
                    <span className="grab-seg-status none">○ not recognized</span>
                  )}
                  {s.flagged && <span className="grab-seg-status flag">🚩 re-scan</span>}
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
                <button
                  className={s.flagged ? 'toggle-on' : ''}
                  title={s.flagged ? 'Unflag (cancel re-scan)' : 'Flag this page to re-scan'}
                  onClick={() => toggleFlag(s.id)}
                >
                  🚩
                </button>
                <button className="grab-trash" title="Remove" onClick={() => remove(s.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingProfiles && (
        <OcrProfileEditor profiles={ocrProfiles} onSave={saveProfiles} onClose={() => setEditingProfiles(false)} />
      )}

      {lightbox && (
        <div className="grab-lightbox" title="Click to close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="enlarged page" />
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
