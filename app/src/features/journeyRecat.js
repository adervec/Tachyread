// "Fix miscategorised content" for the Trackyread library.
//
// Content types are set when a book is imported or added, and imports are guesses: everything from
// a library.json longForm block lands as 'long' whether it's a novel, a saved web article or a
// prompt transcript. Once a few hundred records are in, the Dashboard's long/short/AI splits are
// only as honest as those guesses.
//
// This scans the library for records whose evidence disagrees with their label and proposes a fix.
// It NEVER edits anything by itself: every suggestion carries the reason it fired so you can judge
// it, and the caller applies only what you tick. Rules are deliberately conservative — a wrong
// suggestion the user accepts is worse than a miss.
//
// Pure; see journeyRecat.test.mjs.

import { CONTENT_TYPES, contentType } from './journeyLibrary.js';

// Roughly where short-form ends and a book begins. A "short story" of 90k words is a novel; a
// "novel" of 900 words is an article or a poem.
export const LONG_MIN_WORDS = 17500;   // ~novella and up
export const SHORT_MAX_WORDS = 15000;  // comfortably short-form
export const TINY_WORDS = 2500;        // article / poem territory

const AI_AUTHOR = /\b(chat ?gpt|gpt-?[0-9]|claude|gemini|llama|mistral|copilot|midjourney|openai|anthropic|deepseek|grok|ai(?:-| )?(?:generated|written|assistant))\b/i;
const AI_TITLE = /\b(prompt|transcript|chat log|conversation with|ai(?:-| )?(?:generated|written)|synthetic)\b/i;
const URLISH = /(https?:\/\/|www\.|\.(?:com|org|net|io|dev|co\.uk|substack\.com|medium\.com)\b|\bsubstack\b|\bmedium\b)/i;
const ARTICLE_TITLE = /\b(blog|newsletter|op-?ed|essay|column|interview|press release|announcement|part \d+ of)\b/i;
const REFERENCE_TITLE = /\b(manual|handbook|reference|documentation|docs|dictionary|encyclopa?edia|glossary|specification|spec sheet|cheat ?sheet|api|guide to the|user guide|textbook)\b/i;
const POETRY_TITLE = /\b(poems?|poetry|sonnets?|verse|haiku|elegy|odes?|anthology of verse)\b/i;
const POETRY_GENRE = /\bpoetry|verse\b/i;

const words = (b) => Number(b?.words) || 0;
const text = (b) => `${b?.title || ''} ${b?.subtitle || ''}`;

// One rule = one reason a record looks mislabelled. Order matters: the first match wins, so the
// strongest evidence (an explicit AI author, a URL in the title) is checked before the fuzzier
// length heuristics.
const RULES = [
  {
    id: 'ai-author',
    to: 'ai-gen',
    test: (b) => AI_AUTHOR.test(String(b.author || '')),
    why: (b) => `author is “${b.author}”`,
  },
  {
    id: 'ai-title',
    to: 'ai-gen',
    test: (b) => AI_TITLE.test(text(b)),
    why: () => 'the title reads like generated or prompt material',
  },
  {
    id: 'url-title',
    to: 'article',
    test: (b) => URLISH.test(text(b)) || URLISH.test(String(b.source || '')),
    why: () => 'the title or source looks like a web address',
  },
  {
    id: 'article-title',
    to: 'article',
    test: (b) => ARTICLE_TITLE.test(text(b)) && words(b) <= SHORT_MAX_WORDS,
    why: () => 'the title names an article format and it is short',
  },
  {
    id: 'reference-title',
    to: 'reference',
    test: (b) => REFERENCE_TITLE.test(text(b)),
    why: () => 'the title names a reference work',
  },
  {
    id: 'poetry-genre',
    to: 'poetry',
    test: (b) => POETRY_GENRE.test(String(b.genre || '')) || POETRY_TITLE.test(text(b)),
    why: (b) => (POETRY_GENRE.test(String(b.genre || '')) ? `genre is “${b.genre}”` : 'the title names a poetry collection'),
  },
  {
    id: 'too-short-for-long',
    to: 'short',
    test: (b) => contentType(b) === 'long' && words(b) > 0 && words(b) < SHORT_MAX_WORDS && words(b) >= TINY_WORDS,
    why: (b) => `${words(b).toLocaleString()} words is short-form length`,
  },
  {
    id: 'tiny-for-long',
    to: 'article',
    test: (b) => contentType(b) === 'long' && words(b) > 0 && words(b) < TINY_WORDS,
    why: (b) => `only ${words(b).toLocaleString()} words`,
  },
  {
    id: 'too-long-for-short',
    to: 'long',
    test: (b) => (contentType(b) === 'short' || contentType(b) === 'article') && words(b) >= LONG_MIN_WORDS,
    why: (b) => `${words(b).toLocaleString()} words is book length`,
  },
];

// One suggestion for a book, or null when nothing disagrees with its current label.
// { id, title, author, from, to, ruleId, why }
export function suggestType(b) {
  if (!b || b.deleted) return null;
  const from = contentType(b);
  for (const r of RULES) {
    if (r.to === from) continue;          // already right by this rule's lights
    if (!r.test(b)) continue;
    // A record the user has explicitly typed themselves is left alone — `typeLocked` is set when
    // they change the type by hand, which is exactly the signal "stop guessing at this one".
    if (b.typeLocked) return null;
    return { id: b.id, title: b.title || 'Untitled', author: b.author || '', from, to: r.to, ruleId: r.id, why: r.why(b) };
  }
  return null;
}

// Every suggestion in the library, strongest evidence first (rule order), then alphabetical so the
// list is stable between runs.
export function scanMiscategorized(books) {
  const order = Object.fromEntries(RULES.map((r, i) => [r.id, i]));
  return (books || [])
    .map(suggestType)
    .filter(Boolean)
    .sort((a, b) => (order[a.ruleId] - order[b.ruleId]) || String(a.title).localeCompare(String(b.title)));
}

// Books with the accepted suggestions applied, ready to save. Accepting a suggestion also LOCKS the
// type: you've now made a call on this record, and the scan shouldn't second-guess it next time.
export function applyRecat(books, accepted) {
  const byId = new Map((accepted || []).map((s) => [s.id, s]));
  return (books || [])
    .filter((b) => byId.has(b.id))
    .map((b) => ({ ...b, type: byId.get(b.id).to, typeLocked: true }));
}

// Same lock for a manual bulk retype from the table.
export function retypeBooks(books, ids, type) {
  if (!CONTENT_TYPES[type]) return [];
  const want = new Set(ids || []);
  return (books || []).filter((b) => want.has(b.id)).map((b) => ({ ...b, type, typeLocked: true }));
}

// Count by proposed target, for the summary line.
export function recatSummary(suggestions) {
  const out = {};
  for (const s of suggestions || []) out[s.to] = (out[s.to] || 0) + 1;
  return out;
}
