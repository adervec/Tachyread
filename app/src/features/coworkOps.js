// Well-defined cowork operations — the replacement for the free-text custom instruction.
//
// Each operation has a FIXED instruction and its own WRITE PERMISSION (`allow`). The reply is never
// trusted to stay in its lane: `sanitizeOutput` keeps only what the operations that were actually
// requested may change and drops the rest (listing what it dropped and why). What survives becomes
// review rows (`planRows`) — one per proposed change, old → new — and only ticked rows are applied
// (`buildApply`), which also returns an undo snapshot of everything it touches.
//
// Permissions:
//   analysis / recommendations / brief / weeklies / treeMeta  — the AI record only (never a book)
//   fields: { field: { blanks?: true, unreadOnly?: true } }   — book fields; blanks = only where the
//                                                               book has no value; unreadOnly = only
//                                                               to-read books that are in no queue
//   aiNotes / crossNotes                                       — append AI notes (never the user's notes)
//   bindings: 'unlinked'                                       — link a file that has NO link yet
// Pure; see coworkOps.test.mjs.
import { readStatus } from './journeyLibrary.js';
import { AI_NOTE_TYPES } from './journeyAi.js';

const NEVER = 'Titles, authors, ids, reading/finished status and dates, ratings, your own notes, queues, reading progress and history, file links that already exist.';

