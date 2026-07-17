// Per-document word substitutions (Tab Settings → Word substitutions): render one word as another
// everywhere the text is DISPLAYED (Lines pane + Fast Reader). Display-only — the underlying
// document, tracking, and search are untouched.
// ponytail: single-word, case-preserving-first-letter swaps; phrase swaps would need doc rewriting.

// Normalize a settings map { from: to } → lookup keyed by lower-cased source word.
export function swapLookup(wordSwaps) {
  const entries = Object.entries(wordSwaps || {}).filter(([f, t]) => f && typeof t === 'string' && t.trim());
  if (!entries.length) return null;
  const m = new Map();
  for (const [f, t] of entries) m.set(String(f).trim().toLowerCase(), String(t).trim());
  return m;
}

// Apply a swap to one display token, preserving leading/trailing punctuation and a leading capital.
// Returns the token unchanged when no swap matches.
export function applySwap(token, lookup) {
  if (!lookup) return token;
  const m = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’-]+)([^\p{L}\p{N}]*)$/u);
  if (!m) return token;
  const [, pre, core, post] = m;
  const rep = lookup.get(core.toLowerCase());
  if (rep == null) return token;
  const cased = core[0] === core[0].toUpperCase() && core[0] !== core[0].toLowerCase()
    ? rep[0].toUpperCase() + rep.slice(1)
    : rep;
  return pre + cased + post;
}
