// Which localStorage keys are Tachyread's to erase. Every app shares the adervec.github.io origin,
// so "delete everything" must never be localStorage.clear(): only our own `tachyread-` keys go, and
// the cross-app instance lock stays (it guards the open window, it is not data). See ownKeys.test.mjs.
export const ownLocalKeys = (keys) => (keys || []).filter((k) => typeof k === 'string' && k.startsWith('tachyread-') && k !== 'tachyread-instance-lock');

// The shared install registry other apps read ('portal-installed'): drop only our entry.
export function withoutOurPortalEntry(json) {
  try {
    const reg = JSON.parse(json || '{}');
    if (!reg || typeof reg !== 'object' || !('Tachyread' in reg)) return null; // nothing to change
    delete reg.Tachyread;
    return JSON.stringify(reg);
  } catch { return null; }
}