// id → { icon, group, label, heavy, instruction, allow, explain: { sends, changes, review } }
export const COWORK_OPS = {
  'cw-brief': {
    icon: '☀️', group: 'report', label: 'Morning brief', heavy: false,
    instruction: 'MORNING BRIEF. Using the dataset AND the read-only activity files in the snapshot/ folder (see snapshot/README.md), write a short morning brief in Markdown: yesterday and the last 7 days across reading (words, time, speed, books moved forward or finished), typing practice, reading aloud and narration; progress on goals and queues (with finish estimates); one or two concrete, encouraging suggestions for today. Ground every number in the data. Return it as `brief`.',
    allow: { brief: true },
    explain: {
      sends: 'The compact dataset (library summary, recent finishes, unread candidates, 9 weeks of reading progress). The agent also reads the snapshot/ files in the folder.',
      changes: 'Adds one dated brief (Markdown text) to the AI record — shown on the Cowork page. Writes nothing to any book.',
      review: 'Report only: safe to apply automatically. Replacing a brief for the same date keeps the old one in undo.',
    },
  },
  'cw-weeklies': {
    icon: '🗓', group: 'report', label: 'Weekly summaries', heavy: false,
    instruction: 'WEEKLY SUMMARIES. For each completed week in progress.weeklySummaries, return `weeklies` [{week, text}] with a better-written short paragraph grounded ONLY in that week\'s numbers.',
    allow: { weeklies: true },
    explain: {
      sends: 'The compact dataset including progress.weeklySummaries (the app\'s own algorithmic summary of each completed week).',
      changes: 'Replaces the summary TEXT shown for completed weeks in Analytics → weekly summaries. No book changes.',
      review: 'Report only. Each week is its own row; undo restores the previous text.',
    },
  },
  'cw-light': {
    icon: '🔄', group: 'report', label: 'Reading-profile analysis + read-next list', heavy: false,
    instruction: 'ANALYSIS + READ NEXT. Write a 1–2 paragraph `analysis` of the reading profile from recent finishes and progress, and a `recommendations` list of 5–10 books to read next drawn from the unread candidates (title, author, why).',
    allow: { analysis: true, recommendations: true },
    explain: {
      sends: 'The compact dataset (library summary, last 20 finishes, top 40 unread candidates, reading progress).',
      changes: 'Replaces the Dashboard\'s analysis paragraph (the old one is archived under "Previous AI analyses") and the read-next list. No book changes — rec scores are a separate operation now.',
      review: 'Report only — applied automatically when scheduled via the API.',
    },
  },
  'cw-fill-genre': {
    icon: '🏷', group: 'fill', label: 'Fill missing genre / subgenre', heavy: true,
    instruction: 'FILL MISSING GENRE. For books in allBooks whose `missing` list includes "genre" and/or "subgenre", return bookPatches with ONLY those missing fields. Do not patch any book that already has the field.',
    allow: { fields: { genre: { blanks: true }, subgenre: { blanks: true } } },
    explain: {
      sends: 'The full library list (id, title, author, genre, type, status, dates, and which fields are missing).',
      changes: 'Sets genre / subgenre ONLY on books where that field is empty. A value you already have is never overwritten — any reply that tries is dropped.',
      review: 'Every proposed value is a row (book, field, — → new value) you can untick before applying. Undo restores the books exactly.',
    },
  },
  'cw-fill-desc': {
    icon: '📝', group: 'fill', label: 'Fill missing descriptions / synopses', heavy: true,
    instruction: 'FILL MISSING DESCRIPTIONS. For books whose `missing` list includes "description" and/or "synopsis", return bookPatches with ONLY those fields: description = one neutral sentence on what the book is; synopsis = 2–4 spoiler-free sentences. Skip books you do not know.',
    allow: { fields: { description: { blanks: true }, synopsis: { blanks: true } } },
    explain: {
      sends: 'The full library list (as above).',
      changes: 'Sets description / synopsis ONLY where empty. Existing text is never replaced.',
      review: 'Row per field; untick any you don\'t like. Undo restores.',
    },
  },
  'cw-fill-type': {
    icon: '🗂', group: 'fill', label: 'Fill missing content types', heavy: true,
    instruction: 'FILL MISSING CONTENT TYPES. For books whose `missing` list includes "type", return bookPatches with `type` ∈ "long" | "short" | "article" | "ai-gen" | "poetry" | "reference".',
    allow: { fields: { type: { blanks: true } } },
    explain: {
      sends: 'The full library list.',
      changes: 'Sets the content type (long-form, short-form, article, AI-generated, poetry, reference) ONLY on books that have none.',
      review: 'Row per book. Undo restores.',
    },
  },
  'cw-rescore': {
    icon: '★', group: 'targeted', label: 'Rescore recommendations (unread only)', heavy: true,
    instruction: 'RESCORE. Recompute recScore (0–10) for to-read books you can judge, from the reading profile. Return bookPatches with ONLY recScore.',
    allow: { fields: { recScore: { unreadOnly: true } } },
    explain: {
      sends: 'The full library list with current rec scores.',
      changes: 'Changes the rec score (★) of TO-READ books that are in no queue. Finished, reading, abandoned and queued books are never touched — those patches are dropped.',
      review: 'Row per book showing old → new score; untick any. Undo restores.',
    },
  },
  'cw-links': {
    icon: '📎', group: 'targeted', label: 'Suggest links for unlinked files', heavy: false,
    instruction: 'LINK FILES. progress.files lists every opened file with its current link (bookId may be null). For files with NO link only, return `bindings` [{checksum, bookId}] pairing the file with the library book it clearly is. Skip anything uncertain.',
    allow: { bindings: 'unlinked' },
    explain: {
      sends: 'The compact dataset with progress.files (file names, checksums, current links).',
      changes: 'Links a file to a tracker book ONLY when the file has no link yet. An existing link is never replaced — such suggestions are dropped.',
      review: 'Row per file → book; untick any. Undo removes the new links.',
    },
  },
  'cw-notes': {
    icon: '💡', group: 'targeted', label: 'Book notes (summaries, insights, parallels)', heavy: true,
    instruction: 'BOOK NOTES. For books that have been read or are being read, return `aiNotes` [{bookId, type, sectionTitle?, text}] (types: summary | section-summary | insight | critique | parallel | comparison | other) and optional `crossNotes` spanning several bookIds or a series. Keep each note short and specific.',
    allow: { aiNotes: true, crossNotes: true },
    explain: {
      sends: 'The full library list.',
      changes: 'Adds AI notes to books (a separate AI-notes list, spoiler-protected until read) and shared notes across books. Your own notes field is never written. Notes are only added, never edited or removed.',
      review: 'Row per note. Undo removes the added notes.',
    },
  },
  'cw-classify': {
    icon: '🔍', group: 'targeted', label: 'Audit content types', heavy: true,
    instruction: 'AUDIT CONTENT TYPES. Return bookPatches with `type` ONLY for books whose current type is clearly wrong or missing ("long" | "short" | "article" | "ai-gen" | "poetry" | "reference").',
    allow: { fields: { type: {} } },
    explain: {
      sends: 'The full library list with current types.',
      changes: 'May change a book\'s content type even when one is set (that is the point of an audit). Nothing else.',
      review: 'Row per book, old → new type. Untick anything you disagree with; types you set by hand are worth a look. Undo restores.',
    },
  },
  'cw-tree': {
    icon: '🌳', group: 'targeted', label: 'Rebuild tech tree', heavy: true,
    instruction: 'TECH TREE. Return treeMeta.pos (x,y in -500..500 per book id) and treeMeta.edges ([idA, idB, "influence"|"prereq"|"series"]) for lineage between books in the library.',
    allow: { treeMeta: true },
    explain: {
      sends: 'The full library list.',
      changes: 'Replaces the Tech Tree layout (positions + edges). No book changes.',
      review: 'One row. Undo restores the previous layout.',
    },
  },
  'cw-graph': {
    icon: '🕸', group: 'targeted', label: 'Rebuild knowledge graph', heavy: true,
    instruction: 'KNOWLEDGE GRAPH. Return treeMeta.pos and treeMeta.edges as [idA, idB, kind], kind ∈ "influence" | "prereq" | "series" | "same-author" | "theme" | "contrast" | "responds" | "similarity" | "opposed" | "same-universe". 1–4 real edges per book.',
    allow: { treeMeta: true },
    explain: {
      sends: 'The full library list.',
      changes: 'Replaces the constellation\'s layout and typed edges. No book changes.',
      review: 'One row. Undo restores the previous layout.',
    },
  },
};
export const OP_GROUPS = [
  { id: 'report', label: 'Reports — change no books' },
  { id: 'fill', label: 'Fill blanks — never overwrite' },
  { id: 'targeted', label: 'Targeted changes — always reviewed' },
];
export const NEVER_CHANGED = NEVER;
export const isReportOnly = (ids) => ids.every((id) => COWORK_OPS[id]?.group === 'report');

