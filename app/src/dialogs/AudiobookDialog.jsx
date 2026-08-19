import { useEffect, useMemo, useRef, useState } from 'react';
import { totalChars, chunkChars, etaSeconds, chunkHealth, fmtEta, previewText } from '../features/ttsProgress.js';
import Dialog from './Dialog.jsx';
import { fmtDateTime } from '../features/dateFmt.js';
import { useApp } from '../state/AppContext.jsx';
import {
  getAudiobookManifest, getAudioClip, getAudioClipById, entryClips,
  addAudioClip, deleteAudioClipById, deleteAudioChunk, reorderAudioClips,
  audiobookSize, clearAudiobook, exportAudiobook, importAudiobook, appendAppLog,
  setSectionExtra, deleteSectionExtra, getSectionExtraBlob,
  allAudiobookManifests, setAudiobookMeta, loadDocPayload, allFiles,
} from '../state/storage.js';
import { defaultVoiceForLang, piperSupported, installedVoices, voiceLabel, createPiperEngine } from '../features/piperTts.js';
import { elevenVoices, elevenSynth, elevenConfigured } from '../features/elevenLabs.js';
import { audiobookChunks, readerDocFromText } from '../document/readerDocument.js';
import {
  JOB_KIND_LABEL, makeJob, addJob, removeJob, updateJob, moveJob, clearFinished,
  isFinished, nextQueued, runningJob, queueTotals, queueEtaSeconds, addRun, runThroughput,
  throughputByVoice, bookRows, libraryTotals,
} from '../features/audiobookQueue.js';
import { getTocEntries } from '../document/toc.js';
import { saveBlobToFile, pickFile, readFileText } from '../features/fileSystem.js';
import AudiobookExportWizard from './AudiobookExportWizard.jsx';
import RecordClipWizard from './RecordClipWizard.jsx';
import ReadThroughWizard from './ReadThroughWizard.jsx';
import { sessionConsistency } from '../features/narrationQuality.js';

// Rough clip duration from the blob: mp3 (~128 kbps, ElevenLabs) vs 16-bit 22.05 kHz WAV (Piper).
const estMs = (blob) => (/mpe?g|mp3/i.test(blob.type)
  ? Math.max(200, Math.round((blob.size / 16000) * 1000))
  : Math.max(200, Math.round(((blob.size - 44) / (22050 * 2)) * 1000)));
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDur = (ms) => `${(Math.round((ms || 0) / 100) / 10).toFixed(1)}s`;
const fmtWhen = (ts) => (ts ? fmtDateTime(ts) : '—');

// A tiny oscilloscope of one clip's waveform (decodes the WAV blob → downsamples → draws).
function ClipWave({ checksum, line, clipId }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rec = await getAudioClipById(checksum, line, clipId);
        if (!rec?.blob || !alive || !ref.current) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
        ctx.close();
        if (!alive || !ref.current) return;
        const data = audio.getChannelData(0);
        const cv = ref.current, g = cv.getContext('2d');
        const W = cv.width, H = cv.height, mid = H / 2;
        g.clearRect(0, 0, W, H);
        g.strokeStyle = getComputedStyle(cv).getPropertyValue('color') || '#3a86ff';
        g.beginPath();
        const step = Math.max(1, Math.floor(data.length / W));
        for (let x = 0; x < W; x++) {
          let min = 1, max = -1;
          for (let j = 0; j < step; j++) { const v = data[x * step + j] || 0; if (v < min) min = v; if (v > max) max = v; }
          g.moveTo(x, mid + min * mid); g.lineTo(x, mid + max * mid);
        }
        g.stroke();
      } catch { /* undecodable */ }
    })();
    return () => { alive = false; };
  }, [checksum, line, clipId]);
  return <canvas ref={ref} className="clip-wave" width={200} height={30} />;
}

