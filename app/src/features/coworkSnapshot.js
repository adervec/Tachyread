// The read-only activity SNAPSHOT written into the cowork folder (snapshot/…), so an AI agent that
// only READS can observe and judge reading, typing, speaking, narration and focus well enough for a
// morning brief or progress review — without any request/response round trip and without being
// able to change anything. No document text, no audio, no API keys. Pure: data in, files out (name
// → string); see coworkSnapshot.test.mjs. README.md documents every file and field.
import { readStatus, finishMs, contentType } from './journeyLibrary.js';
import { yearGoal, yearWordsGoal } from './journeyAnalytics.js';
import { queueBooks, queueStats, liveQueues, recentPace } from './readingQueues.js';
import { readingStreak, todaySummary, localDate } from './todaySummary.js';
import { typingWeekly } from './typingStats.js';

export const SNAPSHOT_VERSION = 1;
const words = (b) => Number(b?.words) || (Number(b?.pages) ? Number(b.pages) * 275 : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const wpmOf = (w, s) => (s > 30 ? Math.round(w / (s / 60)) : null);

export function buildSnapshot({ files = [], books = [], bindMap = {}, queues = [], goals = {}, typingRuns = [], speechLog = [], focusSessions = [], manifests = [], now = Date.now() } = {}) {
  const live = books.filter((b) => b && !b.deleted);
  const csOf = {};
  for (const [cs, id] of Object.entries(bindMap)) if (!csOf[id]) csOf[id] = cs;
  const fileByCs = Object.fromEntries(files.map((f) => [f.checksum || f.contentChecksum, f]));
  const fileStats = {};
  for (const [cs, f] of Object.entries(fileByCs)) {
    const today = (f.dailyHistory || []).find((d) => d.date === localDate(now));
    fileStats[cs] = { fileName: f.fileName, coverage: f.totalWords ? Math.min(1, (f.persistentWordsRead || 0) / f.totalWords) : 0, words: f.totalWords || 0, activeSecs: f.persistentActiveTimeSecs || 0, today: today ? { words: today.wordsRead || 0, secs: today.activeTimeSecs || 0 } : undefined };
  }

  // ── reading-days: per local day, across every file ──
  const byDay = new Map();
  for (const [cs, f] of Object.entries(fileByCs)) {
    for (const d of f.dailyHistory || []) {
      if (!(d.wordsRead > 0 || d.activeTimeSecs > 0)) continue;
      const cur = byDay.get(d.date) || { date: d.date, wordsRead: 0, activeSecs: 0, aloudWords: 0, aloudSecs: 0, regressions: 0, hours: {}, methods: {}, files: [] };
      cur.regressions += d.regressions || 0;
      cur.wordsRead += d.wordsRead || 0; cur.activeSecs += d.activeTimeSecs || 0;
      cur.aloudWords += d.aloudWords || 0; cur.aloudSecs += d.aloudSecs || 0;
      for (const [h, w] of Object.entries(d.hours || {})) cur.hours[h] = (cur.hours[h] || 0) + w;
      for (const [m, w] of Object.entries(d.methods || {})) cur.methods[m] = (cur.methods[m] || 0) + w;
      cur.files.push({ file: f.fileName || cs.slice(0, 8), bookId: bindMap[cs] || null, words: d.wordsRead || 0, secs: d.activeTimeSecs || 0 });
      byDay.set(d.date, cur);
    }
  }
  const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-400)
    .map((d) => ({ ...d, wpm: wpmOf(d.wordsRead - d.aloudWords, d.activeSecs - d.aloudSecs) }));
  const dayAgg = days.map((d) => ({ date: d.date, wordsRead: d.wordsRead, activeSecs: d.activeSecs, aloudWords: d.aloudWords, aloudSecs: d.aloudSecs }));
  const pace = recentPace(dayAgg, { now });

  // ── books ──
  const qOf = {};
  for (const q of liveQueues(queues)) (q.ids || []).forEach((id, i) => { qOf[id] = { queue: q.name, position: i + 1 }; });
  const bookRows = live.map((b) => {
    const cs = csOf[b.id], f = cs && fileByCs[cs];
    return {
      id: b.id, title: b.title, author: b.author || null, genre: b.genre || null, subgenre: b.subgenre || null,
      type: contentType(b), status: readStatus(b), started: b.startTime || null,
      finished: finishMs(b) != null ? new Date(finishMs(b)).toISOString().slice(0, 10) : null,
      rating: Number(b.rating) || null, recScore: b.recScore ?? null, words: words(b) || null, queue: qOf[b.id] || null,
      file: f ? {
        name: f.fileName, totalWords: f.totalWords || 0, percentRead: Math.round(fileStats[cs].coverage * 1000) / 10,
        wordsRead: f.persistentWordsRead || 0, pacedWords: f.persistentPacedWords ?? f.persistentWordsRead ?? 0,
        activeHours: r1((f.persistentActiveTimeSecs || 0) / 3600),
        lastRead: (f.dailyHistory || []).map((d) => d.date).sort().pop() || null, completions: (f.completions || []).length,
      } : null,
    };
  });

  // ── queues ──
  const fileOf = (b) => { const cs = csOf[b.id]; return cs ? fileStats[cs] : null; };
  const queueRows = liveQueues(queues).map((q) => {
    const qb = queueBooks(q, live);
    const st = queueStats(qb, { wpm: pace.wpm || 250, fileOf, wordsPerDay: pace.wordsPerDay, now });
    return {
      name: q.name, books: qb.length, finished: st.done, percentWordsRead: st.pctWords, wordsLeft: st.wordsLeft, hoursLeft: st.hoursLeft,
      etaAllDone: st.eta, next: st.next?.title || null,
      order: qb.map((b) => ({ id: b.id, title: b.title, status: readStatus(b), percentRead: Math.round((st.pctById[b.id] || 0) * 100), eta: st.etaById[b.id] || null })),
    };
  });

  // ── goals + today ──
  const linkedIds = new Set(Object.values(bindMap));
  const year = new Date(now).getFullYear();
  const bg = Number(goals?.[year]) || 0, wg = Number(goals?.[`${year}-words`]) || 0;
  const today = todaySummary({ dayAgg, fileStats, bookOf: (cs) => live.find((b) => b.id === bindMap[cs]) || null, books: live, now });
  // When and how you read, over the last 30 days (only days recorded since hour/method tracking began).
  const since = localDate(now - 30 * 86400000);
  const byHour = {}, byMethod = {};
  for (const d of days) {
    if (d.date < since) continue;
    for (const [h, w] of Object.entries(d.hours)) byHour[h] = (byHour[h] || 0) + w;
    for (const [m, w] of Object.entries(d.methods)) byMethod[m] = (byMethod[m] || 0) + w;
  }
  const goalsOut = {
    last30Days: { wordsByLocalHour: byHour, wordsByMethod: byMethod },
    year, booksGoal: bg ? yearGoal(live, bg, now) : null, wordsGoal: wg ? yearWordsGoal(dayAgg, live, linkedIds, wg, now) : null,
    streak: readingStreak(dayAgg, now), recentPace: pace,
    today: { date: today.today, words: today.words, activeSecs: today.secs, wpm: today.wpm, aloudWords: today.aloudWords, books: today.files.map((x) => ({ title: x.book?.title || x.name, words: x.words, secs: x.secs, percentRead: Math.round(x.coverage * 100) })), finished: today.finished.map((b) => b.title) },
  };

  // ── typing ──
  const runs = [...typingRuns].filter((r) => r?.ts).sort((a, b) => a.ts - b.ts).slice(-2000).map((r) => ({
    at: new Date(r.ts).toISOString(), mode: r.mode || null, device: r.device || null, text: r.docName || null,
    netWpm: r.netWpm, grossWpm: r.grossWpm, accuracy: r.accuracy, consistency: r.consistency ?? null,
    words: r.words, perfect: r.perfect ?? null, corrected: r.corrected ?? null, seconds: Math.round((r.durationMs || 0) / 1000), tier: r.tier || null,
  }));
  const errAgg = {};
  for (const r of typingRuns) for (const [k, n] of Object.entries(r.errorKeys || {})) errAgg[k] = (errAgg[k] || 0) + n;
  const typing = { runs, weekly: typingWeekly(typingRuns, { weeks: 26 }), topErrorKeys: Object.entries(errAgg).sort((a, b) => b[1] - a[1]).slice(0, 20) };

  // ── narration (recorded takes and their quality; no audio) ──
  const narration = manifests.map((m) => {
    const recorded = [];
    let clips = 0;
    for (const [line, e] of Object.entries(m.lines || {})) {
      for (const c of e.clips || []) {
        clips++;
        if (c.source !== 'mic') continue;
        const q = c.quality || {};
        recorded.push({ line: Number(line), at: c.createdAt ? new Date(c.createdAt).toISOString() : null, seconds: Math.round((c.durationMs || 0) / 1000), score: q.score ?? null, accuracy: q.accuracy ?? null, completeness: q.completeness ?? null, wpm: q.wpm ?? null, voiceOverall: q.voice?.overall ?? null });
      }
    }
    return { file: fileByCs[m.checksum]?.fileName || m.fileName || m.checksum.slice(0, 8), bookId: bindMap[m.checksum] || null, chunks: m.chunks ?? null, clips, recorded };
  }).filter((n) => n.clips > 0);

  // ── reading sessions (every file's session log, newest last) ──
  const sessions = [];
  for (const [cs, f] of Object.entries(fileByCs)) {
    for (const x of f.sessionLog || []) {
      sessions.push({ start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString(), file: f.fileName || cs.slice(0, 8), bookId: bindMap[cs] || null, words: x.words, minutes: r1((x.ms || 0) / 60000), wpm: wpmOf(x.words, (x.ms || 0) / 1000), methods: x.by || {} });
    }
  }
  sessions.sort((a, b) => (a.start < b.start ? -1 : 1));

  // ── activity log (one line per day, last 60 days with anything) ──
  const typingByDay = {}, aloudByDay = {};
  for (const r of typingRuns) { const d = localDate(r.ts); (typingByDay[d] ||= []).push(r.netWpm); }
  for (const s of speechLog) { const d = localDate(s.at); aloudByDay[d] = (aloudByDay[d] || 0) + (s.words || 0); }
  const allDates = [...new Set([...days.map((d) => d.date), ...Object.keys(typingByDay), ...Object.keys(aloudByDay)])].sort().slice(-60).reverse();
  const dayMap = Object.fromEntries(days.map((d) => [d.date, d]));
  const log = allDates.map((date) => {
    const d = dayMap[date];
    const bits = [];
    if (d) bits.push(`${d.wordsRead.toLocaleString('en-US')} words in ${Math.round(d.activeSecs / 60)} min${d.wpm ? ` (${d.wpm} wpm)` : ''} across ${d.files.length} file${d.files.length === 1 ? '' : 's'}`);
    if (typingByDay[date]) bits.push(`typing ${typingByDay[date].length} run${typingByDay[date].length === 1 ? '' : 's'}, avg ${Math.round(typingByDay[date].reduce((a, x) => a + (x || 0), 0) / typingByDay[date].length)} wpm`);
    if (aloudByDay[date]) bits.push(`read aloud ${aloudByDay[date]} words`);
    return `- ${date} — ${bits.join(' · ')}`;
  });

  const meta = { app: 'tachyread', kind: 'activity-snapshot', version: SNAPSHOT_VERSION, generatedAt: new Date(now).toISOString(), counts: { books: live.length, files: files.length, readingDays: days.length, sessions: sessions.length, typingRuns: runs.length, speechSessions: speechLog.length, focusSessions: focusSessions.length, narratedBooks: narration.length } };
  const json = (x) => JSON.stringify(x, null, 1);
  return {
    'README.md': README(meta),
    'meta.json': json(meta),
    'reading-days.json': json(days),
    'books.json': json(bookRows),
    'queues.json': json(queueRows),
    'goals.json': json(goalsOut),
    'typing.json': json(typing),
    'speaking.json': json(speechLog),
    'narration.json': json(narration),
    'sessions.json': json(sessions.slice(-1000)),
    'focus.json': json(focusSessions.map((f) => ({ at: f.ts ? new Date(f.ts).toISOString() : null, watchedSecs: Math.round((f.watchedMs || 0) / 1000), awaySecs: Math.round((f.awayMs || 0) / 1000), distractions: f.distractions ?? null, text: f.docName || null }))),
    'activity-log.md': `# Activity log (last 60 active days, newest first)\n\n${log.join('\n') || '_Nothing yet._'}\n`,
  };
}

