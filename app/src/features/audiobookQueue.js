// Audiobook command centre: the work queue and the library/throughput analytics behind it.
//
// Narration used to be a per-tab affair — one dialog, one book, and the whole job had to be babysat
// with that tab open. But generating an audiobook is *batch* work: you decide what to make once,
// then it grinds for an hour. So the unit of work here is a JOB (one book, one kind of pass, one
// voice), jobs sit in an ordered queue, and exactly one runs at a time — synthesis is CPU- or
// quota-bound, so running two would just make both slower and fight over the Piper worker.
//
// Everything here is pure: queue in, queue out. The runner (AudiobookDialog) owns the audio engine
// and the clock; this owns the bookkeeping, which is the part worth testing.

// What a pass covers. Mirrors the three buttons the per-book view has always had.
export const JOB_KINDS = [
  ['fill', '🎙 Gaps only', 'Every chunk that has no audio yet'],
  ['all', '↻ Everything', 'A fresh render for every chunk that is not a recording'],
  ['othervoice', '🎚 Match voice', 'Only chunks whose current audio uses a different voice'],
];
export const JOB_KIND_LABEL = Object.fromEntries(JOB_KINDS.map(([k, l]) => [k, l]));

export const QUEUE_STATUSES = ['queued', 'running', 'done', 'error', 'stopped'];
const FINISHED = new Set(['done', 'error', 'stopped']);
export const isFinished = (job) => FINISHED.has(job?.status);

const arr = (q) => (Array.isArray(q) ? q : []);
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// Ids must be stable across a reload (the queue is persisted) and must not use Date.now/Math.random
// — those break workflow replay and make tests non-deterministic. Content + a caller-supplied seq
// is enough: the same book queued twice for the same pass is deduped anyway (see addJob).
export function jobId({ checksum, kind, seq = 0 }) {
  return `${String(checksum || '?').slice(0, 12)}:${kind}:${seq}`;
}

export function makeJob({ checksum, fileName, kind = 'fill', voiceId = null, voiceLabel = '', total = 0, charsTotal = 0, seq = 0, queuedAt = 0, lines = null }) {
  return {
    id: jobId({ checksum, kind, seq }),
    checksum,
    fileName: fileName || 'Document',
    kind,
    // An explicit chunk list, for "generate just this one". Null = the whole pass.
    lines: lines && lines.length ? [...lines] : null,
    voiceId,
    voiceLabel,
    status: 'queued',
    total: num(total),          // chunks this pass will attempt
    done: 0,                    // chunks attempted so far
    ok: 0,                      // chunks that produced a clip
    failed: 0,
    charsTotal: num(charsTotal),
    charsDone: 0,
    queuedAt: num(queuedAt),
    startedAt: 0,
    finishedAt: 0,
    error: '',
  };
}

// Add a job, unless the same book is ALREADY waiting for the same kind of pass — queueing "gaps for
// Moby Dick" twice is never what anyone means, and a silently doubled job would generate every
// chunk twice. A finished job for the same pair does not block a fresh one (that's a re-run).
export function addJob(queue, job) {
  const q = arr(queue);
  if (!job?.checksum) return q;
  // Only whole-book passes dedupe. Two "just this chunk" jobs are different work, so they stack.
  const clash = !job.lines && q.some((j) => j.checksum === job.checksum && j.kind === job.kind && !j.lines && !isFinished(j));
  return clash ? q : [...q, job];
}

export function removeJob(queue, id) {
  return arr(queue).filter((j) => j.id !== id);
}

export function updateJob(queue, id, patch) {
  return arr(queue).map((j) => (j.id === id ? { ...j, ...patch } : j));
}

// Reorder by one slot. A RUNNING job is pinned: it is already synthesising, so letting it be shoved
// down the list would only make the display lie about what is happening.
export function moveJob(queue, id, delta) {
  const q = [...arr(queue)];
  const i = q.findIndex((j) => j.id === id);
  if (i < 0 || !delta) return q;
  const j = q[i];
  if (j.status === 'running') return q;
  const target = Math.max(0, Math.min(q.length - 1, i + (delta > 0 ? 1 : -1)));
  if (target === i || q[target].status === 'running') return q;
  q.splice(i, 1);
  q.splice(target, 0, j);
  return q;
}

export function clearFinished(queue) {
  return arr(queue).filter((j) => !isFinished(j));
}

export const nextQueued = (queue) => arr(queue).find((j) => j.status === 'queued') || null;
export const runningJob = (queue) => arr(queue).find((j) => j.status === 'running') || null;

// Roll-up for the queue header. `charsLeft` drives the whole-queue ETA and deliberately counts a
// running job's REMAINING characters, not its total, so the estimate falls as work lands.
export function queueTotals(queue) {
  const q = arr(queue);
  const t = { jobs: q.length, queued: 0, running: 0, done: 0, error: 0, stopped: 0, chunks: 0, chunksDone: 0, charsTotal: 0, charsDone: 0, charsLeft: 0, failed: 0 };
  for (const j of q) {
    t[j.status] = (t[j.status] || 0) + 1;
    t.chunks += num(j.total);
    t.chunksDone += num(j.done);
    t.charsTotal += num(j.charsTotal);
    t.charsDone += num(j.charsDone);
    t.failed += num(j.failed);
    if (!isFinished(j)) t.charsLeft += Math.max(0, num(j.charsTotal) - num(j.charsDone));
  }
  return t;
}

