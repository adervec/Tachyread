// Sort the open tabs by one key, either way. Works from a plain per-tab `info` object built from
// the SAVED file record (+ Trackyread lookups), so restored-but-unopened (lazy) tabs sort the same
// as loaded ones. Missing values always sink to the end; ties fall back to name.

const STATUS_ORDER = ['reading', 'queue', 'toread', 'finished', 'abandoned', 'untracked'];
const TYPE_ORDER = ['long', 'short', 'article', 'ai-gen', 'poetry', 'reference', 'other', 'untracked'];
const rank = (order, v) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };

// key → [label, value(info), first-direction label, second-direction label]
export const TAB_SORT_KEYS = {
  name: ['Name', (x) => (x.name || '').toLowerCase(), 'A → Z', 'Z → A'],
  length: ['Length', (x) => x.words, 'shortest', 'longest'],
  completion: ['Completion', (x) => x.readPct, 'least read', 'most read'],
  position: ['Position', (x) => x.posPct, 'least far', 'furthest'],
  timeLeft: ['Time left', (x) => x.minsLeft, 'least', 'most'],
  lastRead: ['Last read', (x) => (x.lastRead ? -x.lastRead : null), 'newest', 'oldest'],
  opened: ['Opened', (x) => x.opened, 'oldest', 'newest'],
  status: ['Trackyread status', (x) => rank(STATUS_ORDER, x.status || 'untracked'), 'reading first', 'untracked first'],
  type: ['Content type', (x) => rank(TYPE_ORDER, x.type || 'untracked'), 'long-form first', 'untracked first'],
  fileType: ['File type', (x) => (x.fileType || '').toLowerCase() || null, 'A → Z', 'Z → A'],
};

// entries: [{ id, info }] in current order. Returns the ids in the new order.
export function sortTabIds(entries, key, dir = 'asc') {
  const val = TAB_SORT_KEYS[key]?.[1];
  if (!val) return entries.map((e) => e.id);
  const sign = dir === 'desc' ? -1 : 1;
  const missing = (v) => v == null || v === '' || (typeof v === 'number' && !isFinite(v));
  return entries
    .map((e, i) => ({ e, i, v: val(e.info) }))
    .sort((a, b) => {
      const ma = missing(a.v), mb = missing(b.v);
      if (ma || mb) return ma === mb ? a.i - b.i : ma ? 1 : -1;
      const c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
      if (c) return c * sign;
      return (a.e.info.name || '').localeCompare(b.e.info.name || '') || a.i - b.i;
    })
    .map((x) => x.e.id);
}

// Per-tab info from its saved record. `rec` = loadFile(checksum) merged with the live settings.
export function tabInfo({ fileName, rec = {}, book = null, status = null, type = null, opened = null }) {
  const words = rec.totalWords || 0;
  const wi = rec.wordIndex || 0;
  const wpm = rec.wpm || 250;
  const ext = /\.([a-z0-9]+)$/i.exec(fileName || '')?.[1];
  return {
    name: (fileName || '').replace(/\.[a-z0-9]+$/i, ''),
    words: words || null,
    readPct: words ? Math.min(1, (rec.persistentWordsRead || 0) / words) : null,
    posPct: words ? Math.min(1, wi / words) : null,
    minsLeft: words ? Math.max(0, words - wi) / wpm : null,
    lastRead: rec.posUpdatedAt || null,
    opened,
    status: book ? status : 'untracked',
    type: book ? type : 'untracked',
    fileType: rec.sourceKind || ext || null,
  };
}