function README(meta) {
  return `# Tachyread activity snapshot (read-only)

Written by Tachyread for AI agents that observe and analyse — e.g. a morning brief. Nothing in this
folder is read back by the app: changing these files changes nothing. Generated ${meta.generatedAt}
(snapshot v${meta.version}). Dates are the reader's LOCAL calendar dates. No document text, audio
or keys are included.

| File | What it holds |
|---|---|
| \`activity-log.md\` | One line per active day (newest first): reading, typing, reading aloud. Start here. |
| \`reading-days.json\` | Per day: \`wordsRead\`, \`activeSecs\`, \`aloudWords\`/\`aloudSecs\` (part read aloud), \`wpm\` (silent reading speed; aloud excluded), \`hours\` {localHour 0–23: words} (when), \`methods\` {method: words} (how: auto = auto-play, word / line / para / page = stepping, scroll, listen = TTS, speak = aloud, other), \`regressions\` (backtracks over just-read text — a rough difficulty signal), \`files\` [{file, bookId, words, secs}]. Up to 400 days; hours/methods only on days recorded since that tracking began. |
| \`sessions.json\` | Individual reading sessions (a pause over 5 min starts a new one): \`start\`/\`end\` (ISO), \`file\`, \`bookId\`, \`words\`, \`minutes\`, \`wpm\`, \`methods\` {method: words}. Up to 1,000, oldest first. |
| \`books.json\` | Every tracker book: \`status\` (reading / queue / toread / finished / abandoned), \`started\`, \`finished\`, \`rating\`, \`recScore\` (0–10), \`words\`, \`queue\` {queue, position}, \`file\` {percentRead, wordsRead, pacedWords (words actually read in-app — excludes sections ticked as read elsewhere), activeHours, lastRead, completions}. |
| \`queues.json\` | Reading queues in order: books, finished, % of words read, words/hours left, \`etaAllDone\` and per-book \`eta\` at the recent pace, \`next\`. |
| \`goals.json\` | \`last30Days\` (words by local hour and by method), yearly books/words goals (on-track flag, projection, need per day/month), reading \`streak\`, \`recentPace\` (words/day and wpm over ~6 weeks, recent days weighted), and \`today\`. |
| \`typing.json\` | Typing-practice \`runs\` (net/gross wpm, accuracy %, consistency %, words, seconds, mode, device), \`weekly\` aggregates, \`topErrorKeys\` [[key, count]]. |
| \`speaking.json\` | Reading-aloud sessions — field meanings in its \`fields\` description below. |
| \`narration.json\` | Audiobook narration per book: clip counts and each self-recorded take's quality \`score\`, \`accuracy\` (said words that were the text), \`completeness\` (text words said), \`wpm\`, \`voiceOverall\` (0–100). |
| \`focus.json\` | Focus sessions: watched vs away seconds and distractions. |
| \`meta.json\` | Generation time and record counts. |
| \`changes.md\` / \`changes.json\` | What changed since the PREVIOUS snapshot: books finished / started / progressed / rated / added / linked / removed, queue moves. Good for "since yesterday…". |

## speaking.json fields
Each session: \`at\`/\`end\` (epoch ms), \`name\` (document), \`words\` advanced by reading aloud, \`exact\`/\`near\`/\`skip\`
(words read exactly / approximately / skipped), \`q\` (mean match quality 0–100), \`misses\` (heard phrases
matching nothing), \`strict\` (1 forgiving – 5 strict), \`voice\` {overall, scores: pace, clarity, resonantDepth,
expressiveness, nonNasal, noUptalk, projection, breath — 0–100}, \`m\` per-minute [minute, words, quality, voice].

## Reading the numbers
- Speeds: silent reading wpm excludes read-aloud time; typing wpm is net (errors cost) unless marked gross.
- "percentRead" is coverage (words actually covered), not the cursor position.
- A streak counts consecutive local days with any reading; if today has none yet, it ends yesterday.
`;
}

