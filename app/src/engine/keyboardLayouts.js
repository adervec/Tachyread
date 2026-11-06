// Keyboard layouts for the typing trainer: the on-screen keyboard and layout EMULATION (practise
// Colemak or Dvorak on a QWERTY keyboard — each physical key, by its KeyboardEvent.code position,
// types the chosen layout's character). Rows list the three letter rows by physical position.
const CODES = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];
export const LAYOUTS = {
  qwerty: { label: 'QWERTY', rows: ['qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'] },
  colemak: { label: 'Colemak', rows: ['qwfpgjluy;[]', "arstdhneio'", 'zxcvbkm,./'] },
  dvorak: { label: 'Dvorak', rows: ["',.pyfgcrl/=", 'aoeuidhtns-', ';qjkxbmwvz'] },
};
const SHIFTED = { ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '[': '{', ']': '}', '-': '_', '=': '+' };
const POS = new Map(CODES.flatMap((row, r) => row.map((code, c) => [code, [r, c]])));

// The character the physical key `code` types in `layout` (null = not a remapped key → let it be).
export function emulateKey(code, shift, layout) {
  const L = LAYOUTS[layout];
  const pos = POS.get(code);
  if (!L || layout === 'qwerty' || !pos) return null;
  const ch = L.rows[pos[0]][pos[1]];
  if (!ch) return null;
  return shift ? (SHIFTED[ch] || ch.toUpperCase()) : ch;
}

// Which on-screen key to light for the next character: [row, col] in the layout, plus whether Shift.
export function keyFor(ch, layout = 'qwerty') {
  if (!ch) return null;
  const rows = (LAYOUTS[layout] || LAYOUTS.qwerty).rows;
  const base = Object.entries(SHIFTED).find(([, s]) => s === ch)?.[0] || ch.toLowerCase();
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(base);
    if (c >= 0) return { row: r, col: c, shift: ch !== base };
  }
  return ch === ' ' ? { space: true } : null;
}

// ── keybr-style course ───────────────────────────────────────────────────────────────────────────
// Letters unlock in English frequency order; the newest unlocked letter is the FOCUS (drilled most).
export const COURSE_ORDER = 'enitrlsauodychgmpbkvwfzxqj';
export const COURSE_START = 6;

// After a course run: unlock the next letter when every unlocked letter reached `target` wpm (from
// its reach time, ≥3 timed keystrokes) and accuracy held ≥ minAcc. Returns what to tell the typist.
export function courseStep(level, runKeys, accuracy, { target = 35, minAcc = 95 } = {}) {
  const letters = COURSE_ORDER.slice(0, level).split('');
  const speed = (v) => (v?.t >= 3 && v.ms > 0 ? 12000 / (v.ms / v.t) : null);
  const slow = letters.filter((ch) => { const w = speed(runKeys?.[ch]); return w == null || w < target; });
  const unlock = !slow.length && accuracy >= minAcc && level < COURSE_ORDER.length;
  return { unlock, next: unlock ? COURSE_ORDER[level] : null, slow, accuracyOk: accuracy >= minAcc };
}

// Course passage: real words from your book spelled only with unlocked letters (so it's English,
// and your book's English), topped up with generated letter groups that lean on the focus letter.
export function coursePassage(level, count, seed = 0, docWords = []) {
  const allowed = new Set(COURSE_ORDER.slice(0, level));
  const focus = COURSE_ORDER[level - 1];
  const real = [...new Set(docWords.slice(0, 60000).map((w) => String(w).toLowerCase().replace(/[^\p{L}]/gu, '')))]
    .filter((w) => w.length >= 2 && w.length <= 9 && [...w].every((c) => allowed.has(c)));
  let s = (seed + 7) * 1103515245 + 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const letters = [...allowed];
  const fake = () => {
    const len = 3 + Math.floor(rnd() * 4);
    let w = '';
    while (w.length < len) {
      const c = rnd() < 0.2 ? focus : letters[Math.floor(rnd() * letters.length)];
      if (w.length >= 2 && w.at(-1) === c && w.at(-2) === c) continue; // no "lll"
      w += c;
    }
    return w;
  };
  const out = [];
  while (out.length < count) {
    const useReal = real.length >= 5 && rnd() < 0.7;
    const w = useReal ? real[Math.floor(rnd() * real.length)] : fake();
    // keep the focus letter in play: real words without it are skipped half the time
    if (useReal && !w.includes(focus) && rnd() < 0.5) continue;
    out.push(w);
  }
  return out;
}
