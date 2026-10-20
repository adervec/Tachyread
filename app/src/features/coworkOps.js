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
//   answer                                                     — a text answer (AI record only)
//   queueOrder                                                 — reorder a queue (same books, new order)
//   duplicates                                                 — suggest duplicate pairs for the Reconcile table
//   reports: kind                                              — a titled report text (AI record only)
//   newBooks                                                   — CREATE new to-read books (never edit existing)
//   addTags                                                    — add tags to books (never remove one)
//   vocab / typingPlan                                         — add vocab cards / one new typing plan (app settings)
//   renames: [fields]                                          — rename a value of those fields on every book using it
//   goalAdvice                                                 — set the yearly books / words goal
// A book marked LOCKED (book.locked) is never changed by any operation — such items are dropped.
// Pure; see coworkOps.test.mjs.
import { readStatus, deriveId, setReadStatus, bookTags } from './journeyLibrary.js';
import { dupKey } from './journeyCleanup.js';
import { TYPING_MODES } from '../engine/typingModes.js';

const TYPING_MODE_IDS = TYPING_MODES.filter((m) => m.kind !== 'doc').map((m) => m.id);
import { liveQueues, queueBooks } from './readingQueues.js';
import { AI_NOTE_TYPES } from './journeyAi.js';

const NEVER = 'Titles, authors, ids, reading/finished status and dates, ratings, your own notes, queues, reading progress and history, file links that already exist — and anything about a book you have locked (🔒).';

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
  'cw-retro': {
    icon: '📆', group: 'report', label: 'Weekly review / monthly retrospective', heavy: false,
    instruction: 'RETROSPECTIVE. From the snapshot/ files (activity-log.md, reading-days.json, goals.json, queues.json, typing.json, speaking.json) write a review of the last 7 days and the last 30 days: totals against the previous period, trends in speed and consistency, best and weakest days, goal pace, queue movement, what slipped — then 3 specific suggestions. Ground every number in the data. Return it as `reports` [{kind: "retro", title, text (Markdown)}].',
    allow: { reports: 'retro' },
    explain: {
      sends: 'The compact dataset; the agent reads the snapshot/ files for the detail.',
      changes: 'Stores one titled report on the Cowork page (Reports, newest first). Writes nothing to any book, queue or link.',
      review: 'Report only. Undo removes it.',
    },
  },
  'cw-typing-coach': {
    icon: '⌨️', group: 'report', label: 'Typing coach', heavy: false,
    instruction: 'TYPING COACH. From snapshot/typing.json analyse typing practice: net/gross WPM and accuracy trends, consistency, the most-missed keys and what they suggest (fingers, rows, symbols), whether recent runs are improving, and give 3–5 concrete drills or settings to try next. Return it as `reports` [{kind: "typing", title, text (Markdown)}].',
    allow: { reports: 'typing' },
    explain: {
      sends: 'The compact dataset; the agent reads snapshot/typing.json (runs, weekly aggregates, most-missed keys).',
      changes: 'Stores one titled report on the Cowork page (Reports, newest first). Writes nothing to any book, queue or link.',
      review: 'Report only. Undo removes it.',
    },
  },
  'cw-speak-coach': {
    icon: '🗣', group: 'report', label: 'Reading-aloud coach', heavy: false,
    instruction: 'READING-ALOUD COACH. From snapshot/speaking.json (reading-aloud sessions: match quality, exact/near/skipped words, voice scores and per-minute trends) and snapshot/narration.json (self-recorded narration quality), describe how reading aloud is going and trending, the weakest voice attributes, and give 3–5 concrete practice cues. Return it as `reports` [{kind: "speaking", title, text (Markdown)}].',
    allow: { reports: 'speaking' },
    explain: {
      sends: 'The compact dataset; the agent reads snapshot/speaking.json and snapshot/narration.json.',
      changes: 'Stores one titled report on the Cowork page (Reports, newest first). Writes nothing to any book, queue or link.',
      review: 'Report only. Undo removes it.',
    },
  },
  'cw-narration-qa': {
    icon: '🎙', group: 'report', label: 'Narration QA', heavy: false,
    instruction: 'NARRATION QA. From snapshot/narration.json list the self-recorded audiobook chunks worth re-recording (low score, accuracy or completeness), grouped by book with the line number and why, plus overall patterns in the recordings. Return it as `reports` [{kind: "narration", title, text (Markdown)}].',
    allow: { reports: 'narration' },
    explain: {
      sends: 'The compact dataset; the agent reads snapshot/narration.json (per-take quality only — no audio).',
      changes: 'Stores one titled report on the Cowork page (Reports, newest first). Writes nothing to any book, queue or link.',
      review: 'Report only. Undo removes it.',
    },
  },
  'cw-health': {
    icon: '🩺', group: 'report', label: 'Data-health report', heavy: false,
    instruction: 'DATA HEALTH. Using allBooks and snapshot/books.json, list inconsistencies worth fixing by hand: finished books without a rating or finish date, implausible page or word counts, genre or author name variants that look like the same thing, books stuck as reading for months, files read past 99% but not marked finished. A list only — suggest the fix for each. Return it as `reports` [{kind: "health", title, text (Markdown)}].',
    allow: { reports: 'health' },
    explain: {
      sends: 'The full library list; the agent reads snapshot/books.json.',
      changes: 'Stores one titled report on the Cowork page (Reports, newest first). Writes nothing to any book, queue or link.',
      review: 'Report only. Undo removes it.',
    },
  },
  'cw-ask': {
    icon: '❓', group: 'report', label: 'Ask a question', heavy: false, needsQuestion: true,
    instruction: 'QUESTION. Answer this question about the reader\'s reading, typing, speaking or library, using the dataset and the snapshot/ files; be concrete and cite the numbers you use: «{question}». Return the answer as `answer` (Markdown).',
    allow: { answer: true },
    explain: {
      sends: 'Your question (typed below when this is ticked) and the compact dataset; the agent can also read the snapshot/ files.',
      changes: 'Stores the answer text on the Cowork page (newest first). Writes nothing to any book, queue or link — even if the reply tries to.',
      review: 'Report only. Undo removes the answer.',
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
  'cw-fill-diff': {
    icon: '🎚', group: 'fill', label: 'Estimate missing difficulty', heavy: true,
    instruction: 'FILL MISSING DIFFICULTY. For books whose `missing` list includes "difficultyLevel", return bookPatches with ONLY difficultyLevel as an integer 1 (easy) – 5 (very demanding). Skip books you do not know.',
    allow: { fields: { difficultyLevel: { blanks: true, range: [1, 5] } } },
    explain: {
      sends: 'The full library list.',
      changes: 'Sets the difficulty (1–5) ONLY on books that have none. Out-of-range or non-numeric values are dropped.',
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
  'cw-add-recs': {
    icon: '➕', group: 'add', label: 'Add recommendations as to-read books', heavy: true,
    instruction: 'ADD RECOMMENDATIONS. Suggest up to 15 books NOT already in allBooks that fit the reading profile. Return `newBooks` [{title, author, genre?, pages?, why}]. Never repeat a book that is in the library.',
    allow: { newBooks: true },
    never: 'Every book already in your library — this only creates new ones.',
    explain: {
      sends: 'The full library list (so it can avoid what you already have).',
      changes: 'Creates NEW to-read books (recommended by "Cowork agent", with the reason as a note in their description field). Anything matching a book you already have (same title + author surname) is dropped.',
      review: 'Row per new book; untick any. Undo removes the books it created.',
    },
  },
  'cw-series-gaps': {
    icon: '📚', group: 'add', label: 'Fill series gaps', heavy: true,
    instruction: 'SERIES GAPS. For series in allBooks that the reader has started or finished, return `newBooks` [{title, author, genre?, pages?, why}] for the volumes NOT already in the library (why = "Series #n of <series>"). Never repeat a book that is in the library.',
    allow: { newBooks: true },
    never: 'Every book already in your library — this only creates new ones.',
    explain: {
      sends: 'The full library list (series names and numbers included).',
      changes: 'Creates NEW to-read books for missing series volumes (recommended by "Cowork agent"). Anything matching a book you already have is dropped.',
      review: 'Row per new book. Undo removes the books it created.',
    },
  },
  'cw-tags': {
    icon: '🏷', group: 'add', label: 'Tag suggestions (add only)', heavy: true,
    instruction: 'TAGS. Suggest up to 5 short, reusable tags per book that would help find it (themes, setting, form). Prefer tags already used elsewhere in the library. Return `addTags` [{id, tags: [..]}].',
    allow: { addTags: true },
    explain: {
      sends: 'The full library list with current tags.',
      changes: 'ADDS tags to books (at most 5 new per book). Existing tags are never removed or renamed; tags a book already has are skipped.',
      review: 'Row per book showing current → added tags. Undo restores the books.',
    },
  },
  'cw-vocab': {
    icon: '🔤', group: 'add', label: 'Vocabulary cards', heavy: true,
    instruction: 'VOCABULARY. From the books read or being read (allBooks), propose up to 25 challenging but useful words the reader has likely met, each with a short definition or context. Skip anything in dataset.vocabWords (already in the deck). Return `vocabCards` [{word, context}].',
    allow: { vocab: true },
    never: 'Existing vocabulary cards and their review progress; all books.',
    explain: {
      sends: 'The full library list and the words already in your vocabulary deck.',
      changes: 'Adds NEW cards to Train → Vocabulary. Words already in the deck are skipped; existing cards are never edited.',
      review: 'Row per word. Undo removes the added cards you haven\'t started reviewing.',
    },
  },
  'cw-typing-plan': {
    icon: '🏋️', group: 'add', label: 'Suggest a typing plan', heavy: false,
    instruction: `TYPING PLAN. From snapshot/typing.json design ONE practice plan of 3–8 steps aimed at the weak spots. Each step: mode ∈ ${TYPING_MODE_IDS.join(' | ')}; runMode "seconds" | "words"; runLimit 10–600; sets 1–10; description = a short spoken cue. Return \`typingPlan\` {name, steps: [...]}.`,
    allow: { typingPlan: true },
    never: 'Your existing typing plans and runs.',
    explain: {
      sends: 'The compact dataset; the agent reads snapshot/typing.json.',
      changes: 'Adds ONE new plan to Typing → Plans. Steps with an unknown drill or out-of-range numbers are dropped; your existing plans are untouched.',
      review: 'One row with the plan\'s steps. Undo removes the plan.',
    },
  },
  'cw-genre-merge': {
    icon: '🔀', group: 'targeted', label: 'Merge genre-name variants', heavy: true,
    instruction: 'GENRE VARIANTS. Find genre / subgenre values in allBooks that are the same thing spelled differently (e.g. "Sci-Fi", "SF", "Science fiction"). Return `renames` [{field: "genre" | "subgenre", from, to}] where `to` is the clearest existing spelling. Only clear cases.',
    allow: { renames: ['genre', 'subgenre'] },
    explain: {
      sends: 'The full library list.',
      changes: 'Renames a genre / subgenre value on every book that uses it (e.g. all "Sci-Fi" → "Science fiction"). Only those two fields. Locked books are skipped.',
      review: 'One row PER BOOK affected, so you can keep any book as it was. Undo restores the books.',
    },
  },
  'cw-author-tidy': {
    icon: '✍️', group: 'targeted', label: 'Tidy author names', heavy: true,
    instruction: 'AUTHOR NAMES. Find author values in allBooks that are the same person written differently (initials, punctuation, "Last, First"). Return `renames` [{field: "author", from, to}] where `to` is the fullest common form. Only clear cases.',
    allow: { renames: ['author'] },
    never: 'Titles, ids (a book keeps its id even when its author spelling changes), status, dates, ratings, notes, queues, links — and locked books.',
    explain: {
      sends: 'The full library list.',
      changes: 'Changes the author spelling on every book using the old one. Nothing else.',
      review: 'One row per book affected. Undo restores the books.',
    },
  },
  'cw-goal-advice': {
    icon: '🎯', group: 'targeted', label: 'Goal advice', heavy: false,
    instruction: 'GOALS. From snapshot/goals.json (current goals, pace, streak) and the reading history, suggest realistic but stretching goals for this year. Return `goalAdvice` {books?: integer, words?: integer, why}.',
    allow: { goalAdvice: true },
    never: 'Any book, queue or link — only the yearly goal numbers.',
    explain: {
      sends: 'The compact dataset; the agent reads snapshot/goals.json.',
      changes: 'Sets this year\'s books goal and/or words goal (Dashboard). Implausible numbers are dropped.',
      review: 'Row per goal: current → proposed, with the reason. Undo restores the previous goals.',
    },
  },
  'cw-queue-advice': {
    icon: '🧭', group: 'targeted', label: 'Queue-order advice', heavy: false,
    instruction: 'QUEUE ADVICE. dataset.queues lists each queue in its current order with each book\'s status, length and progress. Suggest a better reading order for any queue that would benefit (variety, momentum, series order, finishing what is nearly done). Return `queueOrder` [{queueId, ids: [EVERY book id of that queue, in the new order], why}].',
    allow: { queueOrder: true },
    never: 'Which books are in a queue (nothing is added, removed or moved between queues), and everything about the books themselves.',
    explain: {
      sends: 'The compact dataset plus your queues (book ids, titles, status, length, progress) in their current order.',
      changes: 'Proposes a new ORDER for a queue — the same books, rearranged. A suggestion that adds, drops or duplicates a book is discarded. Finished books still show at the top of the queue view regardless.',
      review: 'One row per queue with the reason; the queue is only reordered if you tick it and apply. Undo restores the previous order.',
    },
  },
  'cw-dupes': {
    icon: '👯', group: 'targeted', label: 'Spot likely duplicates', heavy: true,
    instruction: 'DUPLICATES. Find pairs of entries in allBooks that are the same work (e.g. a recommendation and a file-titled entry, different editions, typos). Return `duplicates` [{keepId (the entry with better metadata), foldId, why}]. Only clear cases.',
    allow: { duplicates: true },
    never: 'Any book — nothing is merged here.',
    explain: {
      sends: 'The full library list.',
      changes: 'Nothing directly. Suggested pairs are saved for Import / Export → Reconcile quick-added copies, where they appear (marked 🤖) next to the scan\'s own pairs with the full preview — and only merge if you tick them there.',
      review: 'Row per pair here; applying only stores the suggestion. Undo removes the suggestions.',
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
// Queues as the request dataset carries them (for queue advice): order, and enough per book to judge.
export const queuesForDataset = (queues, books) => liveQueues(queues || []).map((q) => ({
  id: q.id, name: q.name,
  books: queueBooks(q, books || []).map((b) => ({ id: b.id, title: b.title, author: b.author || null, genre: b.genre || null, status: readStatus(b), words: Number(b.words) || (Number(b.pages) ? Number(b.pages) * 275 : null), series: b.series || null, seriesNum: b.seriesNum ?? null })),
}));

export const OP_GROUPS = [
  { id: 'report', label: 'Reports — change no books' },
  { id: 'fill', label: 'Fill blanks — never overwrite' },
  { id: 'add', label: 'Add-only — never edit what you have' },
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
    for (const k of ['analysis', 'recommendations', 'brief', 'weeklies', 'treeMeta', 'aiNotes', 'crossNotes', 'answer', 'queueOrder', 'duplicates']) if (a[k]) out[k] = true;
    if (a.bindings) out.bindings = a.bindings;
    if (a.reports) out.reports = [...(out.reports || []), a.reports];
    if (a.newBooks) out.newBooks = true;
    if (a.addTags) out.addTags = true;
    if (a.vocab) out.vocab = true;
    if (a.typingPlan) out.typingPlan = true;
    if (a.goalAdvice) out.goalAdvice = true;
    if (a.renames) out.renames = [...new Set([...(out.renames || []), ...a.renames])];
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
  if (a.answer) parts.push('"answer": "markdown"');
  if (a.queueOrder) parts.push('"queueOrder": [{"queueId", "ids": ["<every id of that queue>"], "why"}]');
  if (a.duplicates) parts.push('"duplicates": [{"keepId", "foldId", "why"}]');
  if (a.reports) parts.push(`"reports": [{"kind": ${a.reports.map((k) => `"${k}"`).join(' | ')}, "title", "text": "markdown"}]`);
  if (a.newBooks) parts.push('"newBooks": [{"title", "author", "genre"?, "pages"?, "why"}]');
  if (a.addTags) parts.push('"addTags": [{"id", "tags": ["…"]}]');
  if (a.vocab) parts.push('"vocabCards": [{"word", "context"}]');
  if (a.typingPlan) parts.push('"typingPlan": {"name", "steps": [{"mode", "runMode", "runLimit", "sets", "description"}]}');
  if (a.renames) parts.push(`"renames": [{"field": ${a.renames.map((f) => `"${f}"`).join(' | ')}, "from", "to"}]`);
  if (a.goalAdvice) parts.push('"goalAdvice": {"books"?, "words"?, "why"}');
  return `{ ${parts.join(', ')} }`;
}

// One combined request instruction for the ticked operations.
export function opsInstruction(ids, { question = '' } = {}) {
  const ops = ids.filter((id) => COWORK_OPS[id] && (!COWORK_OPS[id].needsQuestion || String(question).trim()));
  if (!ops.length) return null;
  return {
    mode: ops.some((id) => COWORK_OPS[id].heavy) ? 'heavy' : 'light',
    ops,
    text: [
      `Do ONLY these ${ops.length} task(s). The app discards anything in your reply that these tasks may not change.`,
      ...ops.map((id, i) => `${i + 1}. ${COWORK_OPS[id].instruction.replace('{question}', String(question).trim())}`),
      `Reply schema (only these keys): ${schemaFor(ops)}`,
    ].join('\n'),
  };
}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const short = (v) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…` : v);

// Keep only what the requested operations may change. ctx: { booksById, bindMap, queuedIds:Set }.
// → { output (sanitized), dropped: [{ what, why }] }
export function sanitizeOutput(raw, ids, { booksById = {}, bindMap = {}, queuedIds = new Set(), queues = [], vocabWords = [] } = {}) {
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
    if (book.locked) { drop(`${book.title}: ${Object.keys(p).filter((k) => k !== 'id').join(', ')}`, 'book is locked 🔒'); continue; }
    const keep = { id: p.id };
    for (const [f, v] of Object.entries(p)) {
      if (f === 'id') continue;
      const rule = a.fields[f];
      if (!rule) { drop(`${book.title}: ${f}`, 'field not allowed by the requested operations'); continue; }
      if (rule.blanks && !blank(book[f])) { drop(`${book.title}: ${f}`, 'already has a value (fill-blanks only)'); continue; }
      if (rule.unreadOnly && (readStatus(book) !== 'toread' || queuedIds.has(book.id))) { drop(`${book.title}: ${f}`, 'not an unqueued to-read book'); continue; }
      if (rule.range && !(Number.isInteger(Number(v)) && Number(v) >= rule.range[0] && Number(v) <= rule.range[1])) { drop(`${book.title}: ${f} = ${v}`, `must be a whole number ${rule.range[0]}–${rule.range[1]}`); continue; }
      if (JSON.stringify(book[f]) === JSON.stringify(v)) continue; // no actual change
      keep[f] = v;
    }
    if (Object.keys(keep).length > 1) patches.push(keep);
  }
  if (patches.length) out.bookPatches = patches;
  for (const k of ['aiNotes', 'crossNotes']) {
    if (!raw?.[k]?.length) continue;
    if (!a[k]) { drop(`${raw[k].length} ${k}`, 'not part of the requested operations'); continue; }
    out[k] = raw[k].filter((n) => {
      const ids = k === 'aiNotes' ? [n?.bookId] : (n?.bookIds || []);
      const locked = ids.map((id) => booksById[id]).find((b) => b?.locked);
      if (locked) { drop(`note on ${locked.title}`, 'book is locked 🔒'); return false; }
      return true;
    });
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
  if (raw?.reports?.length) {
    out.reports = raw.reports.filter((r) => {
      if (!(a.reports || []).includes(r?.kind) || !String(r?.text || '').trim()) { drop(`report ${r?.kind || '?'}`, 'not part of the requested operations'); return false; }
      return true;
    });
  }
  if (raw?.newBooks?.length) {
    if (!a.newBooks) drop(`${raw.newBooks.length} new book(s)`, 'not part of the requested operations');
    else {
      const have = new Set(Object.values(booksById).filter((b) => !b.deleted).map(dupKey).filter(Boolean));
      out.newBooks = raw.newBooks.slice(0, 30).filter((nb) => {
        const k = dupKey(nb || {});
        if (!k || !String(nb.author || '').trim()) { drop(`new book ${nb?.title || '?'}`, 'needs a title and an author'); return false; }
        if (have.has(k)) { drop(`new book ${nb.title}`, 'already in your library'); return false; }
        have.add(k);
        return true;
      });
    }
  }
  if (raw?.addTags?.length) {
    if (!a.addTags) drop(`${raw.addTags.length} tag suggestion(s)`, 'not part of the requested operations');
    else {
      out.addTags = raw.addTags.map((t) => {
        const book = booksById[t?.id];
        if (!book) { drop(`tags for ${t?.id}`, 'no such book'); return null; }
        if (book.locked) { drop(`tags for ${book.title}`, 'book is locked 🔒'); return null; }
        const have = new Set(bookTags(book).map((x) => x.toLowerCase()));
        const add = [...new Set((Array.isArray(t.tags) ? t.tags : []).map((x) => String(x).trim()).filter((x) => x && x.length <= 40 && !have.has(x.toLowerCase())))].slice(0, 5);
        return add.length ? { id: t.id, tags: add } : null;
      }).filter(Boolean);
    }
  }
  if (raw?.vocabCards?.length) {
    if (!a.vocab) drop(`${raw.vocabCards.length} vocabulary card(s)`, 'not part of the requested operations');
    else {
      const have = new Set(vocabWords.map((w) => String(w).toLowerCase()));
      out.vocabCards = raw.vocabCards.slice(0, 50).filter((c) => {
        const w = String(c?.word || '').trim();
        if (!/^[\p{L}'’-]{2,40}$/u.test(w)) { drop(`card “${w}”`, 'not a single word'); return false; }
        if (have.has(w.toLowerCase())) { drop(`card “${w}”`, 'already in the deck'); return false; }
        have.add(w.toLowerCase());
        return true;
      }).map((c) => ({ word: String(c.word).trim(), context: String(c.context || '').slice(0, 300) }));
    }
  }
  if (raw?.typingPlan) {
    if (!a.typingPlan) drop('typing plan', 'not part of the requested operations');
    else {
      const steps = (raw.typingPlan.steps || []).slice(0, 12).filter((st) => {
        const ok = TYPING_MODE_IDS.includes(st?.mode) && ['seconds', 'words'].includes(st?.runMode)
          && Number(st.runLimit) >= 10 && Number(st.runLimit) <= 600 && Number(st.sets || 1) >= 1 && Number(st.sets || 1) <= 10;
        if (!ok) drop(`plan step ${st?.mode || '?'}`, 'unknown drill or out-of-range numbers');
        return ok;
      }).map((st) => ({ mode: st.mode, runMode: st.runMode, runLimit: Math.round(Number(st.runLimit)), sets: Math.round(Number(st.sets || 1)), description: String(st.description || '').slice(0, 200) }));
      if (steps.length) out.typingPlan = { name: String(raw.typingPlan.name || 'Coach plan').slice(0, 60), steps };
      else drop('typing plan', 'no usable steps');
    }
  }
  if (raw?.renames?.length) {
    if (!a.renames) drop(`${raw.renames.length} rename(s)`, 'not part of the requested operations');
    else {
      out.renames = raw.renames.filter((r) => {
        const from = String(r?.from || '').trim(), to = String(r?.to || '').trim();
        if (!a.renames.includes(r?.field)) { drop(`rename ${r?.field}: ${from}`, 'field not allowed by the requested operations'); return false; }
        if (!from || !to || from === to) { drop(`rename ${r.field}: ${from}`, 'empty or unchanged'); return false; }
        if (!Object.values(booksById).some((b) => !b.deleted && String(b[r.field] || '').trim() === from)) { drop(`rename ${r.field}: ${from}`, 'no book uses that value'); return false; }
        return true;
      }).map((r) => ({ field: r.field, from: String(r.from).trim(), to: String(r.to).trim() }));
    }
  }
  if (raw?.goalAdvice) {
    if (!a.goalAdvice) drop('goal advice', 'not part of the requested operations');
    else {
      const g = raw.goalAdvice, o = {};
      if (g.books != null) { if (Number.isInteger(Number(g.books)) && g.books >= 1 && g.books <= 1000) o.books = Number(g.books); else drop(`books goal ${g.books}`, 'implausible'); }
      if (g.words != null) { if (Number.isInteger(Number(g.words)) && g.words >= 10000 && g.words <= 100000000) o.words = Number(g.words); else drop(`words goal ${g.words}`, 'implausible'); }
      if (Object.keys(o).length) out.goalAdvice = { ...o, why: String(g.why || '') };
    }
  }
  if (raw?.answer != null) { if (a.answer && String(raw.answer).trim()) out.answer = String(raw.answer); else drop('answer', 'not part of the requested operations'); }
  if (raw?.queueOrder?.length) {
    if (!a.queueOrder) drop(`${raw.queueOrder.length} queue order(s)`, 'not part of the requested operations');
    else {
      out.queueOrder = raw.queueOrder.filter((qo) => {
        const q = queues.find((x) => x.id === qo?.queueId && !x.deleted);
        if (!q) { drop(`queue order ${qo?.queueId}`, 'no such queue'); return false; }
        const ids = Array.isArray(qo.ids) ? qo.ids : [];
        const same = ids.length === (q.ids || []).length && new Set(ids).size === ids.length && ids.every((id) => q.ids.includes(id));
        if (!same) { drop(`order for “${q.name}”`, 'not exactly the same books (would add, drop or duplicate one)'); return false; }
        if (ids.every((id, i) => id === q.ids[i])) return false; // already in that order
        return true;
      });
    }
  }
  if (raw?.duplicates?.length) {
    if (!a.duplicates) drop(`${raw.duplicates.length} duplicate pair(s)`, 'not part of the requested operations');
    else {
      out.duplicates = raw.duplicates.filter((d) => {
        if (!booksById[d?.keepId] || !booksById[d?.foldId] || d.keepId === d.foldId) { drop(`pair ${d?.keepId} + ${d?.foldId}`, 'unknown or identical books'); return false; }
        if (booksById[d.keepId].locked || booksById[d.foldId].locked) { drop(`pair ${booksById[d.keepId].title} + ${booksById[d.foldId].title}`, 'a locked book 🔒'); return false; }
        return true;
      });
    }
  }
  return { output: out, dropped };
}

// Sanitized output → review rows: [{ key, kind, label, from, to, ...payload }], all ticked by default.
export function planRows(output, { booksById = {}, files = {}, goals = {}, year = new Date().getFullYear() } = {}) {
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
  (output.reports || []).forEach((r, i) => rows.push({ key: `r:${i}`, kind: 'report', label: `Report — ${r.title || r.kind}`, to: short(r.text), value: { kind: r.kind, title: String(r.title || r.kind), text: String(r.text) } }));
  (output.newBooks || []).forEach((nb, i) => rows.push({ key: `nb:${i}`, kind: 'newBook', label: `New to-read book — ${nb.title} — ${nb.author}`, from: '(not in library)', to: short(String(nb.why || '')), value: nb }));
  for (const t of output.addTags || []) rows.push({ key: `t:${t.id}`, kind: 'tags', label: `${title(t.id)} — tags`, from: bookTags(booksById[t.id]).join(', ') || '—', to: `+ ${t.tags.join(', ')}`, bookId: t.id, value: t.tags });
  for (const c of output.vocabCards || []) rows.push({ key: `v:${c.word}`, kind: 'vocab', label: `Vocabulary card — ${c.word}`, from: '(not in deck)', to: short(c.context), value: c });
  if (output.typingPlan) rows.push({ key: 'plan', kind: 'typingPlan', label: `Typing plan — ${output.typingPlan.name}`, from: '(new)', to: output.typingPlan.steps.map((st) => `${st.mode} ${st.runLimit}${st.runMode === 'seconds' ? 's' : 'w'}×${st.sets}`).join(' → '), value: output.typingPlan });
  for (const r of output.renames || []) {
    for (const b of Object.values(booksById)) {
      if (b.deleted || b.locked || String(b[r.field] || '').trim() !== r.from) continue;
      rows.push({ key: `f:${b.id}:${r.field}`, kind: 'field', label: `${b.title} — ${r.field} (rename)`, from: r.from, to: r.to, bookId: b.id, field: r.field, value: r.to });
    }
  }
  if (output.goalAdvice) {
    const why = output.goalAdvice.why ? ` — ${short(output.goalAdvice.why)}` : '';
    if (output.goalAdvice.books != null) rows.push({ key: 'g:books', kind: 'goal', label: `${year} books goal${why}`, from: goals[year] ?? '—', to: output.goalAdvice.books, value: { key: String(year), n: output.goalAdvice.books } });
    if (output.goalAdvice.words != null) rows.push({ key: 'g:words', kind: 'goal', label: `${year} words goal${why}`, from: goals[`${year}-words`] ?? '—', to: output.goalAdvice.words, value: { key: `${year}-words`, n: output.goalAdvice.words } });
  }
  if (output.answer) rows.push({ key: 'answer', kind: 'answer', label: 'Answer to your question', to: short(output.answer), value: output.answer });
  for (const qo of output.queueOrder || []) {
    rows.push({ key: `q:${qo.queueId}`, kind: 'queueOrder', label: `Reorder queue — ${qo.why ? short(String(qo.why)) : ''}`.replace(/ — $/, ''), from: '(current order)', to: qo.ids.slice(0, 6).map(title).join(' → ') + (qo.ids.length > 6 ? ' → …' : ''), value: { queueId: qo.queueId, ids: qo.ids } });
  }
  for (const d of output.duplicates || []) rows.push({ key: `d:${d.keepId}:${d.foldId}`, kind: 'dupe', label: `Duplicate? keep “${title(d.keepId)}”, fold in “${title(d.foldId)}”`, to: short(String(d.why || '')), value: { keepId: d.keepId, foldId: d.foldId, why: String(d.why || '') } });
  return rows;
}

// Ticked rows → what to write, plus the undo snapshot. Pure: the caller does the I/O.
// → { bookUpdates, crossNoteAdds, bindingAdds, aiNext, undo }
export function buildApply(rows, { booksById = {}, ai = {}, now = Date.now(), source = '' } = {}) {
  const working = new Map();
  const book = (id) => { if (!working.has(id)) working.set(id, { ...booksById[id] }); return working.get(id); };
  const aiNext = { ...(ai || {}) };
  const undo = { at: now, books: [], links: [], crossTexts: [], ai: {} };
  const keepAi = (k) => { if (!(k in undo.ai)) undo.ai[k] = ai?.[k] === undefined ? null : ai[k]; };
  const crossNoteAdds = [], bindingAdds = [], queueOrders = [], created = [], vocabAdds = [], planAdds = [], goalSets = [];
  undo.created = [];
  for (const r of rows) {
    if (r.kind === 'field') {
      const b = book(r.bookId);
      b[r.field] = r.value;
      b.aiSet = { ...(b.aiSet || {}), [r.field]: { at: now, by: source || 'cowork' } }; // provenance: which fields AI set, when, from what
    } else if (r.kind === 'tags') {
      const b = book(r.bookId);
      b.tags = [...bookTags(b), ...r.value];
      b.aiSet = { ...(b.aiSet || {}), tags: { at: now, by: source || 'cowork' } };
    }
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
    else if (r.kind === 'answer') { keepAi('answers'); aiNext.answers = [{ at: now, question: ai?.question || '', text: String(r.value) }, ...(aiNext.answers || [])].slice(0, 30); }
    else if (r.kind === 'queueOrder') queueOrders.push(r.value);
    else if (r.kind === 'vocab') vocabAdds.push(r.value);
    else if (r.kind === 'typingPlan') planAdds.push(r.value);
    else if (r.kind === 'goal') goalSets.push(r.value);
    else if (r.kind === 'report') { keepAi('reports'); aiNext.reports = [{ at: now, ...r.value }, ...(aiNext.reports || [])].slice(0, 60); }
    else if (r.kind === 'newBook') {
      const nb = r.value;
      const rec = setReadStatus({ title: String(nb.title).trim(), author: String(nb.author).trim(), ...(nb.genre ? { genre: String(nb.genre) } : {}), ...(Number(nb.pages) > 0 ? { pages: Number(nb.pages) } : {}), recBy: 'Cowork agent', description: String(nb.why || '').trim() || undefined, addedAt: now }, 'toread');
      rec.id = deriveId(rec);
      if (!booksById[rec.id] && !created.some((c) => c.id === rec.id)) { created.push(rec); undo.created.push(rec.id); }
    }
    else if (r.kind === 'dupe') {
      keepAi('dupeSuggestions');
      const list = (aiNext.dupeSuggestions || []).filter((x) => !(x.keepId === r.value.keepId && x.foldId === r.value.foldId));
      aiNext.dupeSuggestions = [...list, { ...r.value, at: now }].slice(-200);
    } else if (r.kind === 'brief') {
      keepAi('briefs');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.value.date || '')) ? r.value.date : new Date(now).toISOString().slice(0, 10);
      const briefs = { ...(aiNext.briefs || {}), [date]: { text: String(r.value.text || ''), at: now } };
      aiNext.briefs = Object.fromEntries(Object.entries(briefs).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 60));
    }
  }
  for (const id of working.keys()) undo.books.push(booksById[id]);
  return { bookUpdates: [...working.values(), ...created], crossNoteAdds, bindingAdds, queueOrders, vocabAdds, planAdds, goalSets, aiNext, undo };
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
    n('queueOrder') && `${n('queueOrder')} queue order${n('queueOrder') === 1 ? '' : 's'}`,
    n('dupe') && `${n('dupe')} duplicate suggestion${n('dupe') === 1 ? '' : 's'}`,
    n('answer') && 'answer',
    n('report') && `${n('report')} report${n('report') === 1 ? '' : 's'}`,
    n('newBook') && `${n('newBook')} new book${n('newBook') === 1 ? '' : 's'}`,
    n('tags') && `tags on ${n('tags')} book${n('tags') === 1 ? '' : 's'}`,
    n('vocab') && `${n('vocab')} vocabulary card${n('vocab') === 1 ? '' : 's'}`,
    n('typingPlan') && 'typing plan',
    n('goal') && `${n('goal')} goal${n('goal') === 1 ? '' : 's'}`,
    n('analysis') && 'analysis', n('recommendations') && 'read-next list', n('treeMeta') && 'tree layout', n('brief') && 'morning brief',
  ].filter(Boolean);
  return parts.join(', ') || 'nothing';
}