// ── changes since the previous snapshot ──────────────────────────────────────────────────────────
// prev/next: the parsed books.json and queues.json of two snapshots. → [{ kind, title, detail }]
export function diffSnapshots(prev, next) {
  const out = [];
  const pb = new Map((prev?.books || []).map((b) => [b.id, b]));
  const nb = new Map((next?.books || []).map((b) => [b.id, b]));
  for (const [id, b] of nb) {
    const o = pb.get(id);
    if (!o) { out.push({ kind: 'added', title: b.title, detail: `added to the library (${b.status})` }); continue; }
    if (o.status !== b.status) out.push({ kind: b.status === 'finished' ? 'finished' : b.status === 'reading' ? 'started' : 'status', title: b.title, detail: `${o.status} → ${b.status}` });
    const op = o.file?.percentRead ?? 0, np = b.file?.percentRead ?? 0;
    if (np - op >= 1) out.push({ kind: 'progress', title: b.title, detail: `${op}% → ${np}% read` });
    if (!o.file && b.file) out.push({ kind: 'linked', title: b.title, detail: `linked to ${b.file.name}` });
    if (o.rating !== b.rating && b.rating) out.push({ kind: 'rated', title: b.title, detail: `rated ${b.rating}` });
    const oq = o.queue ? `${o.queue.queue} #${o.queue.position}` : null, nq = b.queue ? `${b.queue.queue} #${b.queue.position}` : null;
    if (oq !== nq && (oq?.split(' #')[0] !== nq?.split(' #')[0])) out.push({ kind: 'queue', title: b.title, detail: `${oq || 'no queue'} → ${nq || 'no queue'}` });
  }
  for (const [id, b] of pb) if (!nb.has(id)) out.push({ kind: 'removed', title: b.title, detail: 'removed from the library' });
  const pq = new Set((prev?.queues || []).map((q) => q.name)), nq = new Set((next?.queues || []).map((q) => q.name));
  for (const n of nq) if (!pq.has(n)) out.push({ kind: 'queue', title: n, detail: 'new queue' });
  for (const n of pq) if (!nq.has(n)) out.push({ kind: 'queue', title: n, detail: 'queue removed' });
  return out;
}
export function changesMarkdown(changes, sinceIso, nowIso) {
  if (!sinceIso) return `# Changes\n\nFirst snapshot (${nowIso}) — nothing to compare with yet.\n`;
  const groups = {};
  for (const c of changes) (groups[c.kind] ||= []).push(c);
  const order = ['finished', 'started', 'progress', 'rated', 'added', 'linked', 'queue', 'status', 'removed'];
  const body = order.filter((k) => groups[k]).map((k) => `## ${k}\n${groups[k].map((c) => `- ${c.title} — ${c.detail}`).join('\n')}`).join('\n\n');
  return `# Changes since the previous snapshot\n\nFrom ${sinceIso} to ${nowIso}.\n\n${body || '_No changes._'}\n`;
}
