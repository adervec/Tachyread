// AI cowork / API glue for the Literary Journey. PURE builders + apply logic (folder + network I/O
// live in the dialog). The model does a LIGHT update by default — refresh rec-scores, a short read-next
// list, and a paragraph of analysis; the app writes the instruction into the cowork folder so Claude
// (or a desktop cowork agent) knows the task. The user can switch to a HEAVY custom instruction (e.g.
// "rebuild the tech tree"); once a heavy result is applied the instruction resets back to light. See
// journeyAi.demo.mjs.

import { libraryStats, readStatus, finishMs, sortBooks } from './journeyLibrary.js';

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

// Compact projection sent to the model. Light = summary + recent finishes + top unread candidates
// (small enough for the API's context). Heavy additionally carries every book (cowork only — too big
// for the API, which is why heavy tree-rebuilds go through the folder round-trip).
export function buildDataset(books, { light = true } = {}) {
  const stats = libraryStats(books);
  const recent = sortBooks(books.filter((b) => readStatus(b) === 'finished' && finishMs(b) != null), 'finished')
    .slice(0, 20).map((b) => compact(b, ['id', 'title', 'author', 'genre', 'subgenre', 'difficultyLevel', 'finishTime', 'rating']));
  const unread = sortBooks(books.filter((b) => readStatus(b) === 'toread'), 'rec')
    .slice(0, 40).map((b) => compact(b, ['id', 'title', 'author', 'genre', 'difficultyLevel', 'recScore']));
  const ds = {
    summary: { total: stats.total, finished: stats.finished, fiction: stats.fiction, nonfiction: stats.nonfiction, byGenre: stats.byGenre },
    recentFinishes: recent, unreadCandidates: unread,
  };
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
