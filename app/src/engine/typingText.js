// Non-QWERTY handling for the typing game. Real prose is full of characters a US-QWERTY keyboard
// can't produce — curly quotes, em/en dashes, ellipses, non-breaking spaces, and decorative marks
// (•, ¶, ·, ◇). Map the look-alikes to what the keyboard actually types, drop tokens that are purely
// decorative, and (in scoring) never penalize a leftover exotic character.
const TYPO_MAP = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", // ‘ ’ ‚ ‛ ′ → '
  '“': '"', '”': '"', '„': '"', '″': '"',                // “ ” „ ″ → "
  '–': '-', '—': '-', '―': '-', '−': '-',                // – — ― − → -
  '…': '...',                                                            // … → ...
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', // spaces → space
  '­': '', '​': '', '‌': '', '‍': '', '﻿': '',      // soft-hyphen / zero-width → drop
};

export function normalizeTypography(t) {
  let s = '';
  for (const ch of t) s += (ch in TYPO_MAP ? TYPO_MAP[ch] : ch);
  return s;
}

const ASCII_PRINTABLE = /[\x20-\x7E]/;

// Reduce a token to only what a US-QWERTY keyboard can produce: normalize typographic look-alikes,
// strip combining accents to their base letter (café → cafe), and drop any remaining non-ASCII. The
// point is WYSIWYG — the drill shows exactly what you type, never a character you can't reach.
export function toKeyboard(s) {
  let out = '';
  for (const ch of normalizeTypography(s).normalize('NFD')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0300 && cp <= 0x036f) continue; // combining diacritic → drop (base letter stays)
    if (cp >= 0x20 && cp <= 0x7e) out += ch;    // keep only typeable ASCII
  }
  return out;
}

// Transform a passage token for the drill. `bypassNonQwerty` reduces it to typeable ASCII (above);
// `noSpecial` keeps only letters/numbers/spaces (drops punctuation & symbols); `lowercase` lowercases.
// Returns the display/type text and a `skip` flag for tokens that end up with no letter or number
// (pure decoration like "•", "· · ·", "¶", or punctuation-only after stripping) — those are dropped
// so the passage never asks you to type nothing.
export function transformToken(raw, { bypassNonQwerty = true, lowercase = false, noSpecial = false } = {}) {
  let text = String(raw ?? '');
  if (bypassNonQwerty) text = toKeyboard(text);
  if (noSpecial) text = text.replace(/[^\p{L}\p{N}\s]/gu, '');
  if (lowercase) text = text.toLowerCase();
  text = text.replace(/^\s+|\s+$/gu, '');
  return { text, skip: !/[\p{L}\p{N}]/u.test(text) };
}

// Back-compat: the non-QWERTY bypass on its own (used before the transform options existed).
export function prepToken(raw) {
  return transformToken(raw, { bypassNonQwerty: true });
}

// A target character a US-QWERTY keyboard can't produce (accents, leftover symbols) → auto-accepted
// when it somehow survives into the passage (e.g. bypass off). With bypass on it's already removed.
export function isExotic(ch) {
  return ch !== undefined && ch !== '' && !ASCII_PRINTABLE.test(ch);
}