// Union of the requested operations' permissions. Field rules from several ops merge per field; a
// field allowed without restriction by any op wins over a restricted one.
export function combinedAllow(ids) {
  const out = { fields: {} };
  for (const id of ids) {
    const a = COWORK_OPS[id]?.allow;
    if (!a) continue;
    for (const k of ['analysis', 'recommendations', 'brief', 'weeklies', 'treeMeta', 'aiNotes', 'crossNotes']) if (a[k]) out[k] = true;
    if (a.bindings) out.bindings = a.bindings;
    for (const [f, rule] of Object.entries(a.fields || {})) {
      const cur = out.fields[f];
      out.fields[f] = !cur ? { ...rule, op: id } : (Object.keys(rule).length === 0 ? { op: id } : cur);
    }
  }
  return out;
}

// The reply schema listing ONLY what these operations may return.
export function schemaFor(ids) {
  const a = combinedAllow(ids);
  const parts = [];
  if (a.brief) parts.push('"brief": {"date": "YYYY-MM-DD", "text": "markdown"}');
  if (a.analysis) parts.push('"analysis": string');
  if (a.recommendations) parts.push('"recommendations": [{"title","author","why"}]');
  if (a.weeklies) parts.push('"weeklies": [{"week": "YYYY-MM-DD (Monday)", "text"}]');
  const fs = Object.keys(a.fields);
  if (fs.length) parts.push(`"bookPatches": [{"id", ${fs.map((f) => `"${f}"?`).join(', ')}}]`);
  if (a.aiNotes) parts.push('"aiNotes": [{"bookId","type","sectionTitle"?,"text"}]');
  if (a.crossNotes) parts.push('"crossNotes": [{"bookIds":["<id>",…],"series"?,"type","text"}]');
  if (a.bindings) parts.push('"bindings": [{"checksum","bookId"}]');
  if (a.treeMeta) parts.push('"treeMeta": {"pos": {"<id>": {"x","y"}}, "edges": [["<idA>","<idB>","<kind>"]]}');
  return `{ ${parts.join(', ')} }`;
}