// Audiobook Manager: narration clips per natural CHUNK (sentence/paragraph), grouped by the book's
// ToC so you can see which parts are generated. Each chunk can hold MULTIPLE clips (mic recordings +
// Piper renders in different voices); the top-priority one plays. Manage clips, voices, and generation
// from here — everything stays on-device (browser storage; use Export to save a real file).
export default function AudiobookDialog({ onClose }) {
  const { state, updateGlobal, openRecent } = useApp();
  // Command-centre views. Narration is batch work across a shelf of books, not a per-tab errand, so
  // this console is a SINGLETON that belongs to no document: Queue is the work list, Library is
  // every book's coverage, Analytics is how it is actually going. The chunk-by-chunk editor is a
  // drill-down from the Library — you pick the book here rather than inheriting whichever tab
  // happened to open the panel, so one console covers the whole shelf.
  const [view, setView] = useState('queue');
  const [sel, setSel] = useState(null); // { checksum, fileName, doc, tabLike } — book open in the editor
  const [manifest, setManifest] = useState({ lines: {} });
  const [recWiz, setRecWiz] = useState(null); // chunk whose record/import wizard is open
  const [readThru, setReadThru] = useState(false); // continuous read-the-book-aloud session
  const [secWiz, setSecWiz] = useState(null); // { firstLine, role, previewText, dlgTitle } — section extra wizard
  const [secBusy, setSecBusy] = useState(''); // `${firstLine}:${role}` while a section-title TTS runs
  const [gen, setGen] = useState(null); // { done, total, charsDone, charsTotal, runStart, current } while generating
  // The generation loop only sets state between chunks, so a long (or hung) chunk would leave the
  // panel frozen — exactly the case the reader needs to see. This ticks independently.
  const [genTick, setGenTick] = useState(0);
  useEffect(() => {
    if (!gen) return undefined;
    const t = setInterval(() => setGenTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [!!gen]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef(false);
  const checksum = sel?.checksum || null;

  const [voiceId, setVoiceId] = useState(state.global.offlineVoiceId || defaultVoiceForLang(state.global.language || 'en'));
  const [voices, setVoices] = useState([]); // installed Piper voice ids
  const [elVoices, setElVoices] = useState([]); // ElevenLabs voices [{ id, name }]
  const elMap = useMemo(() => new Map(elVoices.map((v) => [v.id, v.name])), [elVoices]);
  // A voice id is either a Piper id or `el:<elevenVoiceId>`; label both.
  const labelVoice = (vid) => (vid && vid.startsWith('el:') ? `☁ ${elMap.get(vid.slice(3)) || vid.slice(3)}` : voiceLabel(vid));
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [confirmJob, setConfirmJob] = useState(null); // { kind, targets, sections, words }
  const [clipMgr, setClipMgr] = useState(null); // chunk whose clip manager is open
  const [fullText, setFullText] = useState(null); // chunk whose full text is shown
  const [size, setSize] = useState({ bytes: 0, clips: 0, chunks: 0 });
  const [wipeArm, setWipeArm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [playingKey, setPlayingKey] = useState(''); // `${line}` or `${line}:${clipId}` currently playing
  const playRef = useRef(null); // { audio, url, key }

  // ── cross-book queue + history (device-local: generation is work THIS machine does) ──
  // A job left 'running' by a reload never resumes itself, so it is put back in the queue on load.
  // Resuming is safe and needs no checkpoint: a 'fill' pass only targets chunks that have no audio,
  // so whatever landed before the interruption is simply skipped the second time round.
  const [queue, setQueue] = useState(() =>
    (state.global.abQueue || []).map((j) => (j.status === 'running' ? { ...j, status: 'queued' } : j)));
  const [runs, setRuns] = useState(() => state.global.abRuns || []);
  const [library, setLibrary] = useState([]);      // bookRows(), every book with a manifest
  const [otherBooks, setOtherBooks] = useState([]); // known files with no audio yet
  const [libBusy, setLibBusy] = useState(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const drainingRef = useRef(false);   // a drain loop is live
  const stopAllRef = useRef(false);    // user asked the whole queue to stop
  const [seq, setSeq] = useState(0);   // makes ids unique without a clock or randomness

  // Persist structural changes only. Per-chunk progress stays in memory — writing the whole global
  // settings object once per chunk would hammer IndexedDB for a number that is re-derivable.
  const commitQueue = (q) => { setQueue(q); updateGlobal({ abQueue: q }); };
  const liveQueue = (q) => { setQueue(q); queueRef.current = q; };

  const chunks = useMemo(() => (sel ? audiobookChunks(sel.doc) : []), [sel]);

  // Group chunks into ToC sections (front matter first) — each with its own coverage.
  const sections = useMemo(() => {
    if (!sel) return [];
    const entries = getTocEntries(sel.tabLike) || [];
    if (!entries.length) return [{ id: 'all', title: sel.fileName || 'Document', chunks }];
    const secs = entries.map((e, i) => ({ id: 't' + i, title: e.title, start: e.wordIndex, chunks: [] }));
    const lead = { id: 'lead', title: 'Front matter', start: -1, chunks: [] };
    for (const c of chunks) {
      let target = lead;
      for (let i = secs.length - 1; i >= 0; i--) { if (c.startWordIndex >= secs[i].start) { target = secs[i]; break; } }
      target.chunks.push(c);
    }
    return [lead, ...secs].filter((s) => s.chunks.length);
  }, [sel, chunks]);

  async function refresh() {
    if (!checksum) return;
    setManifest(await getAudiobookManifest(checksum));
    setSize(await audiobookSize(checksum));
  }
  useEffect(() => { refresh(); void loadVoices(); return () => stopPlay(); /* eslint-disable-next-line */ }, [checksum]);
  async function loadVoices() {
    const list = await installedVoices();
    setVoices(list);
    if (list.length && !voiceId.startsWith('el:') && !list.includes(voiceId)) setVoiceId(list[0]);
    if (elevenConfigured(state.global.elevenLabsKey)) {
      try { setElVoices(await elevenVoices(state.global.elevenLabsKey)); } catch { setElVoices([]); }
    }
  }

  const clipsFor = (li) => entryClips(manifest.lines[li]);

  // ── library ──
  async function refreshLibrary() {
    setLibBusy(true);
    try {
      const [mans, files] = await Promise.all([allAudiobookManifests(), allFiles()]);
      const names = {};
      for (const f of files) if (f.checksum) names[f.checksum] = f.fileName || names[f.checksum];
      const rows = bookRows(mans, names);
      setLibrary(rows);
      const have = new Set(rows.map((r) => r.checksum));
      setOtherBooks(files.filter((f) => f.checksum && !have.has(f.checksum) && (f.totalWords || 0) > 0)
        .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)));
    } catch (e) { setMsg('Could not read the audiobook library: ' + (e?.message || e)); }
    setLibBusy(false);
  }
  useEffect(() => { refreshLibrary(); /* eslint-disable-next-line */ }, []);

  // A book's document: from an open reading tab when there is one (so a hand-edited ToC is
  // respected) and from the saved payload otherwise — this is what lets the console work on books
  // that aren't open. `tabLike` is only what getTocEntries needs; a payload-loaded book has no
  // stored ToC, so it falls back to auto-detection.
  async function resolveBook(cs) {
    const open = state.tabs.find((t) => !t.lazy && t.doc?.contentChecksum === cs);
    if (open) return { doc: open.doc, fileName: open.doc.fileName || 'Document', tabLike: open };
    const rec = await loadDocPayload(cs);
    if (!rec?.fullText) return null;
    const doc = readerDocFromText(rec.fullText, rec.fileName || 'Document');
    return { doc, fileName: rec.fileName || 'Document', tabLike: { doc, settings: {} } };
  }

  // Which books are open for READING — only used for a badge and the 'open in a tab' button. The
  // console itself never follows the active tab.
  const openChecksums = useMemo(
    () => new Set(state.tabs.filter((t) => !t.lazy && t.doc?.contentChecksum).map((t) => t.doc.contentChecksum)),
    [state.tabs]);

  // Drill into one book's chunk editor. Nothing else in the console cares which book this is.
  async function openBook(cs) {
    setLibBusy(true);
    const book = await resolveBook(cs);
    setLibBusy(false);
    if (!book) { setMsg('That book’s saved text is no longer available — open it once and it will be restored.'); return; }
    stopPlay();
    setSel({ checksum: cs, ...book });
    setView('book');
  }
  function closeBook() { stopPlay(); setSel(null); setView('library'); }

  // Which chunks a pass covers, against any book's manifest (not just the open tab's).
  function targetsFor(kind, list, man, vid) {
    const clips = (li) => entryClips(man?.lines?.[li]);
    const top = (li) => clips(li)[0] || null;
    if (kind === 'fill') return list.filter((c) => (c.text || '').trim() && !clips(c.startLine).length);
    if (kind === 'all') return list.filter((c) => (c.text || '').trim() && top(c.startLine)?.source !== 'mic');
    return list.filter((c) => { const t = top(c.startLine); return t && t.source === 'tts' && t.voiceId !== vid; });
  }

  // ── queue ──
  async function enqueue(cs, kind, { start = true, lines = null } = {}) {
    const book = await resolveBook(cs);
    if (!book) { setMsg('That book’s saved text is no longer available — open it once and it will be restored.'); return false; }
    const list = audiobookChunks(book.doc);
    // Stamp the chunk count so the library can show coverage without re-parsing every book.
    await setAudiobookMeta(cs, { chunks: list.length, fileName: book.fileName, words: book.doc.words.length });
    const man = await getAudiobookManifest(cs);
    const targets = lines ? list.filter((c) => lines.includes(c.startLine)) : targetsFor(kind, list, man, voiceId);
    if (!targets.length) { setMsg(`Nothing to do for “${book.fileName}” — that pass matches no chunks.`); refreshLibrary(); return false; }
    const job = makeJob({
      checksum: cs, fileName: book.fileName, kind, voiceId, voiceLabel: labelVoice(voiceId), lines,
      total: targets.length, charsTotal: totalChars(targets), seq, queuedAt: Date.now(),
    });
    setSeq((n) => n + 1);
    const q = addJob(queueRef.current, job);
    if (q === queueRef.current) { setMsg(`“${book.fileName}” is already waiting for that pass.`); return false; }
    commitQueue(q);
    queueRef.current = q;
    setMsg(`➕ Queued ${targets.length} chunk(s) of “${book.fileName}” (${labelVoice(voiceId)}).`);
    refreshLibrary();
    if (start) drainQueue();
    return true;
  }

  const patchJob = (id, patch) => { const q = updateJob(queueRef.current, id, patch); liveQueue(q); return q; };

  // ── playback (toggle: a second click stops) ──
  function stopPlay() {
    const p = playRef.current;
    if (p) { try { p.audio.pause(); } catch { /* */ } try { URL.revokeObjectURL(p.url); } catch { /* */ } playRef.current = null; }
    setPlayingKey('');
  }
  async function playClip(line, clipId) {
    const key = clipId ? `${line}:${clipId}` : `${line}`;
    if (playRef.current?.key === key) { stopPlay(); return; }
    stopPlay();
    const rec = clipId ? await getAudioClipById(checksum, line, clipId) : await getAudioClip(checksum, line);
    if (!rec?.blob) return;
    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    audio.onended = stopPlay; audio.onerror = stopPlay;
    playRef.current = { audio, url, key };
    setPlayingKey(key);
    audio.play().catch(() => {});
  }

  // ── recording / import: handled by RecordClipWizard (mic + level meter + pause + trim + file import) ──

  // ── section boundary extras (intro/outro music + a spoken section title) ──
  const secExtras = (firstLine) => manifest.sections?.[firstLine] || {};
  async function playSec(firstLine, role, clipId) {
    const key = `sec:${firstLine}:${role}`;
    if (playRef.current?.key === key) { stopPlay(); return; }
    stopPlay();
    const blob = await getSectionExtraBlob(checksum, firstLine, role, clipId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url); audio.onended = stopPlay; audio.onerror = stopPlay;
    playRef.current = { audio, url, key }; setPlayingKey(key);
    audio.play().catch(() => {});
  }
  async function delSec(firstLine, role) {
    if (playRef.current?.key === `sec:${firstLine}:${role}`) stopPlay();
    await deleteSectionExtra(checksum, firstLine, role); refresh();
  }
  // Narrate a section's title with the current voice (Piper offline or ElevenLabs cloud).
  async function genTitle(sec) {
    const firstLine = sec.chunks[0].startLine;
    const title = (sec.title || '').trim();
    if (!title) { setMsg('This section has no title text to narrate.'); return; }
    setSecBusy(`${firstLine}:title`); setMsg('');
    try {
      const isEl = voiceId.startsWith('el:');
      let blob;
      if (isEl) blob = await elevenSynth(title, voiceId.slice(3), state.global.elevenLabsKey, { modelId: state.global.elevenModel || 'eleven_multilingual_v2' });
      else { const engine = createPiperEngine(); try { blob = await engine.synth(title, voiceId); } finally { engine.dispose(); } }
      await setSectionExtra(checksum, firstLine, 'title', blob, { source: 'tts', voiceId, durationMs: estMs(blob), titleText: title });
      setMsg(`🔊 Narrated the title “${title.slice(0, 40)}”.`); refresh();
    } catch (e) { setMsg('Title narration failed: ' + (e?.message || e)); appendAppLog('audiobook', `section title @ ${firstLine + 1}: ${e?.message || e}`); }
    setSecBusy('');
  }
  function openSecWiz(sec, role) {
    const firstLine = sec.chunks[0].startLine;
    const kindLabel = role === 'intro' ? 'Intro music' : role === 'outro' ? 'Outro music' : 'Section title';
    setSecWiz({ firstLine, role, previewText: role === 'title' ? sec.title : '', dlgTitle: `${kindLabel} — ${(sec.title || '').slice(0, 40)}` });
  }

  // ── generation ──
  // Every pass now goes through the QUEUE, including the buttons for the open book: one engine, one
  // code path, and a long run keeps going while you look at another book's chunk list.
  function askGenerate(kind) {
    const targets = targetsFor(kind, chunks, manifest, voiceId);
    if (!targets.length) { setMsg('Nothing matches that — no chunks to (re)generate.'); return; }
    const secHit = sections.filter((s) => s.chunks.some((c) => targets.includes(c))).map((s) => s.title);
    const words = targets.reduce((n, c) => n + (c.text || '').split(/\s+/).filter(Boolean).length, 0);
    setConfirmJob({ kind, targets, sections: secHit, words });
  }

  // Generation loop for ONE job. Every failure's reason is kept and surfaced (nothing is swallowed),
  // each chunk gets ONE retry after a short pause (rides out a transient rate-limit), and a job that
  // keeps failing aborts early after 6 failures in a row — no point grinding (and spending quota)
  // through 200 chunks once the voice/key/quota is dead. The queue then moves on to the next book.
  const CONSEC_ABORT = 6;
  async function runOneJob(job) {
    const book = await resolveBook(job.checksum);
    if (!book) {
      patchJob(job.id, { status: 'error', error: 'saved text unavailable', finishedAt: Date.now() });
      appendAppLog('audiobook', `job ${job.fileName}: saved text unavailable, skipped`);
      return;
    }
    const list = audiobookChunks(book.doc);
    const man = await getAudiobookManifest(job.checksum);
    const targets = job.lines ? list.filter((c) => job.lines.includes(c.startLine)) : targetsFor(job.kind, list, man, job.voiceId);
    const runStart = Date.now();
    if (!targets.length) { patchJob(job.id, { status: 'done', total: 0, finishedAt: Date.now() }); return; }

    abort.current = false;
    const vid = job.voiceId;
    const isEl = String(vid || '').startsWith('el:');
    const key = state.global.elevenLabsKey, modelId = state.global.elevenModel || 'eleven_multilingual_v2';
    const charsTotal = totalChars(targets);
    patchJob(job.id, { status: 'running', startedAt: runStart, total: targets.length, charsTotal, charsDone: 0, done: 0, ok: 0, failed: 0 });
    setGen({ done: 0, total: targets.length, charsTotal, charsDone: 0, runStart, current: null, jobId: job.id, fileName: job.fileName });
    setMsg('');
    let ok = 0, consecutive = 0, charsDone = 0;
    const errors = [];
    // Piper runs in a recycled worker: the ONNX WASM heap only grows, so long runs died around
    // chunk ~50 with "Can't create a session / failed to allocate a buffer". Recycling the worker
    // every batch (and before any retry) frees the heap; OPFS keeps the voice cached.
    const PIPER_BATCH = 16;
    const engine = isEl ? null : createPiperEngine();
    const synth = (c) => (isEl ? elevenSynth(c.text.trim(), vid.slice(3), key, { modelId }) : engine.synth(c.text.trim(), vid));
    try {
      for (let i = 0; i < targets.length; i++) {
        if (abort.current || stopAllRef.current) break;
        const c = targets[i];
        // Publish WHAT is happening, not just how far along — a silent freeze used to be
        // indistinguishable from slow synthesis. Each phase updates before it begins.
        const cChars = chunkChars(c);
        const setPhase = (phase) => setGen((g) => (g ? { ...g, current: { ...(g.current || {}), index: i, line: c.startLine, chars: cChars, preview: previewText(c.text), phase, startedAt: g.current?.index === i ? g.current.startedAt : Date.now() } } : g));
        setPhase('synthesizing');
        try {
          let blob;
          try { blob = await synth(c); }
          catch { // one retry — with a fresh engine for Piper, after a pause for cloud rate limits
            setPhase('retrying');
            if (engine) engine.recycle(); else await new Promise((r) => setTimeout(r, 1000));
            blob = await synth(c);
          }
          setPhase('saving');
          await addAudioClip(job.checksum, c.startLine, blob, { source: 'tts', voiceId: vid, durationMs: estMs(blob), spanEndLine: c.endLine });
          ok++; consecutive = 0;
          if (engine && ok % PIPER_BATCH === 0) engine.recycle(); // fresh heap for the next batch
        } catch (e) {
          errors.push(e?.message || String(e));
          console.warn(`Audiobook: ${job.fileName} chunk @ line ${c.startLine + 1} failed:`, e);
          appendAppLog('audiobook', `${job.fileName} chunk @ line ${c.startLine + 1} (${job.voiceLabel}): ${e?.message || e}`);
          consecutive++;
        }
        // charsDone counts ATTEMPTED characters: a failed chunk still consumed its synthesis time,
        // so excluding it would make the rate — and the ETA — optimistic.
        charsDone += cChars;
        setGen((g) => (g ? { ...g, done: i + 1, charsDone } : g));
        patchJob(job.id, { done: i + 1, ok, failed: errors.length, charsDone });
        if ((i & 7) === 0 && job.checksum === checksum) await refresh();
        if (consecutive >= CONSEC_ABORT) break;
      }
    } finally { engine?.dispose(); }

    const stopped = abort.current || stopAllRef.current;
    const bailed = consecutive >= CONSEC_ABORT;
    const status = bailed ? 'error' : stopped ? 'stopped' : 'done';
    const reasons = [...new Set(errors)].slice(0, 2).join(' · ');
    patchJob(job.id, { status, ok, failed: errors.length, charsDone, finishedAt: Date.now(), error: bailed ? reasons : '' });
    // One history record per pass — this is what makes the ETA and the analytics real rather than
    // guessed, so it is written even for a stopped run (the work it DID do still measures the rate).
    const rec = {
      checksum: job.checksum, fileName: job.fileName, kind: job.kind,
      voiceId: vid, voiceLabel: job.voiceLabel, at: runStart, ms: Date.now() - runStart,
      charsDone, ok, failed: errors.length, total: targets.length, status,
    };
    setRuns((prev) => { const next = addRun(prev, rec); updateGlobal({ abRuns: next }); return next; });
    setGen(null);
    if (job.checksum === checksum) refresh();
    if (!errors.length) setMsg(stopped ? `■ Stopped — ${ok} of ${targets.length} chunk(s) of “${job.fileName}” generated.` : `✓ “${job.fileName}”: generated ${ok} chunk(s) with ${job.voiceLabel}.`);
    else if (bailed) setMsg(`⚠ “${job.fileName}” stopped after ${CONSEC_ABORT} failures in a row (${ok} generated, ${errors.length} failed): ${reasons}. See Data Management → Diagnostic log.`);
    else setMsg(`“${job.fileName}”: ${ok} generated, ${errors.length} failed: ${reasons}. See Data Management → Diagnostic log.`);
    if (errors.length) appendAppLog('audiobook', `${job.fileName}: ${ok} ok, ${errors.length} failed of ${targets.length} (${job.voiceLabel})`);
  }

  // Work the queue one job at a time. Synthesis is CPU- or quota-bound, so running two jobs at once
  // would only make both slower and have two Piper workers fighting over the same heap.
  async function drainQueue() {
    if (drainingRef.current) return;
    drainingRef.current = true;
    stopAllRef.current = false;
    try {
      for (;;) {
        if (stopAllRef.current) break;
        const job = nextQueued(queueRef.current);
        if (!job) break;
        await runOneJob(job);
      }
    } finally {
      drainingRef.current = false;
      setGen(null);
      commitQueue(queueRef.current);
      refreshLibrary();
    }
  }
  function stopQueue() { stopAllRef.current = true; abort.current = true; }
  // Closing the console stops the queue rather than leaving a zombie loop synthesising into an
  // unmounted component (clips would still be written, but nothing would show progress or be able
  // to stop it). Dock this dialog as a tab if you want a long run to grind while you read; the
  // queue itself is persisted either way, so reopening picks up exactly where it left off.
  useEffect(() => () => { stopAllRef.current = true; abort.current = true; }, []);
  // Stop just the running job; the queue carries on with the next book.
  function skipCurrent() { abort.current = true; }

  // ── transfer + wipe ──
  async function doExport() {
    setBusy(true); setMsg('Gathering audiobook clips…');
    try {
      const bundle = await exportAudiobook(checksum, sel.fileName);
      if (!bundle.clips.length) { setMsg('Nothing to export yet.'); setBusy(false); return; }
      const text = JSON.stringify(bundle);
      const safe = (sel.fileName || 'book').replace(/[^\w.-]+/g, '_').slice(0, 40);
      const res = await saveBlobToFile(new Blob([text], { type: 'application/json' }), `tachyread-audiobook-${safe}.json`, [{ description: 'Tachyread audiobook', accept: { 'application/json': ['.json'] } }]);
      setMsg(res.canceled ? 'Save canceled.' : `Exported ${bundle.clips.length} clip(s) (${fmtBytes(text.length)})${res.method === 'download' ? ' to your downloads' : ` to ${res.name}`}.`);
    } catch (e) { setMsg('Export failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function doImport() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    setBusy(true); setMsg('Reading file…');
    try {
      const r = await importAudiobook(JSON.parse(await readFileText(f)));
      await refresh();
      setMsg(`Imported ${r.imported} clip(s)${r.skipped ? `, skipped ${r.skipped} already present` : ''}.${r.checksum === checksum ? '' : ' (They belong to a different book.)'}`);
    } catch (e) { setMsg('Import failed: ' + (e?.message || e)); }
    setBusy(false);
  }
  async function doWipe() { await clearAudiobook(checksum); setWipeArm(false); stopPlay(); setMsg('Deleted all audio for this book.'); refresh(); }

  const toggleSec = (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const covered = (secChunks) => secChunks.filter((c) => clipsFor(c.startLine).length).length;
  const totalCovered = chunks.filter((c) => clipsFor(c.startLine).length).length;
  const pct = chunks.length ? Math.round((totalCovered / chunks.length) * 100) : 0;
  const remote = (state.global.remoteAudiobooks || []).find((r) => r.checksum === checksum);
  const remoteHasMore = remote && remote.chunks > totalCovered;

  // ── command-centre derived values ──
  const totals = queueTotals(queue);
  const thr = runThroughput(runs);
  const byVoice = throughputByVoice(runs);
  const libTotals = libraryTotals(library);
  const queueEta = queueEtaSeconds(queue, thr.msPerChar);
  const active = runningJob(queue);

  const VIEWS = [
    ['queue', `📋 Queue${totals.queued + totals.running ? ` (${totals.queued + totals.running})` : ''}`, 'The work list — every book waiting to be narrated'],
    ['library', `📚 Library${library.length ? ` (${library.length})` : ''}`, 'Every book’s narration coverage, and what to queue next'],
    ['stats', '📈 Analytics', 'How generation is actually going: throughput, voices, recent runs'],
    // The editor tab exists only while a book is open IN it — the console has no "current book".
    ...(sel ? [['book', `📖 ${sel.fileName.length > 20 ? sel.fileName.slice(0, 19) + '…' : sel.fileName}`, `Chunk-by-chunk editor for “${sel.fileName}”`]] : []),
  ];

  // The live generation panel — shared by the Queue view and the per-book toolbar so a run reads the
  // same wherever you are watching it from. A plain function, NOT a nested component: a component
  // declared during render is a new type every render, so React would remount it (and drop focus)
  // on every keystroke elsewhere in the dialog.
  function genLive() {
    if (!gen) return null;
    const elapsedMs = Date.now() - (gen.runStart || Date.now());
    const eta = etaSeconds({ elapsedMs, charsDone: gen.charsDone || 0, charsTotal: gen.charsTotal || 0 });
    const msPerChar = gen.charsDone > 0 ? elapsedMs / gen.charsDone : 0;
    const cur = gen.current;
    const curMs = cur?.startedAt ? Date.now() - cur.startedAt : 0;
    const health = cur ? chunkHealth({ chunkElapsedMs: curMs, chunkChars: cur.chars, msPerChar }) : 'ok';
    const PHASE = { synthesizing: '🎙 synthesising', retrying: '↻ retrying after a failure', saving: '💾 saving clip' };
    return (
      <div className={`ab-gen-live gh-${health}`} data-tick={genTick}>
        <div className="abg-line">
          <b>{fmtEta(eta)}</b> left in “{gen.fileName}” · {Math.round((gen.charsDone / Math.max(1, gen.charsTotal)) * 100)}% of the text
          {msPerChar > 0 && <> · {Math.round(1000 / msPerChar)} chars/s</>}
        </div>
        {cur && (
          <>
            <div className="abg-line">
              {PHASE[cur.phase] || cur.phase} · chunk {cur.index + 1}/{gen.total} @ line {cur.line + 1} · {cur.chars} chars · {(curMs / 1000).toFixed(1)}s
            </div>
            <div className="abg-text" title={cur.preview}>“{cur.preview}”</div>
            {health !== 'ok' && (
              <div className="abg-warn" role="status">
                {health === 'stalled'
                  ? '⚠ This chunk is far past its expected time — the voice engine may have stalled. Skip this book or stop the queue; a Piper run recycles its worker on restart.'
                  : '⏳ Taking longer than this run’s usual pace for a chunk this size.'}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Voice picker — shared by the queue header and the per-book toolbar (same reason it is a plain
  // function, see above). The voice is chosen at ENQUEUE time and stored on the job, so changing it
  // here never rewrites work already queued.
  function voicePicker() {
    return (
      <label>Voice
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} title="Voice used for the next job you queue (offline Piper, or ElevenLabs cloud if a key is set in Audio Settings). Jobs already queued keep the voice they were queued with.">
          <optgroup label="Offline (Piper)">
            {(voices.length ? voices : (voiceId.startsWith('el:') ? [] : [voiceId])).map((v) => <option key={v} value={v}>{voiceLabel(v)}</option>)}
          </optgroup>
          {elVoices.length > 0 && (
            <optgroup label="ElevenLabs (cloud · your quota)">
              {elVoices.map((v) => <option key={v.id} value={`el:${v.id}`}>☁ {v.name}</option>)}
            </optgroup>
          )}
        </select>
      </label>
    );
  }

  const canTTS = piperSupported() || elVoices.length > 0;

  return (
    <Dialog title="Audiobook Command Centre" onClose={() => { stopPlay(); onClose(); }} width={860}>
      <div className="ab-views" role="tablist" aria-label="Audiobook views">
        {VIEWS.map(([id, label, help]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={`ab-view-tab${view === id ? ' on' : ''}`}
            title={help}
            onClick={() => setView(id)}
          >{label}</button>
        ))}
        {/* The queue keeps running whichever view you are on, so its state belongs in the header. */}
        <span className="grow" />
        {active
          ? <span className="ab-run-pill" title={`Generating “${active.fileName}”`}>● {active.fileName.slice(0, 22)}</span>
          : totals.queued > 0 ? <span className="ab-run-pill idle" title="Jobs are waiting — press Start">◌ {totals.queued} waiting</span> : null}
      </div>

      {/* ───────────────────────── QUEUE ───────────────────────── */}
      {view === 'queue' && (
        <div className="ab-view">
          <div className="ab-queue-head">
            {voicePicker()}
            {active || drainingRef.current
              ? <>
                  <button className="grab-trash" onClick={stopQueue} title="Stop after the current chunk and leave the rest queued">■ Stop queue</button>
                  <button onClick={skipCurrent} title="Abandon the book being generated and move on to the next job">⏭ Skip book</button>
                </>
              : <button className="toggle-on" disabled={!totals.queued || !canTTS} onClick={drainQueue} title="Work through the queue, one book at a time">▶ Start queue</button>}
            <span className="grab-sep" />
            <button disabled={!queue.some(isFinished)} onClick={() => commitQueue(clearFinished(queue))} title="Remove finished, stopped and failed jobs from the list">🧹 Clear finished</button>
          </div>

          <div className="ab-queue-stats">
            <div className="ab-stat"><b>{totals.queued + totals.running}</b><span>job(s) outstanding</span></div>
            <div className="ab-stat"><b>{(totals.chunks - totals.chunksDone).toLocaleString()}</b><span>chunk(s) to go</span></div>
            <div className="ab-stat"><b>{queueEta != null ? fmtEta(queueEta) : '—'}</b><span>whole queue{thr.runs ? '' : ' (needs a run first)'}</span></div>
            <div className="ab-stat"><b>{thr.charsPerSec ? Math.round(thr.charsPerSec) : '—'}</b><span>chars/s measured</span></div>
          </div>

          {genLive()}

          {!queue.length ? (
            <p className="settings-note">
              Nothing queued. Add books from <strong>📚 Library</strong> — you can line up as many as you like and
              leave them to grind; one generates at a time, and the rest wait their turn.
            </p>
          ) : (
            <div className="ab-jobs">
              {queue.map((j, i) => {
                const pctJ = j.charsTotal ? Math.round((j.charsDone / j.charsTotal) * 100) : 0;
                const ICON = { queued: '◌', running: '●', done: '✓', error: '⚠', stopped: '■' };
                return (
                  <div key={j.id} className={`ab-job st-${j.status}`}>
                    <span className="ab-job-icon" title={j.status}>{ICON[j.status] || '·'}</span>
                    <div className="ab-job-main">
                      <div className="ab-job-title">
                        <strong title={j.fileName}>{j.fileName}</strong>
                        <span className="ab-job-kind">{j.lines ? `1 chunk @ line ${j.lines[0] + 1}` : JOB_KIND_LABEL[j.kind] || j.kind}</span>
                        <span className="ab-job-voice" title="Voice this job was queued with">{j.voiceLabel}</span>
                      </div>
                      <div className="imp-bar ab-job-bar" title={`${pctJ}%`}><div className="imp-fill" style={{ width: `${pctJ}%` }} /></div>
                      <div className="ab-job-meta">
                        {j.done}/{j.total} chunk(s)
                        {j.failed > 0 && <> · <span className="ab-job-fail">{j.failed} failed</span></>}
                        {j.status === 'done' && j.finishedAt ? <> · finished {fmtWhen(j.finishedAt)}</> : null}
                        {j.error ? <> · {j.error}</> : null}
                      </div>
                    </div>
                    <div className="ab-job-acts">
                      <button disabled={i === 0 || j.status === 'running'} onClick={() => commitQueue(moveJob(queue, j.id, -1))} title="Do this one sooner">↑</button>
                      <button disabled={i === queue.length - 1 || j.status === 'running'} onClick={() => commitQueue(moveJob(queue, j.id, 1))} title="Do this one later">↓</button>
                      <button className="grab-trash" onClick={() => { if (j.status === 'running') skipCurrent(); commitQueue(removeJob(queue, j.id)); }} title={j.status === 'running' ? 'Abandon this job and drop it from the queue' : 'Remove from the queue'}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!canTTS && <p className="settings-note">No voice engine available: install an offline Piper voice, or add an ElevenLabs key in Audio Settings.</p>}
        </div>
      )}

      {/* ───────────────────────── LIBRARY ───────────────────────── */}
      {view === 'library' && (
        <div className="ab-view">
          <div className="ab-queue-head">
            {voicePicker()}
            <span className="settings-note" style={{ margin: 0 }}>Queue a pass for any book — it does not have to be open.</span>
            <span className="grow" />
            <button onClick={refreshLibrary} disabled={libBusy} title="Re-read every book's manifest">{libBusy ? '…' : '↻ Refresh'}</button>
          </div>

          <div className="ab-queue-stats">
            <div className="ab-stat"><b>{libTotals.booksStarted}</b><span>book(s) with audio</span></div>
            <div className="ab-stat"><b>{libTotals.booksComplete}</b><span>fully narrated</span></div>
            <div className="ab-stat"><b>{fmtBytes(libTotals.bytes)}</b><span>on this device</span></div>
            <div className="ab-stat"><b>{fmtEta(libTotals.durationMs / 1000)}</b><span>of narration</span></div>
          </div>

          {!library.length && <p className="settings-note">No book has any narration yet. Pick one below to start.</p>}
          <div className="ab-lib">
            {library.map((r) => {
              const cpct = r.coverage == null ? null : Math.round(r.coverage * 100);
              return (
                <div key={r.checksum} className={`ab-lib-row${r.checksum === checksum ? ' current' : ''}`}>
                  <div className="ab-lib-main">
                    <div className="ab-lib-title">
                      <strong title={r.fileName}>{r.fileName}</strong>
                      {openChecksums.has(r.checksum) && <span className="ab-lib-tag" title="This book is open in a reading tab">open</span>}
                      {cpct === 100 && <span className="ab-lib-tag done">complete</span>}
                    </div>
                    <div className="imp-bar ab-lib-bar" title={cpct == null ? 'Chunk count unknown until this book is queued or opened' : `${cpct}%`}>
                      <div className="imp-fill" style={{ width: `${cpct ?? 0}%` }} />
                    </div>
                    <div className="ab-lib-meta">
                      {cpct == null
                        ? <>{r.chunksWithAudio} chunk(s) with audio · total unknown</>
                        : <>{r.chunksWithAudio}/{r.chunks} chunk(s) · <strong>{cpct}%</strong></>}
                      {' · '}{r.clips} clip(s) · {fmtBytes(r.bytes)} · {fmtEta(r.durationMs / 1000)}
                      {r.mic > 0 && <> · 🎤 {r.mic} recorded</>}
                      {r.voices.length > 0 && <> · {r.voices.slice(0, 2).map((v) => labelVoice(v.voice)).join(', ')}</>}
                      {r.lastAt ? <> · last {fmtWhen(r.lastAt)}</> : null}
                    </div>
                  </div>
                  <div className="ab-lib-acts">
                    <button disabled={!canTTS} onClick={() => enqueue(r.checksum, 'fill')} title="Queue every chunk that has no audio yet">🎙 Gaps</button>
                    <button disabled={!canTTS} onClick={() => enqueue(r.checksum, 'othervoice')} title="Queue only the chunks whose audio uses a different voice from the one selected">🎚 Match</button>
                    <button disabled={!canTTS} onClick={() => enqueue(r.checksum, 'all')} title="Queue a fresh render of every chunk that is not one of your recordings">↻ All</button>
                    <button onClick={() => openBook(r.checksum)} title="Open this book’s chunk-by-chunk editor: per-chunk clips, your own recordings, section music and export">📖 Chunks</button>
                    {!openChecksums.has(r.checksum) && <button onClick={() => openRecent(r.checksum)} title="Open this book in a reading tab">📂</button>}
                  </div>
                </div>
              );
            })}
          </div>

          {otherBooks.length > 0 && (
            <details className="ab-group">
              <summary>➕ Books with no narration yet ({otherBooks.length})</summary>
              <div className="ab-lib">
                {otherBooks.map((f) => (
                  <div key={f.checksum} className="ab-lib-row">
                    <div className="ab-lib-main">
                      <div className="ab-lib-title"><strong title={f.fileName}>{f.fileName || 'Document'}</strong></div>
                      <div className="ab-lib-meta">{(f.totalWords || 0).toLocaleString()} words · no audio yet</div>
                    </div>
                    <div className="ab-lib-acts">
                      <button className="toggle-on" disabled={!canTTS} onClick={() => enqueue(f.checksum, 'fill')} title="Queue the whole book for narration">🎙 Narrate</button>
                      <button onClick={() => openBook(f.checksum)} title="Open this book’s chunk-by-chunk editor">📖 Chunks</button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ───────────────────────── ANALYTICS ───────────────────────── */}
      {view === 'stats' && (
        <div className="ab-view">
          <div className="ab-queue-stats">
            <div className="ab-stat"><b>{thr.runs}</b><span>run(s) recorded</span></div>
            <div className="ab-stat"><b>{thr.charsPerSec ? Math.round(thr.charsPerSec) : '—'}</b><span>chars/s overall</span></div>
            <div className="ab-stat"><b>{fmtEta(thr.ms / 1000)}</b><span>time spent generating</span></div>
            <div className="ab-stat"><b>{libTotals.chunksWithAudio.toLocaleString()}</b><span>chunk(s) narrated</span></div>
          </div>

          {!thr.runs ? (
            <p className="settings-note">
              No generation runs recorded yet. Once a job finishes, its measured rate lands here and the
              queue starts giving real estimates instead of a dash.
            </p>
          ) : (
            <>
              <div className="field-section">Throughput by voice</div>
              <p className="settings-note" style={{ marginTop: 0 }}>
                An offline voice and a cloud voice differ by an order of magnitude, so the queue estimates
                with the rate for the voice you actually picked rather than a blended average.
              </p>
              <table className="ab-table">
                <thead><tr><th>Voice</th><th>Runs</th><th>Chars</th><th>Chars/s</th><th>Generated</th><th>Failed</th></tr></thead>
                <tbody>
                  {byVoice.map((v) => {
                    const share = byVoice[0].charsPerSec ? (v.charsPerSec / Math.max(...byVoice.map((x) => x.charsPerSec))) * 100 : 0;
                    return (
                      <tr key={v.voice}>
                        <td className="ab-td-name">{labelVoice(v.voice)}</td>
                        <td>{v.runs}</td>
                        <td>{v.chars.toLocaleString()}</td>
                        <td>
                          <span className="ab-rate">{Math.round(v.charsPerSec)}</span>
                          <span className="ab-rate-bar"><span style={{ width: `${share}%` }} /></span>
                        </td>
                        <td>{v.ok}</td>
                        <td className={v.failed ? 'ab-job-fail' : ''}>{v.failed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="field-section">Recent runs</div>
              <table className="ab-table">
                <thead><tr><th>When</th><th>Book</th><th>Pass</th><th>Voice</th><th>Chunks</th><th>Rate</th><th></th></tr></thead>
                <tbody>
                  {[...runs].reverse().slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td>{fmtWhen(r.at)}</td>
                      <td className="ab-td-name" title={r.fileName}>{r.fileName}</td>
                      <td>{r.lines ? '1 chunk' : (JOB_KIND_LABEL[r.kind] || r.kind)}</td>
                      <td className="ab-td-name">{labelVoice(r.voiceId)}</td>
                      <td>{r.ok}/{r.total}{r.failed ? <> · <span className="ab-job-fail">{r.failed}✗</span></> : null}</td>
                      <td>{r.ms > 0 ? `${Math.round((r.charsDone / r.ms) * 1000)}/s` : '—'}</td>
                      <td>{r.status === 'done' ? '✓' : r.status === 'stopped' ? '■' : '⚠'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="field-section">Storage</div>
          <p className="settings-note" style={{ marginTop: 0 }}>
            <strong>{fmtBytes(libTotals.bytes)}</strong> across {libTotals.clips.toLocaleString()} clip(s) in{' '}
            {libTotals.booksStarted} book(s), in this browser’s storage. There is no file path to open — open a
            book from <strong>📚 Library</strong> and use its <strong>Record &amp; export</strong> group to save real audio files.
          </p>
        </div>
      )}

      {/* ─────────── BOOK EDITOR — a drill-down from the Library, not a fixed tab ─────────── */}
      {view === 'book' && !sel && (
        <p className="settings-note">No book open here. Pick one in <strong>📚 Library</strong> — any book, whether or not it is open in a reading tab.</p>
      )}
      {view === 'book' && sel && (
      <>
      <div className="ab-crumb">
        <button onClick={() => setView('library')} title="Back to the library list (this book stays open here)">‹ Library</button>
        <strong title={sel.fileName}>{sel.fileName}</strong>
        <span className="grow" />
        <button onClick={closeBook} title="Close this book’s editor">✕ Close book</button>
      </div>
      {/* Every action lives in ONE sticky toolbar, so the controls stay reachable however far down
          a 141-section book you have scrolled — previously Delete sat at the very bottom and
          Generate at the very top. Groups are native <details>, so each collapses independently and
          the browser remembers nothing we have to manage. */}
      <div className="ab-toolbar">
      {/* coverage + voice */}
      <div className="ab-coverage">
        {totalCovered >= chunks.length && chunks.length
          ? <span className="ab-cov-done">✓ Fully generated — {chunks.length} chunk(s)</span>
          : <span><strong>{totalCovered}</strong> / {chunks.length} chunk(s) have audio <strong>({pct}%)</strong></span>}
        <div className="imp-bar ab-cov-bar" title={`${pct}%`}><div className="imp-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      {remoteHasMore && (
        <div className="ab-remote">
          🔊 A more complete audiobook — <strong>{remote.chunks} chunk(s)</strong> — exists
          {remote.device ? <> on <strong>{remote.device}</strong></> : ' on another device'}. Export it there and Import here to skip regenerating.
        </div>
      )}

      <details className="ab-group" open>
        <summary>🎙 Generate narration</summary>
      {canTTS ? (
        <div className="ab-genbar">
          {voicePicker()}
          {gen ? (
            <>
              <div className="imp-bar" style={{ flex: '1 1 160px', maxWidth: 280 }}><div className="imp-fill" style={{ width: `${gen.charsTotal ? (gen.charsDone / gen.charsTotal) * 100 : 0}%` }} /></div>
              <span className="settings-note" style={{ margin: 0 }}>Generating {gen.done}/{gen.total}…</span>
              <button onClick={skipCurrent}>Stop</button>
              {genLive()}
            </>
          ) : (
            <>
              <button className="toggle-on" onClick={() => askGenerate('fill')} title="Queue every chunk that has no audio yet">🎙 Generate gaps</button>
              <button onClick={() => askGenerate('all')} title="Queue a fresh render for every non-recorded chunk">↻ Regenerate all</button>
              <button onClick={() => askGenerate('othervoice')} title="Queue only chunks whose current audio uses a different voice">🎚 Match this voice</button>
            </>
          )}
        </div>
      ) : <p className="settings-note">Offline Piper voice isn’t available in this browser. Add an ElevenLabs key in Audio Settings to generate in the cloud instead.</p>}
      </details>

      <details className="ab-group">
        <summary>📖 Record &amp; export</summary>
      <div className="ab-genbar">
        <button className="toggle-on" onClick={() => setReadThru(true)} title="Narrate it yourself in one sitting: read chunk after chunk, pause to advance — each take is trimmed, cleaned and filed automatically">📖 Read it aloud yourself…</button>
        <button className="toggle-on" onClick={() => setShowExport(true)} disabled={!totalCovered} title="Save the generated narration as standalone audio tracks (WAV/MP3 + playlist) to play on your phone">🎧 Export as audiobook…</button>
        <button onClick={doExport} disabled={busy || !size.clips} title="Save this book's clips as a Tachyread transfer file for another device">⬆ Transfer file…</button>
        <button onClick={doImport} disabled={busy} title="Load an exported Tachyread audiobook transfer file">⬇ Import…</button>
      </div>
      </details>

      {/* Collapse / expand controls — handy for long books; "completed" = fully-generated sections. */}
      <details className="ab-group">
        <summary>🗂 Sections</summary>
      {sections.length > 1 && (() => {
        const doneIds = sections.filter((s) => s.chunks.length && covered(s.chunks) >= s.chunks.length).map((s) => s.id);
        return (
          <div className="ab-sec-tools">
            <span className="settings-note" style={{ margin: 0 }}>{sections.length} sections</span>
            <span className="grab-sep" />
            <button onClick={() => setCollapsed(new Set())} disabled={collapsed.size === 0} title="Expand every section">▾ Expand all</button>
            <button onClick={() => setCollapsed(new Set(sections.map((s) => s.id)))} disabled={collapsed.size >= sections.length} title="Collapse every section">▸ Collapse all</button>
            <button onClick={() => setCollapsed(new Set(doneIds))} disabled={!doneIds.length} title="Collapse only the fully-generated sections, leaving the ones that still need audio open">✓ Collapse completed{doneIds.length ? ` (${doneIds.length})` : ''}</button>
          </div>
        );
      })()}
      </details>

      <details className="ab-group ab-group-danger">
        <summary>💾 Storage &amp; delete</summary>
        <p className="settings-note" style={{ margin: 0 }}>
          {size.clips} clip(s) across {size.chunks} chunk(s) · <strong>{fmtBytes(size.bytes)}</strong> in this browser’s
          storage (IndexedDB — there’s no file path to open; use <strong>Export</strong> above to save a real file).
        </p>
        <div className="data-row" style={{ marginTop: 6 }}>
          {!wipeArm
            ? <button className="grab-trash" disabled={!size.clips} onClick={() => setWipeArm(true)}>🗑 Delete all audio for this book…</button>
            : <>
                <button className="grab-trash" onClick={doWipe}>⚠ Confirm — delete {size.clips} clip(s) ({fmtBytes(size.bytes)})</button>
                <button onClick={() => setWipeArm(false)}>Cancel</button>
              </>}
        </div>
      </details>
      {msg && <p className="settings-note ab-toolbar-msg">{msg}</p>}
      </div>

      {/* ToC-grouped chunk list */}
      <div className="ab-sections">
        {sections.map((sec) => {
          const cov = covered(sec.chunks), tot = sec.chunks.length, spct = tot ? Math.round((cov / tot) * 100) : 0;
          const open = !collapsed.has(sec.id);
          return (
            <div key={sec.id} className="ab-section">
              <div className="ab-sec-head" onClick={() => toggleSec(sec.id)}>
                <span className="ab-sec-caret">{open ? '▾' : '▸'}</span>
                <span className="ab-sec-title">{sec.title}</span>
                <span className={`ab-sec-cov${cov >= tot ? ' full' : ''}`}>{cov}/{tot} · {spct}%</span>
                <div className="imp-bar ab-sec-bar"><div className="imp-fill" style={{ width: `${spct}%` }} /></div>
              </div>
              {open && (() => {
                const firstLine = sec.chunks[0].startLine;
                const ex = secExtras(firstLine);
                const canTts = piperSupported() || elVoices.length > 0;
                const slot = (role) => {
                  const isTitle = role === 'title';
                  const c = ex[role];
                  const pk = `sec:${firstLine}:${role}`;
                  const busyTitle = isTitle && secBusy === `${firstLine}:title`;
                  return (
                    <div className="ab-slot" key={role}>
                      <span className="ab-slot-label">{role === 'intro' ? '🎵 Intro' : isTitle ? '🔊 Title' : '🎵 Outro'}</span>
                      {c ? (
                        <>
                          <button className={playingKey === pk ? 'toggle-on' : ''} onClick={() => playSec(firstLine, role, c.id)} title={playingKey === pk ? 'Stop' : 'Play'}>{playingKey === pk ? '■' : '▶'}</button>
                          <span className="ab-slot-meta">{fmtDur(c.durationMs)}{c.source === 'tts' ? ' · 🤖' : c.source === 'mic' ? ' · 🎤' : ' · 🎵'}</span>
                          {isTitle && canTts && <button disabled={busyTitle} onClick={() => genTitle(sec)} title="Re-narrate the title with the current voice">{busyTitle ? '…' : '↻'}</button>}
                          <button className="grab-trash" onClick={() => delSec(firstLine, role)} title="Remove">🗑</button>
                        </>
                      ) : (
                        <>
                          {isTitle && canTts && <button disabled={busyTitle} onClick={() => genTitle(sec)} title="Narrate the section title with the current voice">{busyTitle ? '…' : 'Generate'}</button>}
                          <button onClick={() => openSecWiz(sec, role)} title={isTitle ? 'Record or import a spoken title' : 'Import a music file'}>{isTitle ? 'Record / import…' : 'Add music…'}</button>
                        </>
                      )}
                    </div>
                  );
                };
                return (
                  <>
                    <div className="ab-secaudio" title="Audio played at the section boundaries (in the exported audiobook): intro music, a spoken title, then the narration, then outro music.">
                      {slot('intro')}{slot('title')}{slot('outro')}
                    </div>
                    <table className="history-table ab-table">
                      <tbody>
                        {sec.chunks.map((chunk) => {
                      const li = chunk.startLine;
                      const cl = clipsFor(li);
                      const top = cl[0];
                      const lineLabel = chunk.endLine > chunk.startLine ? `${chunk.startLine + 1}–${chunk.endLine + 1}` : `${chunk.startLine + 1}`;
                      const isPlaying = playingKey === `${li}`;
                      return (
                        <tr key={li}>
                          <td className="ab-lines">{lineLabel}</td>
                          <td className="ab-preview" title="Click to read the full chunk text" onClick={() => setFullText(chunk)}>{chunk.text.slice(0, 80)}{chunk.text.length > 80 ? '…' : ''}</td>
                          <td className="ab-voice">{top ? (top.source === 'mic' ? '🎤 you' : (top.voiceId?.startsWith('el:') ? <span title={labelVoice(top.voiceId)}>{labelVoice(top.voiceId)}</span> : <span title={voiceLabel(top.voiceId)}>🤖 {voiceLabel(top.voiceId).split(' · ')[0]}</span>)) : ''}{cl.length > 1 ? <span className="ab-clipcount"> ·{cl.length}</span> : ''}</td>
                          <td className="ab-dur">{top ? fmtDur(top.durationMs) : ''}</td>
                          <td className="ab-actions">
                            {top && <button className={isPlaying ? 'toggle-on' : ''} onClick={() => playClip(li)} title={isPlaying ? 'Stop' : 'Play'}>{isPlaying ? '■' : '▶'}</button>}{' '}
                            {(piperSupported() || elVoices.length > 0) && <button onClick={() => setConfirmJob({ kind: 'one', targets: [chunk], sections: [sec.title], words: (chunk.text || '').split(/\s+/).filter(Boolean).length })} title="Generate this chunk">Gen</button>}{' '}
                            <button onClick={() => setRecWiz(chunk)} title="Record with your mic or import an audio file for this chunk">🎙 Rec…</button>{' '}
                            {cl.length > 0 && <button onClick={() => setClipMgr(chunk)} title="Manage the clips for this chunk">Clips ({cl.length})</button>}
                          </td>
                        </tr>
                      );
                        })}
                      </tbody>
                    </table>
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* stored narration-quality feedback: every recorded clip that carries metrics */}
      {(() => {
        const qs = Object.values(manifest.lines || {}).flatMap((e) => entryClips(e)).map((c) => c.quality).filter(Boolean);
        if (!qs.length) return null;
        const avg = Math.round(qs.reduce((a, q) => a + (q.score || 0), 0) / qs.length);
        const cons = sessionConsistency(qs);
        return (
          <p className="settings-note" style={{ margin: '2px 0 0' }}>
            🎙 Narration quality: <strong>★ {avg}</strong> average across {qs.length} recorded take{qs.length === 1 ? '' : 's'}
            {cons && <> · pace &amp; level <strong>{cons.label.toLowerCase()}</strong></>} — per-take details in each chunk’s clip list.
          </p>
        );
      })()}
      </>
      )}

      {/* Generate confirmation */}
      {confirmJob && (
        <Dialog title="Confirm generation" onClose={() => setConfirmJob(null)} width={460}
          buttons={<>
            <button className="toggle-on" onClick={() => {
              const j = confirmJob; setConfirmJob(null);
              enqueue(checksum, j.kind, { lines: j.kind === 'one' ? j.targets.map((c) => c.startLine) : null });
            }}>Queue {confirmJob.targets.length} chunk(s)</button>
            <button onClick={() => setConfirmJob(null)}>Cancel</button>
          </>}>
          <p>Generate <strong>{confirmJob.targets.length}</strong> chunk(s) (~{confirmJob.words.toLocaleString()} words) with{' '}
            <strong>{labelVoice(voiceId)}</strong>{confirmJob.kind === 'othervoice' ? ' (replacing other-voice renders)' : ''}.</p>
          {confirmJob.sections?.length ? (
            <p className="settings-note" style={{ marginTop: 0 }}>Sections: {confirmJob.sections.slice(0, 8).join(' · ')}{confirmJob.sections.length > 8 ? ` +${confirmJob.sections.length - 8} more` : ''}</p>
          ) : null}
          {voiceId.startsWith('el:')
            ? <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>☁ Sends ~{confirmJob.words.toLocaleString()} words to ElevenLabs — spends your API quota. Existing clips are kept; recordings are never touched.</p>
            : <p className="settings-note">Runs on-device — budget a few seconds per chunk. Existing clips are kept (a new one is added); recordings are never touched.</p>}
        </Dialog>
      )}

      {/* Full-text preview */}
      {fullText && (
        <Dialog title={`Chunk ${fullText.startLine + 1}${fullText.endLine > fullText.startLine ? `–${fullText.endLine + 1}` : ''}`} onClose={() => setFullText(null)} width={520} buttons={<button onClick={() => setFullText(null)}>Close</button>}>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{fullText.text}</p>
        </Dialog>
      )}

      {/* Per-chunk clip manager */}
      {clipMgr && (() => {
        const li = clipMgr.startLine;
        const cl = clipsFor(li);
        const move = async (id, dir) => {
          const ids = cl.map((c) => c.id); const i = ids.indexOf(id); const j = i + dir;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          await reorderAudioClips(checksum, li, ids); await refresh();
        };
        return (
          <Dialog title={`Clips — chunk ${li + 1}`} onClose={() => setClipMgr(null)} width={560} buttons={<button onClick={() => setClipMgr(null)}>Close</button>}>
            <p className="settings-note" style={{ marginTop: 0 }}>The top clip plays. Recordings (🎤) always outrank Piper renders. Reorder or delete stale clips.</p>
            {cl.map((c, i) => (
              <div key={c.id} className={`clip-card${i === 0 ? ' active' : ''}`}>
                <div className="clip-card-main">
                  <span className="clip-pri">{i === 0 ? '★' : i + 1}</span>
                  <span className="clip-src">{c.source === 'mic' ? '🎤 recording' : (c.voiceId?.startsWith('el:') ? labelVoice(c.voiceId) : `🤖 ${voiceLabel(c.voiceId)}`)}</span>
                  <span className="clip-meta">{fmtDur(c.durationMs)} · {fmtBytes(c.sizeBytes)} · {fmtWhen(c.createdAt)}</span>
                  {c.quality && (
                    <span
                      className={`rtw-score s${c.quality.score >= 85 ? 'good' : c.quality.score >= 65 ? 'ok' : 'bad'}`}
                      title={`${c.quality.wpm != null ? c.quality.wpm + ' wpm · ' : ''}${c.quality.rmsDb} dB RMS · peak ${c.quality.peakDb} dB · volume CV ${c.quality.volumeCv}${c.quality.clippingPct ? ` · clipping ${c.quality.clippingPct}%` : ''}`}
                    >★ {c.quality.score}</span>
                  )}
                </div>
                <div className="clip-card-row">
                  <ClipWave checksum={checksum} line={li} clipId={c.id} />
                  <button className={playingKey === `${li}:${c.id}` ? 'toggle-on' : ''} onClick={() => playClip(li, c.id)}>{playingKey === `${li}:${c.id}` ? '■' : '▶'}</button>
                  <button disabled={i === 0 || c.source !== cl[i - 1]?.source} onClick={() => move(c.id, -1)} title="Higher priority">↑</button>
                  <button disabled={i === cl.length - 1 || c.source !== cl[i + 1]?.source} onClick={() => move(c.id, 1)} title="Lower priority">↓</button>
                  <button className="grab-trash" onClick={async () => { if (playingKey === `${li}:${c.id}`) stopPlay(); await deleteAudioClipById(checksum, li, c.id); await refresh(); if (clipsFor(li).length === 0) setClipMgr(null); }}>🗑</button>
                </div>
              </div>
            ))}
            {cl.length === 0 && <p className="settings-note">No clips.</p>}
            <div className="data-row" style={{ marginTop: 8 }}>
              <button className="toggle-on" onClick={() => setRecWiz(clipMgr)}>🎙 Record / import a clip…</button>
              {cl.length > 0 && <button className="grab-trash" onClick={async () => { stopPlay(); await deleteAudioChunk(checksum, li); await refresh(); setClipMgr(null); }}>Delete all clips for this chunk</button>}
            </div>
          </Dialog>
        );
      })()}

      {showExport && (
        <AudiobookExportWizard
          checksum={checksum}
          fileName={sel.fileName}
          sections={sections}
          manifest={manifest}
          onClose={() => setShowExport(false)}
        />
      )}

      {readThru && (
        <ReadThroughWizard
          checksum={checksum}
          docName={sel.fileName}
          chunks={chunks}
          isCovered={(c) => clipsFor(c.startLine).length > 0}
          onClose={() => setReadThru(false)}
          onDone={({ saved, skipped }) => { setMsg(`📖 Read-through: ${saved} chunk${saved === 1 ? '' : 's'} recorded${skipped ? `, ${skipped} skipped` : ''}.`); refresh(); }}
        />
      )}

      {recWiz && (
        <RecordClipWizard
          checksum={checksum}
          chunk={recWiz}
          onClose={() => setRecWiz(null)}
          onSaved={() => { setRecWiz(null); setMsg('🎤 Clip saved.'); refresh(); }}
        />
      )}

      {secWiz && (
        <RecordClipWizard
          checksum={checksum}
          dlgTitle={secWiz.dlgTitle}
          previewText={secWiz.previewText}
          commit={async (blob, durationMs) => {
            await setSectionExtra(checksum, secWiz.firstLine, secWiz.role, blob, {
              source: secWiz.role === 'title' ? 'mic' : 'music',
              durationMs,
              titleText: secWiz.role === 'title' ? secWiz.previewText : undefined,
            });
          }}
          onClose={() => setSecWiz(null)}
          onSaved={() => { setSecWiz(null); setMsg('Section audio saved.'); refresh(); }}
        />
      )}
    </Dialog>
  );
}
