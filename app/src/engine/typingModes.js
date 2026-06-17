// Typing-mode groundwork. The typing run engine (components/TypingRun.jsx) is deliberately
// content-agnostic: it types through a `passage` (an array of "words") and scores keystrokes. That
// lets us treat the Monkeytype-style document passage as just ONE mode, and add classic
// Mavis-Beacon-style drills (home row, common words, numbers, quotes…) as alternate passage
// generators behind the same engine. New modes = a new entry here + a generator branch; the run UI,
// scoring, trend, and history all keep working unchanged.

// kind: 'doc'  → generated from the open document (needs the reading position; supports "count as read")
//       'drill'→ self-contained practice text (no reading position)
export const TYPING_MODES = [
  { id: 'passage', label: 'Passage', kind: 'doc', desc: 'Type your book from where you are (Monkeytype-style).' },
  { id: 'commonWords', label: 'Common words', kind: 'drill', desc: 'The most frequent English words — build raw speed.' },
  { id: 'homeRow', label: 'Home row', kind: 'drill', desc: 'a s d f j k l ; drill.' },
  { id: 'topRow', label: 'Top row', kind: 'drill', desc: 'q w e r t y u i o p drill.' },
  { id: 'bottomRow', label: 'Bottom row', kind: 'drill', desc: 'z x c v b n m drill.' },
  { id: 'numbers', label: 'Numbers & symbols', kind: 'drill', desc: 'Number-row and symbol accuracy.' },
  { id: 'quotes', label: 'Quotes', kind: 'drill', desc: 'Type a short literary quote.' },
];

export const TYPING_MODE_BY_ID = Object.fromEntries(TYPING_MODES.map((m) => [m.id, m]));

const COMMON_WORDS = (
  'the be to of and a in that have I it for not on with he as you do at this but his by from they we ' +
  'say her she or an will my one all would there their what so up out if about who get which go me when ' +
  'make can like time no just him know take people into year your good some could them see other than then ' +
  'now look only come its over think also back after use two how our work first well way even new want because ' +
  'any these give day most us'
).split(/\s+/);

const QUOTES = [
  'It was the best of times it was the worst of times',
  'All happy families are alike each unhappy family is unhappy in its own way',
  'Call me Ishmael',
  'It is a truth universally acknowledged that a single man in possession of a good fortune must be in want of a wife',
  'The only way out is through and the only way through is to begin',
  'Not all those who wander are lost',
];

// Deterministic-enough shuffle seeded by index so a "Reattempt" can vary without Date/Math state needs.
function shuffled(arr, seed = 0) {
  const a = arr.slice();
  let s = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Random "words" built from a character set — the Mavis-Beacon-style key drills.
function drillWords(chars, count, seed = 0) {
  const out = [];
  let s = seed * 1103515245 + 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < count; i++) {
    const len = 3 + Math.floor(rnd() * 3); // 3..5 chars
    let w = '';
    for (let j = 0; j < len; j++) w += chars[Math.floor(rnd() * chars.length)];
    out.push(w);
  }
  return out;
}

// Build the passage (word array) for a mode. `seed` lets callers vary drills between attempts.
export function buildPassage(mode, { docWords = [], startIndex = 0, max = 600, seed = 0 } = {}) {
  switch (mode) {
    case 'commonWords': {
      const out = [];
      let i = 0;
      while (out.length < max) out.push(...shuffled(COMMON_WORDS, seed + i++));
      return out.slice(0, max);
    }
    case 'homeRow': return drillWords('asdfghjkl;', max, seed);
    case 'topRow': return drillWords('qwertyuiop', max, seed);
    case 'bottomRow': return drillWords('zxcvbnm,.', max, seed);
    case 'numbers': return drillWords('1234567890-=', max, seed);
    case 'quotes': {
      const out = [];
      let i = 0;
      while (out.length < Math.min(max, 120)) { out.push(...QUOTES[(seed + i++) % QUOTES.length].split(' ')); }
      return out;
    }
    case 'passage':
    default:
      return docWords.slice(startIndex, Math.min(docWords.length, startIndex + max));
  }
}
