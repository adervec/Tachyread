// Pronunciation scoring: the sounds you were meant to make (the text phonemized to IPA, word by word)
// against the sounds a phoneme recogniser heard (wav2vec2 espeak), aligned by edit distance. Each
// word scores the share of its phonemes you produced; the details show expected vs heard.
// Pure; the models run in phonemeWorker.js.

const STRIP = /[ˈˌ.‿\s]/g; // stress / syllable / linking marks — the recogniser doesn't emit them

// IPA string → phoneme tokens, greedy longest match against the recogniser's vocabulary (so "tʃ",
// "oʊ", "aɪ" come out as one token when the model knows them). Unknown chars are skipped.
export function tokenizeIpa(ipa, vocab, maxLen = 3) {
  const s = String(ipa || '').replace(STRIP, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    let hit = '';
    for (let L = Math.min(maxLen, s.length - i); L >= 1; L--) { const t = s.slice(i, i + L); if (vocab.has(t)) { hit = t; break; } }
    if (hit) { out.push(hit); i += hit.length; } else i++;
  }
  return out;
}

// Align expected phonemes (grouped per word) with the heard sequence. Returns per word
// { score 0–100, expected: [..], heard: [..] } and an overall score.
export function scorePronunciation(expectedWords, heard) {
  const exp = [];
  expectedWords.forEach((ph, w) => ph.forEach((p) => exp.push({ p, w })));
  const n = exp.length, m = heard.length;
  // DP edit distance with backtrace (substitution / deletion = missed sound / insertion = extra sound)
  const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Uint16Array(m + 1); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (exp[i - 1].p === heard[j - 1] ? 0 : 1));
  }
  const words = expectedWords.map((ph) => ({ expected: ph, heard: [], ok: 0 }));
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (exp[i - 1].p === heard[j - 1] ? 0 : 1)) {
      const wd = words[exp[i - 1].w];
      wd.heard.unshift(heard[j - 1]);
      if (exp[i - 1].p === heard[j - 1]) wd.ok++;
      i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { i--; } // expected sound missing
    else { // extra heard sound → belongs to the word it sits in (the next expected one, or the last)
      const w = i < n ? exp[i].w : exp[n - 1]?.w ?? 0;
      if (words[w]) words[w].heard.unshift(heard[j - 1]);
      j--;
    }
  }
  const out = words.map((w) => ({ expected: w.expected, heard: w.heard, score: w.expected.length ? Math.round((100 * w.ok) / Math.max(w.expected.length, w.heard.length)) : 100 }));
  return { words: out, overall: n ? Math.round((100 * Math.max(0, n - D[n][m])) / n) : 0 }; // 100 − edit distance as a % of the expected sounds
}
