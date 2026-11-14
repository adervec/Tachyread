// AI review of graded sessions (house standard 18, GymTracker's `workout-review` pattern). Tachyread
// grades two kinds of session by algorithm: typing runs (net WPM → letter grade + tier) and
// reading-aloud sittings (match quality, voice and presenting scores). The `cw-session-review`
// cowork operation sends the sessions not yet reviewed, each with its raw detail and the app's own
// score, plus recent history for trend; the reply's reviews are stored BESIDE the app's score
// (ai.sessionReviews), never replacing it. Pure; see sessionReview.test.mjs.

export const sessionIdOf = (kind, t) => `${kind === 'typing' ? 'typing' : 'speech'}:${t}`;
export const SESSION_ID = /^(typing|speech):\d+$/;

// "Typing run 13 Nov, 14:05" from an id, for review rows and lists.
export function sessionLabel(id) {
  const [kind, t] = String(id).split(':');
  const when = new Date(Number(t)).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${kind === 'typing' ? 'Typing run' : 'Reading aloud'} ${when}`;
}

const topKeys = (m, n = 8) => Object.entries(m || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

function typingDetail(r) {
  return {
    id: sessionIdOf('typing', r.ts), kind: 'typing', at: new Date(r.ts).toISOString(),
    mode: r.mode || null, text: r.docName || null, device: r.device || null, seconds: Math.round((r.durationMs || 0) / 1000),
    netWpm: r.netWpm, grossWpm: r.grossWpm ?? null, accuracy: r.accuracy, consistency: r.consistency ?? null,
    words: r.words ?? null, perfectWords: r.perfect ?? null, correctedWords: r.corrected ?? null, errors: r.errors ?? null,
    mostMissedKeys: topKeys(r.errorKeys), problemWords: (r.problemWords || []).slice(0, 10), personalBests: r.pb || null,
    appScore: { grade: r.grade || null, tier: r.tier || null, basis: 'letter grade from net WPM' },
  };
}
function speechDetail(s) {
  return {
    id: sessionIdOf('speech', s.at), kind: 'reading-aloud', at: new Date(s.at).toISOString(), text: s.name || null,
    minutes: Math.round(((s.end || s.at) - s.at) / 6000) / 10, wordsAdvanced: s.words, advances: s.moves, misses: s.misses,
    exactWords: s.exact, nearWords: s.near, skippedWords: s.skip, fillerWords: s.f ?? null, strictness: s.strict ?? null,
    voice: s.voice || null, presenting: s.face || null, perMinute: (s.m || []).slice(0, 60),
    appScore: { matchQuality: s.q, voiceOverall: s.voice?.overall ?? null, presentingOverall: s.face?.overall ?? null, basis: '0–100 scores' },
  };
}

// → { due: [newest first, at most `max`], recent: { typing, speaking } } for the request dataset.
export function sessionsForReview(typingRuns = [], speechLog = [], reviews = {}, { max = 20, history = 30 } = {}) {
  const typing = (typingRuns || []).filter((r) => r?.ts).sort((a, b) => b.ts - a.ts);
  const speaking = (speechLog || []).filter((s) => s?.at).sort((a, b) => b.at - a.at);
  const due = [
    ...typing.filter((r) => !reviews?.[sessionIdOf('typing', r.ts)]).map(typingDetail),
    ...speaking.filter((s) => !reviews?.[sessionIdOf('speech', s.at)]).map(speechDetail),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, max);
  return {
    due,
    recent: {
      typing: typing.slice(0, history).map((r) => ({ at: new Date(r.ts).toISOString(), mode: r.mode || null, netWpm: r.netWpm, accuracy: r.accuracy, consistency: r.consistency ?? null, grade: r.grade || null })),
      speaking: speaking.slice(0, history).map((s) => ({ at: new Date(s.at).toISOString(), words: s.words, matchQuality: s.q, voiceOverall: s.voice?.overall ?? null, presentingOverall: s.face?.overall ?? null })),
    },
  };
}

// The app's own score per session, for the review table's "Now" column (beside the AI grade).
export function appScores(typingRuns = [], speechLog = []) {
  const out = {};
  for (const r of typingRuns || []) if (r?.ts) out[sessionIdOf('typing', r.ts)] = `${r.grade || '?'} · ${r.netWpm} WPM · ${r.accuracy}%`;
  for (const s of speechLog || []) if (s?.at) out[sessionIdOf('speech', s.at)] = `match ${s.q ?? '?'}${s.voice?.overall != null ? ` · voice ${s.voice.overall}` : ''}${s.face?.overall != null ? ` · presenting ${s.face.overall}` : ''}`;
  return out;
}

// Every session id that exists (a reply may only review those).
export const allSessionIds = (typingRuns = [], speechLog = []) => new Set([
  ...(typingRuns || []).filter((r) => r?.ts).map((r) => sessionIdOf('typing', r.ts)),
  ...(speechLog || []).filter((s) => s?.at).map((s) => sessionIdOf('speech', s.at)),
]);

// One review as plain text (tooltips, the Cowork outputs table).
export function reviewText(r) {
  const list = (h, xs) => (xs?.length ? `\n${h}:\n${xs.map((x) => `- ${x}`).join('\n')}` : '');
  return `${r.summary || ''}${list('Strengths', r.strengths)}${list('Fix', r.fixes)}${r.next ? `\nNext: ${r.next}` : ''}`;
}
