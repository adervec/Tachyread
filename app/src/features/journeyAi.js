// AI cowork / API glue for the Literary Journey. PURE builders + apply logic (folder + network I/O
// live in the dialog). The model does a LIGHT update by default — refresh rec-scores, a short read-next
// list, and a paragraph of analysis; the app writes the instruction into the cowork folder so Claude
// (or a desktop cowork agent) knows the task. The user can switch to a HEAVY custom instruction (e.g.
// "rebuild the tech tree"); once a heavy result is applied the instruction resets back to light. See
// journeyAi.demo.mjs.

import { libraryStats, readStatus, finishMs, sortBooks } from './journeyLibrary.js';
import { MAX_REAL_WPM } from '../engine/readingTracker.js';

export const LIGHT_INSTRUCTION =
  'LIGHT update. Refresh recScore only for books you can confidently judge; produce a short "read next" ' +
  'list (5–10) drawn from the unread candidates; and write a 1–2 paragraph analysis of the reading ' +
  'profile from recent finishes. Do NOT rebuild the tech tree, do NOT rewrite every book, do NOT change titles/authors/ids.';

export const HEAVY_PLACEHOLDER =
  'HEAVY update. Recompute recScore across the whole library, refresh analysis + recommendations, and ' +
  'rebuild the constellation tech tree: return treeMeta.pos (x,y in -500..500 per book id) and ' +
  'treeMeta.edges ([idA, idB, "influence"|"prereq"|"series"]) for lineage between books.';

// A distinct heavy task: build the constellation into a real knowledge graph of TYPED relationships.
export const KNOWLEDGE_GRAPH_INSTRUCTION =
  'KNOWLEDGE GRAPH (heavy). Rebuild the constellation as a knowledge graph. Return treeMeta.pos (x,y in ' +
  '-500..500 per book id) AND treeMeta.edges as [idA, idB, kind], where kind ∈ "influence" | "prereq" | ' +
  '"series" | "same-author" | "theme" | "contrast" | "responds". Add an edge only for a real, specific ' +
  'relationship between two books that are actually in the library; aim for 1–4 edges per book. Do NOT ' +
  'change titles/authors/ids or the reading/completion state.';

export function getInstruction(ai) {
  return ai?.instruction || { mode: 'light', text: LIGHT_INSTRUCTION, updatedAt: 0 };
}

// Only these fields may be changed by an AI patch — identity (id/title/author) and the user's own
// completion/rating state are never overwritten.
export const PATCH_FIELDS = ['recScore', 'difficultyLevel', 'difficulty', 'genre', 'subgenre', 'description', 'synopsis', 'criticalConsensus', 'recommended'];

function compact(b, fields) { const o = {}; for (const f of fields) if (b[f] !== undefined && b[f] !== null && b[f] !== '') o[f] = b[f]; return o; }

// Reading-PROGRESS bundle for the cowork export: per-day and per-week totals across every tracked
// file, the reading streak, and the books currently in flight — everything a cowork daily/weekly
// summary task needs. Pure (files in, `now` injected); see journeyAi.demo.mjs.
export function buildProgress(files, { books = [], bindMap = {}, days = 35, now = Date.now() } = {}) {
  const cutoff = now - days * 86400000;
  const bookById = Object.fromEntries(books.map((b) => [b.id, b]));
  const byDay = new Map();
  const allDates = new Set(); // full history, for the streak
  const active = [];
  for (const f of files || []) {
    const cs = f.checksum || f.contentChecksum;
    const dated = (f.dailyHistory || []).filter((e) => e.date && ((e.wordsRead || 0) > 0 || (e.activeTimeSecs || 0) > 0));
    for (const e of dated) {
      allDates.add(e.date);
      if (Date.parse(e.date) < cutoff) continue;
      const cur = byDay.get(e.date) || { date: e.date, wordsRead: 0, activeSecs: 0 };
      cur.wordsRead += e.wordsRead || 0;
      cur.activeSecs += e.activeTimeSecs || 0;
      byDay.set(e.date, cur);
    }
    const last = dated.map((e) => e.date).sort().pop() || null;
    if (last && Date.parse(last) >= cutoff) {
      const linked = bindMap[cs];
      active.push({
        title: (linked && bookById[linked]?.title) || f.fileName || 'Untitled',
        fileName: f.fileName || '',
        ...(linked ? { linkedBookId: linked } : {}),
        totalWords: f.totalWords || 0,
        wordsRead: f.persistentWordsRead || 0,
        coveragePct: f.totalWords ? Math.round(((f.persistentWordsRead || 0) / f.totalWords) * 1000) / 10 : 0,
        activeSecs: f.persistentActiveTimeSecs || 0,
        lastRead: last,
      });
    }
  }
  const wpmOf = (w, s) => (s > 0 ? Math.min(MAX_REAL_WPM, Math.round((w / s) * 60)) : 0);
  const daysArr = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({ ...d, wpm: wpmOf(d.wordsRead, d.activeSecs) }));
  // Weekly rollups (weeks start Monday).
  const weekOf = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const byWeek = new Map();
  for (const d of daysArr) {
    const w = weekOf(d.date);
    const cur = byWeek.get(w) || { weekStart: w, wordsRead: 0, activeSecs: 0, daysActive: 0 };
    cur.wordsRead += d.wordsRead; cur.activeSecs += d.activeSecs; cur.daysActive += 1;
    byWeek.set(w, cur);
  }
  const weeks = [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    .map((w) => ({ ...w, wpm: wpmOf(w.wordsRead, w.activeSecs) }));
  // Current streak: walk back from today (today itself may still be unread without breaking it).
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  let cursor = now;
  if (!allDates.has(dayKey(cursor))) cursor -= 86400000;
  let streak = 0;
  while (allDates.has(dayKey(cursor))) { streak++; cursor -= 86400000; }
  return {
    note: 'Per-day and per-week reading totals across all tracked files — use for daily/weekly reading summaries. activeSecs = attentive reading time; wpm = effective words per active minute.',
    windowDays: days,
    days: daysArr,
    weeks,
    currentStreakDays: streak,
    activeBooks: active.sort((a, b) => (a.lastRead < b.lastRead ? 1 : -1)).slice(0, 12),
  };
}

