// Reading-aloud session log: one compact record per session (turning reading aloud on → off, or
// switching tab), kept on the device for later analysis (export from Data → Speech log). No audio and
// no transcripts — just counts, match quality and the voice scores, with a per-minute trend.
//
// Record (v1) uses short keys to stay small; SPEECH_LOG_FIELDS says what each means (it's written
// into the exported file too, so whoever analyses it doesn't need this source).
export const SPEECH_LOG_FIELDS = {
  v: 'format version (1)',
  at: 'session start, epoch ms', end: 'session end, epoch ms',
  cs: 'document content checksum', name: 'document file name', lang: 'speech recogniser language',
  strict: 'strictness preset 1 (forgiving) – 5 (strict); null = custom settings',
  from: 'word index where the session started', to: 'word index where it ended',
  words: 'words advanced by reading aloud', moves: 'number of advances',
  misses: 'final heard phrases that matched nothing near the reading position',
  exact: 'words read exactly', near: 'words read approximately (misheard / mispronounced)', skip: 'words skipped over',
  q: 'mean match quality of advanced words, 0–100',
  voice: 'session-average voice scores 0–100 {overall, scores:{pace, clarity, resonantDepth, expressiveness, nonNasal, noUptalk, projection, breath}}; null when live voice feedback was off',
  m: 'per-minute trend: [minute since start, words advanced, mean quality 0–100, voice overall or null]',
};

export const SPEECH_LOG_CAP = 2000; // ~1–2 KB each → a few MB at most

export function speechSession({ at = Date.now(), cs = null, name = '', lang = '', strict = null, from = 0 } = {}) {
  const rec = { v: 1, at, end: at, cs, name, lang, strict, from, to: from, words: 0, moves: 0, misses: 0, exact: 0, near: 0, skip: 0, q: 0, voice: null, m: [] };
  let qSum = 0, qN = 0;
  const vSum = {}, vN = {};
  let overallSum = 0, overallN = 0;
  const minutes = new Map(); // minute → { words, qSum, qN, oSum, oN }
  const bucket = (t) => {
    const k = Math.max(0, Math.floor((t - at) / 60000));
    if (!minutes.has(k)) minutes.set(k, { words: 0, qSum: 0, qN: 0, oSum: 0, oN: 0 });
    return minutes.get(k);
  };
  return {
    // One advance: qs = [[wordIndex, quality 0–1]] (0 = skipped), to = new position.
    move(qs, to, t = Date.now()) {
      const b = bucket(t);
      rec.moves++;
      rec.to = to;
      for (const [, q] of qs) {
        rec.words++; b.words++;
        if (q >= 1) rec.exact++; else if (q > 0) rec.near++; else rec.skip++;
        qSum += q; qN++; b.qSum += q; b.qN++;
      }
    },
    miss() { rec.misses++; },
    // A live voice-score snapshot ({ scores, overall }) — averaged over the session.
    voice(v, t = Date.now()) {
      if (!v?.scores) return;
      for (const [k, s] of Object.entries(v.scores)) { vSum[k] = (vSum[k] || 0) + s; vN[k] = (vN[k] || 0) + 1; }
      overallSum += v.overall; overallN++;
      const b = bucket(t); b.oSum += v.overall; b.oN++;
    },
    finish(t = Date.now()) {
      rec.end = t;
      rec.q = qN ? Math.round((qSum / qN) * 100) : 0;
      if (overallN) {
        const scores = {};
        for (const k of Object.keys(vSum)) scores[k] = Math.round(vSum[k] / vN[k]);
        rec.voice = { overall: Math.round(overallSum / overallN), scores };
      }
      rec.m = [...minutes.entries()].sort((a, b) => a[0] - b[0])
        .map(([k, b]) => [k, b.words, b.qN ? Math.round((b.qSum / b.qN) * 100) : 0, b.oN ? Math.round(b.oSum / b.oN) : null]);
      return rec;
    },
  };
}

// Worth keeping? (Not a session that was switched on and straight off again.)
export const keepSession = (rec) => rec.words > 0 || (rec.voice && rec.end - rec.at > 30000);