// One combined request instruction for the ticked operations.
export function opsInstruction(ids) {
  const ops = ids.filter((id) => COWORK_OPS[id]);
  if (!ops.length) return null;
  return {
    mode: ops.some((id) => COWORK_OPS[id].heavy) ? 'heavy' : 'light',
    ops,
    text: [
      `Do ONLY these ${ops.length} task(s). The app discards anything in your reply that these tasks may not change.`,
      ...ops.map((id, i) => `${i + 1}. ${COWORK_OPS[id].instruction}`),
      `Reply schema (only these keys): ${schemaFor(ops)}`,
    ].join('\n'),
  };
}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const short = (v) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…` : v);

// Keep only what the requested operations may change. ctx: { booksById, bindMap, queuedIds:Set }.
// → { output (sanitized), dropped: [{ what, why }] }
export function sanitizeOutput(raw, ids, { booksById = {}, bindMap = {}, queuedIds = new Set() } = {}) {
  const a = combinedAllow(ids);
  const out = {}, dropped = [];
  const drop = (what, why) => dropped.push({ what, why });
  for (const k of ['analysis', 'recommendations', 'weeklies', 'treeMeta', 'brief']) {
    if (raw?.[k] == null) continue;
    if (a[k]) out[k] = raw[k]; else drop(k, 'not part of the requested operations');
  }
  for (const k of ['archetypeMeta']) if (raw?.[k] != null) drop(k, 'not part of any operation');
  const patches = [];
  for (const p of raw?.bookPatches || []) {
    const book = booksById[p?.id];
    if (!book) { drop(`patch for unknown book ${p?.id}`, 'no such book'); continue; }
    const keep = { id: p.id };
    for (const [f, v] of Object.entries(p)) {
      if (f === 'id') continue;
      const rule = a.fields[f];
      if (!rule) { drop(`${book.title}: ${f}`, 'field not allowed by the requested operations'); continue; }
      if (rule.blanks && !blank(book[f])) { drop(`${book.title}: ${f}`, 'already has a value (fill-blanks only)'); continue; }
      if (rule.unreadOnly && (readStatus(book) !== 'toread' || queuedIds.has(book.id))) { drop(`${book.title}: ${f}`, 'not an unqueued to-read book'); continue; }
      if (JSON.stringify(book[f]) === JSON.stringify(v)) continue; // no actual change
      keep[f] = v;
    }
    if (Object.keys(keep).length > 1) patches.push(keep);
  }
  if (patches.length) out.bookPatches = patches;
  for (const k of ['aiNotes', 'crossNotes']) {
    if (!raw?.[k]?.length) continue;
    if (a[k]) out[k] = raw[k]; else drop(`${raw[k].length} ${k}`, 'not part of the requested operations');
  }
  if (raw?.bindings?.length) {
    if (!a.bindings) drop(`${raw.bindings.length} file link(s)`, 'not part of the requested operations');
    else {
      out.bindings = raw.bindings.filter((b) => {
        if (!b?.checksum || !booksById[b.bookId]) { drop(`link ${b?.checksum || '?'}`, 'unknown file or book'); return false; }
        if (bindMap[b.checksum]) { drop(`link ${b.checksum.slice(0, 8)}…`, 'file is already linked — links are never replaced'); return false; }
        return true;
      });
    }
  }
  return { output: out, dropped };
}

// Sanitized output → review rows: [{ key, kind, label, from, to, ...payload }], all ticked by default.
export function planRows(output, { booksById = {}, files = {} } = {}) {
  const rows = [];
  const title = (id) => booksById[id]?.title || id;
  if (output.brief) rows.push({ key: 'brief', kind: 'brief', label: `Morning brief ${output.brief.date || ''}`.trim(), to: short(output.brief.text), value: output.brief });
  if (output.analysis) rows.push({ key: 'analysis', kind: 'analysis', label: 'Dashboard analysis', to: short(output.analysis), value: output.analysis });
  if (output.recommendations) rows.push({ key: 'recs', kind: 'recommendations', label: `Read-next list (${output.recommendations.length})`, to: output.recommendations.map((r) => r.title).join(', '), value: output.recommendations });
  for (const w of output.weeklies || []) {
    const week = String(w?.week || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(week) && String(w.text || '').trim()) rows.push({ key: `wk:${week}`, kind: 'weekly', label: `Week of ${week}`, to: short(w.text), value: { week, text: String(w.text).trim() } });
  }
  if (output.treeMeta) rows.push({ key: 'tree', kind: 'treeMeta', label: 'Tech tree / knowledge graph layout', to: `${Object.keys(output.treeMeta.pos || {}).length} positions, ${(output.treeMeta.edges || []).length} edges`, value: output.treeMeta });
  for (const p of output.bookPatches || []) {
    for (const [f, v] of Object.entries(p)) {
      if (f === 'id') continue;
      rows.push({ key: `f:${p.id}:${f}`, kind: 'field', label: `${title(p.id)} — ${f}`, from: short(booksById[p.id]?.[f]), to: short(v), bookId: p.id, field: f, value: v });
    }
  }
  (output.aiNotes || []).forEach((n, i) => {
    if (!booksById[n?.bookId] || !String(n?.text || '').trim()) return;
    rows.push({ key: `n:${i}`, kind: 'note', label: `${title(n.bookId)} — ${AI_NOTE_TYPES[n.type] || 'Note'}${n.sectionTitle ? ` (${n.sectionTitle})` : ''}`, to: short(n.text), value: n });
  });
  (output.crossNotes || []).forEach((n, i) => {
    if (!String(n?.text || '').trim()) return;
    const ids = (n.bookIds || []).filter((id) => booksById[id]);
    if (!ids.length && !n.series) return;
    rows.push({ key: `x:${i}`, kind: 'cross', label: `Shared note — ${n.series || ids.map(title).join(' + ')}`, to: short(n.text), value: { bookIds: ids, series: n.series || null, type: AI_NOTE_TYPES[n.type] ? n.type : 'other', text: String(n.text).trim() } });
  });
  for (const b of output.bindings || []) rows.push({ key: `l:${b.checksum}`, kind: 'link', label: `Link ${files[b.checksum]?.fileName || `${b.checksum.slice(0, 8)}…`}`, from: '(unlinked)', to: title(b.bookId), value: b });
  return rows;
}

// Ticked rows → what to write, plus the undo snapshot. Pure: the caller does the I/O.
// → { bookUpdates, crossNoteAdds, bindingAdds, aiNext, undo }
export function buildApply(rows, { booksById = {}, ai = {}, now = Date.now() } = {}) {
  const working = new Map();
  const book = (id) => { if (!working.has(id)) working.set(id, { ...booksById[id] }); return working.get(id); };
  const aiNext = { ...(ai || {}) };
  const undo = { at: now, books: [], links: [], crossTexts: [], ai: {} };
  const keepAi = (k) => { if (!(k in undo.ai)) undo.ai[k] = ai?.[k] === undefined ? null : ai[k]; };
  const crossNoteAdds = [], bindingAdds = [];
  for (const r of rows) {
    if (r.kind === 'field') book(r.bookId)[r.field] = r.value;
    else if (r.kind === 'note') {
      const b = book(r.value.bookId);
      const list = Array.isArray(b.aiNotes) ? [...b.aiNotes] : [];
      const text = String(r.value.text).trim();
      if (!list.some((x) => x.text === text)) list.push({ type: AI_NOTE_TYPES[r.value.type] ? r.value.type : 'other', ...(r.value.sectionTitle ? { sectionTitle: String(r.value.sectionTitle) } : {}), text, createdAt: now });
      b.aiNotes = list.slice(-40);
    } else if (r.kind === 'cross') { crossNoteAdds.push(r.value); undo.crossTexts.push(r.value.text); }
    else if (r.kind === 'link') { bindingAdds.push(r.value); undo.links.push(r.value.checksum); }
    else if (r.kind === 'analysis') {
      keepAi('analysis'); keepAi('analysisHistory'); keepAi('updatedAt');
      if (ai?.analysis && ai.analysis !== r.value) aiNext.analysisHistory = [{ text: ai.analysis, at: ai.updatedAt || now }, ...(ai.analysisHistory || [])].slice(0, 20);
      aiNext.analysis = r.value; aiNext.updatedAt = now;
    } else if (r.kind === 'recommendations') { keepAi('recommendations'); aiNext.recommendations = r.value; }
    else if (r.kind === 'treeMeta') { keepAi('treeMeta'); aiNext.treeMeta = r.value; }
    else if (r.kind === 'weekly') { keepAi('weeklies'); aiNext.weeklies = { ...(aiNext.weeklies || {}), [r.value.week]: { text: r.value.text, at: now } }; }
    else if (r.kind === 'brief') {
      keepAi('briefs');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.value.date || '')) ? r.value.date : new Date(now).toISOString().slice(0, 10);
      const briefs = { ...(aiNext.briefs || {}), [date]: { text: String(r.value.text || ''), at: now } };
      aiNext.briefs = Object.fromEntries(Object.entries(briefs).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 60));
    }
  }
  for (const id of working.keys()) undo.books.push(booksById[id]);
  return { bookUpdates: [...working.values()], crossNoteAdds, bindingAdds, aiNext, undo };
}

// Short "what was applied" line for the log.
export function applySummary(rows) {
  const n = (k) => rows.filter((r) => r.kind === k).length;
  const parts = [
    n('field') && `${n('field')} book field${n('field') === 1 ? '' : 's'}`,
    n('note') && `${n('note')} note${n('note') === 1 ? '' : 's'}`,
    n('cross') && `${n('cross')} shared note${n('cross') === 1 ? '' : 's'}`,
    n('link') && `${n('link')} file link${n('link') === 1 ? '' : 's'}`,
    n('weekly') && `${n('weekly')} weekly summar${n('weekly') === 1 ? 'y' : 'ies'}`,
    n('analysis') && 'analysis', n('recommendations') && 'read-next list', n('treeMeta') && 'tree layout', n('brief') && 'morning brief',
  ].filter(Boolean);
  return parts.join(', ') || 'nothing';
}
