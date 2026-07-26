// Order-independent structural equality for plain settings data (objects, arrays, primitives). Used
// to decide whether a settings profile matches the current settings — so the matching profile can be
// preselected and Load/Save/Update can disable when they'd change nothing. Not a general-purpose
// deep-equal: it ignores key ORDER (settings objects get rebuilt in varying order) and treats a
// missing key and an `undefined` value as the same (JSON round-trips drop undefined). Pure; see
// deepEqual.test.mjs.
export function deepEqual(a, b) {
  if (a === b) return true; // handles null===null, undefined===undefined, same-ref, equal primitives
  // Past the === check, a null or undefined on either side can't match (null ≠ undefined ≠ a value).
  if (a === null || b === null || a === undefined || b === undefined) return false;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb) return false;
  if (ta !== 'object') return a === b; // primitives (NaN !== NaN — fine for settings)
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  // Plain objects: compare the union of keys, skipping any whose value is undefined on both sides.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (va === undefined && vb === undefined) continue;
    if (!deepEqual(va, vb)) return false;
  }
  return true;
}