// Seconds to finish everything still outstanding, at a measured ms-per-character rate. Returns null
// when there is no rate yet — a made-up number is worse than an honest dash.
export function queueEtaSeconds(queue, msPerChar) {
  const left = queueTotals(queue).charsLeft;
  if (!(msPerChar > 0) || left <= 0) return null;
  return (left * msPerChar) / 1000;
}

// ── run history ────────────────────────────────────────────────────────────────────────────────
// One record per finished pass. Kept device-local and capped: this is a rolling picture of how fast
// synthesis actually goes here, not an archive.
export function addRun(runs, run, cap = 60) {
  const list = arr(runs);
  if (!run) return list;
  return [...list, run].slice(-Math.max(1, cap));
}

// Measured throughput across the recorded runs. Characters per second is the right unit: a chunk can
// be three words or three hundred, so chunks-per-minute says nothing you can plan with.
export function runThroughput(runs) {
  const list = arr(runs).filter((r) => num(r.charsDone) > 0 && num(r.ms) > 0);
  if (!list.length) return { charsPerSec: 0, ms: 0, chars: 0, runs: 0, msPerChar: 0 };
  const chars = list.reduce((n, r) => n + num(r.charsDone), 0);
  const ms = list.reduce((n, r) => n + num(r.ms), 0);
  return { charsPerSec: (chars / ms) * 1000, msPerChar: ms / chars, ms, chars, runs: list.length };
}

// Same, split by voice — an offline Piper voice and a cloud voice differ by an order of magnitude,
// so a single blended rate would mis-estimate every queue that mixes them.
export function throughputByVoice(runs) {
  const by = new Map();
  for (const r of arr(runs)) {
    if (!(num(r.charsDone) > 0 && num(r.ms) > 0)) continue;
    const k = r.voiceLabel || r.voiceId || 'unknown';
    const cur = by.get(k) || { voice: k, chars: 0, ms: 0, runs: 0, ok: 0, failed: 0 };
    cur.chars += num(r.charsDone); cur.ms += num(r.ms); cur.runs++;
    cur.ok += num(r.ok); cur.failed += num(r.failed);
    by.set(k, cur);
  }
  return [...by.values()]
    .map((v) => ({ ...v, charsPerSec: (v.chars / v.ms) * 1000 }))
    .sort((a, b) => b.chars - a.chars);
}

// ── library ────────────────────────────────────────────────────────────────────────────────────
// One row per book that has a manifest. `chunks` comes from setAudiobookMeta (the manifest only ever
// records the chunks already generated, so coverage is unknowable without it) — a book whose count
// has never been stamped reports chunks: 0 and coverage null, which the UI shows as "—" rather than
// inventing a percentage.
export function bookRows(manifests, nameByChecksum = {}) {
  return arr(manifests).map((m) => {
    const lines = m?.lines || {};
    let clips = 0, bytes = 0, durationMs = 0, lastAt = 0, mic = 0, tts = 0;
    const voices = new Map();
    const chunksWithAudio = Object.keys(lines).length;
    for (const k of Object.keys(lines)) {
      for (const c of clipList(lines[k])) {
        clips++;
        bytes += num(c.sizeBytes);
        durationMs += num(c.durationMs);
        if (num(c.createdAt) > lastAt) lastAt = num(c.createdAt);
        if (c.source === 'mic') mic++; else tts++;
        const v = c.voiceId || (c.source === 'mic' ? 'your voice' : 'unknown');
        voices.set(v, (voices.get(v) || 0) + 1);
      }
    }
    for (const fl of Object.keys(m?.sections || {})) {
      for (const role of ['intro', 'title', 'outro']) {
        const c = m.sections[fl]?.[role];
        if (c) { clips++; bytes += num(c.sizeBytes); durationMs += num(c.durationMs); }
      }
    }
    const chunks = num(m?.chunks);
    return {
      checksum: m.checksum,
      fileName: nameByChecksum[m.checksum] || m.fileName || 'Document',
      chunks,
      chunksWithAudio,
      coverage: chunks > 0 ? Math.min(1, chunksWithAudio / chunks) : null,
      clips, bytes, durationMs, lastAt, mic, tts,
      voices: [...voices.entries()].map(([voice, n]) => ({ voice, n })).sort((a, b) => b.n - a.n),
    };
  }).sort((a, b) => b.lastAt - a.lastAt);
}

// Duplicated from storage.entryClips so this module stays pure (no IndexedDB import) and testable in
// node. Same rule: mic clips outrank TTS, otherwise insertion order; legacy scalar meta reads as one.
function clipList(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.clips)) return entry.clips;
  if (entry.durationMs != null || entry.source || entry.voiceId) return [entry];
  return [];
}

export function libraryTotals(rows) {
  const r = arr(rows);
  const started = r.filter((x) => x.clips > 0);
  return {
    books: r.length,
    booksStarted: started.length,
    booksComplete: r.filter((x) => x.coverage != null && x.coverage >= 0.999).length,
    clips: r.reduce((n, x) => n + x.clips, 0),
    bytes: r.reduce((n, x) => n + x.bytes, 0),
    durationMs: r.reduce((n, x) => n + x.durationMs, 0),
    chunks: r.reduce((n, x) => n + x.chunks, 0),
    chunksWithAudio: r.reduce((n, x) => n + x.chunksWithAudio, 0),
  };
}