// Compact projection sent to the model. Light = summary + recent finishes + top unread candidates
// (small enough for the API's context). Heavy additionally carries every book (cowork only — too big
// for the API, which is why heavy tree-rebuilds go through the folder round-trip). `progress`
// (buildProgress) rides along so cowork daily/weekly summary tasks have the reading history.
export function buildDataset(books, { light = true, progress = null } = {}) {
  const stats = libraryStats(books);
  const recent = sortBooks(books.filter((b) => readStatus(b) === 'finished' && finishMs(b) != null), 'finished')
    .slice(0, 20).map((b) => compact(b, ['id', 'title', 'author', 'genre', 'subgenre', 'difficultyLevel', 'finishTime', 'rating']));
  const unread = sortBooks(books.filter((b) => readStatus(b) === 'toread'), 'rec')
    .slice(0, 40).map((b) => compact(b, ['id', 'title', 'author', 'genre', 'difficultyLevel', 'recScore']));
  const ds = {
    summary: { total: stats.total, finished: stats.finished, fiction: stats.fiction, nonfiction: stats.nonfiction, byGenre: stats.byGenre },
    recentFinishes: recent, unreadCandidates: unread,
  };
  if (progress) ds.progress = progress;
  if (!light) ds.allBooks = books.map((b) => compact(b, ['id', 'title', 'author', 'genre', 'subgenre', 'fnf', 'difficultyLevel', 'recScore', 'completion', 'finishTime', 'pages', 'pubDate']));
  return ds;
}

const SCHEMA_LIGHT = '{ "analysis": string, "recommendations": [{"title","author","why"}], "bookPatches": [{"id","recScore"?,"notes"?}] }';
const SCHEMA_HEAVY = '{ "analysis": string, "recommendations": [{"title","author","why"}], "bookPatches": [{"id","recScore"?}], "treeMeta": {"pos": {"<id>": {"x","y"}}, "edges": [["<idA>","<idB>","influence|prereq|series|same-author|theme|contrast|responds"]]} }';

// Human-readable Markdown for pasting into any Claude chat (also written as the cowork instructions).
export function buildDigest(dataset, instruction) {
  const heavy = instruction.mode === 'heavy';
  return [
    '# Trackyread — reading-tracker cowork request',
    `Task (${instruction.mode}): ${instruction.text}`,
    ...(dataset.progress ? [
      '',
      'The dataset includes a `progress` section — per-day and per-week reading totals (words, active',
      'seconds, effective WPM), the current reading streak, and the books currently in flight with their',
      'coverage. Use it for any DAILY or WEEKLY reading-summary task, and to ground the analysis in what',
      'is actually being read right now.',
    ] : []),
    '',
    '## Reply with ONE ```json block, no prose, using the exact ids below:',
    '```',
    heavy ? SCHEMA_HEAVY : SCHEMA_LIGHT,
    '```',
    '',
    '## Data',
    '```json',
    JSON.stringify(dataset, null, 2),
    '```',
  ].join('\n');
}

// The versioned envelope written to the cowork folder for a desktop agent to pick up.
export function buildCoworkRequest(dataset, instruction) {
  return {
    protocol: 'tachyread-journey', protocolVersion: 1, kind: 'cowork-request', generatedAt: Date.now(),
    instruction, ids: dataset.unreadCandidates.map((b) => b.id).concat(dataset.recentFinishes.map((b) => b.id)),
    dataset,
  };
}

// Messages for the direct Anthropic API path (askClaude).
export function buildApiMessages(dataset, instruction) {
  const heavy = instruction.mode === 'heavy';
  const system = 'You are a literary reading analyst. Respond with ONLY a single JSON object, no prose, no markdown fences.';
  const content =
    `Task (${instruction.mode}): ${instruction.text}\n\n` +
    (heavy ? 'NOTE: you only see a compact subset here — a full tech-tree rebuild needs the cowork export. Do the analysis you can.\n\n' : '') +
    `Return JSON: ${heavy ? SCHEMA_HEAVY : SCHEMA_LIGHT}. Use the exact ids given.\n\nDATA:\n` + JSON.stringify(dataset);
  return { system, messages: [{ role: 'user', content }] };
}

// Pull the JSON object out of a model reply (fenced ```json block, or the outermost braces).
export function parseAiOutput(text) {
  if (!text || !text.trim()) throw new Error('Empty response.');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

// Resolve an AI output against the current books → book records to save + an ai patch to merge. Pure.
export function applyAiOutput(output, booksById) {
  const bookUpdates = [];
  for (const p of output.bookPatches || []) {
    const cur = booksById[p.id];
    if (!cur) continue;
    const patch = {};
    for (const f of PATCH_FIELDS) if (p[f] !== undefined) patch[f] = p[f];
    if (Object.keys(patch).length) bookUpdates.push({ ...cur, ...patch });
  }
  const aiPatch = {};
  if (output.recommendations) aiPatch.recommendations = output.recommendations;
  if (output.analysis) aiPatch.analysis = output.analysis;
  if (output.treeMeta) aiPatch.treeMeta = output.treeMeta;
  if (output.archetypeMeta) aiPatch.archetypeMeta = output.archetypeMeta;
  return { bookUpdates, aiPatch };
}

// djb2 hash for the idempotency ledger (don't apply the same response twice).
export function contentHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
