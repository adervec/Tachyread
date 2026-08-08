import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getStream } from '../features/audioRecorder.js';
import { encodeWav } from '../features/audiobookExport.js';
import { addAudioClip } from '../state/storage.js';
import {
  rmsOf, adaptiveThreshold, cleanTake, expectedMs, shouldAdvance, sessionQueue,
} from '../features/readThrough.js';

// Read the whole book aloud in ONE sitting: a single mic session, chunk text on screen, and the
// app does the bookkeeping — trims each take to the speech, shortens mid-take dead air, saves the
// clip against the chunk, and moves to the next one. Pausing at the end of a chunk advances by
// itself (auto-advance); Space always works; breaks discard their audio entirely.
//
// Capture is a ScriptProcessorNode pulling raw PCM. ponytail: deprecated but universal and one
// line to set up — an AudioWorklet needs a separate module file; switch if glitches are ever heard.
const AC = () => new (window.AudioContext || window.webkitAudioContext)();
const BLOCK = 4096;
const MAX_TAKE_MIN = 15; // runaway guard: a forgotten mic shouldn't eat RAM forever

function micErr(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone blocked — allow mic access for this site, then Start again.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No microphone found.';
  if (n === 'NotReadableError') return 'The microphone is busy in another app. Close it and try again.';
  return 'Could not open the microphone: ' + (e?.message || e);
}

