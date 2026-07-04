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

// Prepare a passage token: normalize typographic look-alikes, trim decorative symbols off the ends,
// and flag tokens with no letter or number left (pure decoration like "•", "· · ·", "¶") to bypass.
export function prepToken(raw) {
  const text = normalizeTypography(raw)
    .replace(/^[^\x20-\x7E\p{L}\p{N}]+/u, '')
    .replace(/[^\x20-\x7E\p{L}\p{N}]+$/u, '');
  return { text, skip: !/[\p{L}\p{N}]/u.test(text) };
}

// A target character a US-QWERTY keyboard can't produce (accents, leftover symbols) → auto-accepted.
export function isExotic(ch) {
  return ch !== undefined && ch !== '' && !ASCII_PRINTABLE.test(ch);
}
