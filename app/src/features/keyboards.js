// Which physical keyboard a typing run was typed on.
//
// Key events carry no hardware identity by design, so this leans on the only two signals the web
// actually exposes, best first:
//   1. WebHID — a real vendorId/productId, once the user links the board. Chrome blocks the standard
//      keyboard HID collection, so this only reaches boards that ALSO expose a vendor-defined one
//      (QMK/VIA, Keychron, Logitech, Razer…). Laptop built-ins never appear, and it needs one
//      explicit grant; after that navigator.hid.getDevices() sees it on every later visit.
//   2. navigator.keyboard.getLayoutMap() — the OS layout. Tells a QWERTY board from an AZERTY or
//      Slovenian one, but not two QWERTYs apart. Free, no prompt, Chromium only.
// Neither is guaranteed, so detection only decides which entry is *preselected* — the list is the
// user's, and they can rename entries or pick another.

const HOME = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'Semicolon', 'Quote'];

// FNV-1a — a short stable digest, not a security hash.
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const hex4 = (n) => `0x${Number(n || 0).toString(16).padStart(4, '0')}`;
export const hidId = (d) => `hid:${hex4(d?.vendorId)}:${hex4(d?.productId)}`;

// A layout map is code → the character that key produces. Same characters in the same positions =
// same layout; the digest keeps the id short and the settings blob small.
export function layoutId(entries) {
  return `layout:${hash32(HOME.map((c) => `${c}=${entries.get?.(c) ?? entries[c] ?? ''}`).join('|'))}`;
}

// "QWERTY keyboard" / "AZERTY keyboard" / "QWERTZ keyboard" — the top row is what people call it.
export function layoutLabel(entries) {
  const get = (c) => (entries.get?.(c) ?? entries[c] ?? '');
  const top = HOME.slice(0, 6).map(get).join('');
  return top.trim() ? `${top.toUpperCase()} keyboard` : 'Keyboard';
}

// ── catalog ────────────────────────────────────────────────────────────────────────────────────
export const keyboardList = (stored) => (Array.isArray(stored) ? stored.filter((k) => k?.id) : []);

export function upsertKeyboard(list, entry) {
  const known = keyboardList(list);
  if (!entry?.id) return known;
  // A user-chosen label always wins over a freshly detected one — renaming must stick.
  return known.some((k) => k.id === entry.id) ? known : [...known, { id: entry.id, label: entry.label || entry.id }];
}

export const renameKeyboard = (list, id, label) =>
  keyboardList(list).map((k) => (k.id === id ? { ...k, label: label || k.label } : k));

export const removeKeyboard = (list, id) => keyboardList(list).filter((k) => k.id !== id);

export const labelFor = (list, id) => keyboardList(list).find((k) => k.id === id)?.label || '';

// Per-keyboard rollup for the Typing Progress page. Runs with no keyboard stamp (everything typed
// before this shipped) collapse into one "Unrecorded" row rather than vanishing.
export function keyboardRows(runs, list) {
  const by = new Map();
  for (const r of runs || []) {
    const id = r?.keyboard || 'unknown';
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  }
  const rows = [...by.entries()].map(([id, rs]) => ({
    id,
    label: labelFor(list, id) || rs.find((r) => r.keyboardLabel)?.keyboardLabel || (id === 'unknown' ? 'Unrecorded' : id),
    runs: rs.length,
    avgNet: Math.round(rs.reduce((a, r) => a + (r.netWpm || 0), 0) / rs.length),
    best: Math.max(...rs.map((r) => r.netWpm || 0)),
    avgAcc: Math.round((rs.reduce((a, r) => a + (r.accuracy || 0), 0) / rs.length) * 10) / 10,
    words: rs.reduce((a, r) => a + (r.words || 0), 0),
  }));
  return rows.sort((a, b) => b.runs - a.runs);
}

// ── detection ──────────────────────────────────────────────────────────────────────────────────
// ponytail: module-level "current keyboard" instead of threading a prop through the reader shell
// into TypingRun. One value, one writer (the App effect below), read once when a run ends.
let active = null;
export const activeKeyboard = () => active;
export const setActiveKeyboard = (k) => { active = k || null; };

export const hidSupported = () => typeof navigator !== 'undefined' && !!navigator.hid;

export async function detectKeyboard() {
  try {
    const [device] = (await navigator.hid?.getDevices?.()) || [];
    if (device) return { id: hidId(device), label: device.productName || 'Linked keyboard' };
  } catch { /* no HID, or blocked by permissions policy */ }
  try {
    const map = await navigator.keyboard?.getLayoutMap?.();
    if (map) return { id: layoutId(map), label: layoutLabel(map) };
  } catch { /* Chromium-only */ }
  return null;
}

// One-time grant. Empty filters shows every device Chrome is willing to expose — a plain keyboard
// won't be among them unless it publishes a vendor collection, which is worth saying out loud in
// the UI rather than letting the chooser look broken.
export async function linkKeyboard() {
  if (!hidSupported()) return null;
  const [device] = await navigator.hid.requestDevice({ filters: [] });
  return device ? { id: hidId(device), label: device.productName || 'Linked keyboard' } : null;
}