export default function ReadThroughWizard({ checksum, chunks, isCovered, onClose, onDone }) {
  const [phase, setPhase] = useState('setup'); // setup | requesting | reading | done
  const [err, setErr] = useState('');
  const [onlyUncovered, setOnlyUncovered] = useState(true);
  const [advanceMode, setAdvanceMode] = useState('relaxed'); // off | relaxed | eager
  const [qi, setQi] = useState(0);
  const [queue, setQueue] = useState([]);
  const [saved, setSaved] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [onBreak, setOnBreak] = useState(false);
  const [speaking, setSpeaking] = useState(false); // low-rate UI mirror of the live VAD

  const ctxRef = useRef(null), srcRef = useRef(null), procRef = useRef(null);
  const meterRef = useRef(null);
  const takeRef = useRef([]);           // Float32Array blocks of the CURRENT take
  const rmsHistRef = useRef([]);        // recent block RMS values → adaptive threshold
  const lastSpeechAtRef = useRef(0);    // ms timestamp of the last block over threshold
  const speechMsRef = useRef(0);        // accumulated speech in this take
  const committingRef = useRef(false);
  const liveRef = useRef({});           // advanceMode/onBreak/queue/qi mirrored for the audio callback
  liveRef.current = { advanceMode, onBreak, queue, qi };

  const uncoveredCount = useMemo(() => sessionQueue(chunks, isCovered, true).length, [chunks, isCovered]);
  const chunk = queue.length && qi < queue.length ? chunks[queue[qi]] : null;
  const nextChunk = queue.length && qi + 1 < queue.length ? chunks[queue[qi + 1]] : null;

  function resetTake() {
    takeRef.current = [];
    speechMsRef.current = 0;
    lastSpeechAtRef.current = Date.now(); // a fresh take starts its silence clock now
  }

  async function start() {
    setErr('');
    const q = sessionQueue(chunks, isCovered, onlyUncovered);
    if (!q.length) { setErr('Nothing to read — every chunk already has audio.'); return; }
    setPhase('requesting');
    let stream;
    try { stream = await getStream(); } catch (e) { setPhase('setup'); setErr(micErr(e)); return; }
    const ctx = AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(BLOCK, 1, 1);
    proc.onaudioprocess = (e) => onBlock(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    src.connect(proc);
    proc.connect(ctx.destination); // required for the processor to run; it outputs silence
    ctxRef.current = ctx; srcRef.current = src; procRef.current = proc;
    setQueue(q); setQi(0); setSaved(0); setSkipped(0); setOnBreak(false);
    resetTake();
    setPhase('reading');
  }

  function onBlock(data, sampleRate) {
    const live = liveRef.current;
    const rms = rmsOf(data);
    if (meterRef.current) meterRef.current.style.width = `${Math.min(100, rms * 220)}%`;
    rmsHistRef.current.push(rms);
    if (rmsHistRef.current.length > 400) rmsHistRef.current.shift();
    if (live.onBreak || committingRef.current) return; // break audio is nobody's business — dropped
    const blockMs = (data.length / sampleRate) * 1000;
    // A take longer than the guard means the mic was left running — go on break, keep what we have.
    if (takeRef.current.length * BLOCK > sampleRate * 60 * MAX_TAKE_MIN) { setOnBreak(true); return; }
    takeRef.current.push(new Float32Array(data)); // copy — the engine reuses the buffer
    const th = adaptiveThreshold(rmsHistRef.current);
    if (rms >= th) { lastSpeechAtRef.current = Date.now(); speechMsRef.current += blockMs; }
    const ch = live.queue.length ? chunksAt(live) : null;
    if (ch && shouldAdvance({
      silenceMs: Date.now() - lastSpeechAtRef.current,
      speechMs: speechMsRef.current,
      expectedMs: expectedMs(wordCountOf(ch)),
      mode: live.advanceMode,
    })) commit();
  }
  const chunksAt = (live) => (live.qi < live.queue.length ? chunks[live.queue[live.qi]] : null);
  const wordCountOf = (c) => (c.endWordIndex >= 0 && c.startWordIndex >= 0 ? c.endWordIndex - c.startWordIndex + 1 : (c.text || '').split(/\s+/).length);

  // Save the current take against the current chunk, then advance. Serialised: an auto-advance
  // firing during a manual Space (or vice versa) must not double-save.
  async function commit() {
    if (committingRef.current) return;
    const live = liveRef.current;
    const ch = chunksAt(live);
    if (!ch) return;
    committingRef.current = true;
    const blocks = takeRef.current;
    resetTake(); // capture continues into the next take while we encode/save this one
    try {
      const total = blocks.reduce((a, b) => a + b.length, 0);
      const samples = new Float32Array(total);
      let o = 0;
      for (const b of blocks) { samples.set(b, o); o += b.length; }
      const sr = ctxRef.current?.sampleRate || 48000;
      const clean = cleanTake(samples, sr, { threshold: adaptiveThreshold(rmsHistRef.current), maxPauseMs: 700 });
      if (clean) {
        const durationMs = Math.round((clean.length / sr) * 1000);
        const blob = new Blob([encodeWav(clean, sr)], { type: 'audio/wav' });
        await addAudioClip(checksum, ch.startLine, blob, { source: 'mic', durationMs, spanEndLine: ch.endLine });
        setSaved((n) => n + 1);
        advance();
      }
      // No speech in the take → stay on this chunk; an accidental Space saves nothing.
    } catch (e) {
      setErr('Saving failed: ' + (e?.message || e));
    } finally {
      committingRef.current = false;
    }
  }

  function advance() {
    setQi((i) => {
      const n = i + 1;
      // Not setState-in-updater: the finish is deferred out of React's reducer pass.
      if (n >= liveRef.current.queue.length) queueMicrotask(() => finish());
      return n;
    });
  }
  function redo() { resetTake(); }
  function skip() { resetTake(); setSkipped((n) => n + 1); advance(); }
  function toggleBreak() {
    setOnBreak((b) => {
      if (b) lastSpeechAtRef.current = Date.now(); // resuming — the break must not read as "done"
      return !b;
    });
  }
  function finish() {
    teardownAudio();
    setPhase('done');
  }

  function teardownAudio() {
    try { procRef.current?.disconnect(); } catch { /* already gone */ }
    try { srcRef.current?.disconnect(); } catch { /* already gone */ }
    try { ctxRef.current?.close(); } catch { /* already gone */ }
    procRef.current = null; srcRef.current = null; ctxRef.current = null;
  }
  useEffect(() => () => teardownAudio(), []);

  // Low-rate mirror of the live VAD for the state chip (no per-block renders).
  useEffect(() => {
    if (phase !== 'reading') return undefined;
    const id = setInterval(() => setSpeaking(Date.now() - lastSpeechAtRef.current < 800), 300);
    return () => clearInterval(id);
  }, [phase]);

  // Session keys — capture phase so the reader's Space never reaches the app's play/pause.
  useEffect(() => {
    if (phase !== 'reading') return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
      const map = { space: () => commit(), enter: () => commit(), r: redo, s: skip, b: toggleBreak };
      if (!map[k]) return;
      e.preventDefault();
      e.stopPropagation();
      map[k]();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const done = () => { onDone?.({ saved, skipped }); onClose(); };

  return (
    <Dialog
      title="Read the book aloud"
      onClose={() => { teardownAudio(); (phase === 'done' ? done : onClose)(); }}
      width={760}
      buttons={phase === 'reading'
        ? <button onClick={() => finish()}>■ Finish session</button>
        : <button onClick={phase === 'done' ? done : onClose}>Close</button>}
    >
      {phase === 'setup' && (
        <>
          <p className="settings-note">
            One continuous recording session: the chunk to read is shown big, you read it, pause,
            and it advances by itself — each take is trimmed to your speech, long mid-take gaps are
            shortened, and the clip is filed against its chunk. Space also advances, R redoes a
            fumbled chunk, S skips it, B takes a break (break audio is discarded).
          </p>
          <label className="inline-check">
            <input type="checkbox" checked={onlyUncovered} onChange={(e) => setOnlyUncovered(e.target.checked)} />
            <span>Only chunks without audio yet ({uncoveredCount} of {chunks.length})</span>
          </label>
          <div className="field-row">
            <label>Advance when I pause</label>
            <select value={advanceMode} onChange={(e) => setAdvanceMode(e.target.value)}>
              <option value="relaxed">After a clear pause (~1.6s)</option>
              <option value="eager">Quickly (~0.9s) — for steady readers</option>
              <option value="off">Never — I’ll press Space</option>
            </select>
          </div>
          {err && <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>{err}</p>}
          <button className="toggle-on" onClick={start} disabled={phase === 'requesting'}>🎙 Start reading</button>
        </>
      )}

      {phase === 'reading' && chunk && (
        <>
          <div className="rtw-head">
            <span>Chunk {qi + 1} / {queue.length}</span>
            <span className={`rtw-chip${onBreak ? ' break' : speaking ? ' talk' : ''}`}>
              {onBreak ? '⏸ On a break — audio discarded' : speaking ? '🗣 Recording you' : '🎙 Listening…'}
            </span>
            <span className="settings-note" style={{ margin: 0 }}>{saved} saved · {skipped} skipped</span>
          </div>
          <div className="rcw-meter"><div className="rcw-meter-fill" ref={meterRef} /></div>
          <div className={`rtw-text${onBreak ? ' dim' : ''}`}>{chunk.text}</div>
          {nextChunk && <div className="rtw-next" title="Up next">{nextChunk.text}</div>}
          <div className="rtw-controls">
            <button className="toggle-on" onClick={() => commit()} title="Save this chunk's take and move on (Space)">✔ Next chunk</button>
            <button onClick={redo} title="Discard this chunk's take and read it again (R)">⟲ Redo</button>
            <button onClick={skip} title="Move on without saving audio for this chunk (S)">⏭ Skip</button>
            <button onClick={toggleBreak} title="Pause the session — nothing is kept until you resume (B)">{onBreak ? '▶ Resume' : '⏸ Break'}</button>
          </div>
          {err && <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>{err}</p>}
        </>
      )}

      {phase === 'done' && (
        <>
          <p><b>Session finished.</b> {saved} chunk{saved === 1 ? '' : 's'} recorded{skipped ? `, ${skipped} skipped` : ''}.</p>
          <p className="settings-note">
            Every take was trimmed to your speech and filed against its chunk — recordings outrank
            generated audio automatically. Play any chunk in the manager to check a take; Rec… on a
            chunk re-records just that one.
          </p>
        </>
      )}
    </Dialog>
  );
}
