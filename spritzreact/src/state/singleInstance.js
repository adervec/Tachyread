// Single-instance guard. Every browser tab of this web app shares one IndexedDB, so running
// two at once would let them clobber each other's session/progress. A heartbeat lock in
// localStorage marks the live instance; a second tab that finds a fresh lock bows out and
// must touch nothing (no DB reads/writes, no session changes).
const KEY = 'spritz-instance-lock';
const HEARTBEAT_MS = 1000;
const STALE_MS = 3500; // a lock older than this is considered dead (tab crashed without releasing)

export function acquireInstance() {
  let ls;
  try { ls = window.localStorage; } catch { return { primary: true, release() {} }; }
  try {
    const now = Date.now();
    const raw = ls.getItem(KEY);
    const lock = raw ? JSON.parse(raw) : null;
    if (lock && typeof lock.ts === 'number' && now - lock.ts < STALE_MS) {
      return { primary: false, release() {} }; // another live instance holds the lock
    }
    const id = Math.random().toString(36).slice(2) + now;
    const write = () => { try { ls.setItem(KEY, JSON.stringify({ id, ts: Date.now() })); } catch { /* noop */ } };
    write();
    const hb = setInterval(write, HEARTBEAT_MS);
    const release = () => {
      clearInterval(hb);
      try { const cur = JSON.parse(ls.getItem(KEY) || '{}'); if (cur.id === id) ls.removeItem(KEY); } catch { /* noop */ }
    };
    window.addEventListener('pagehide', release);
    window.addEventListener('beforeunload', release);
    return { primary: true, release, id };
  } catch {
    return { primary: true, release() {} }; // never block the app on a guard failure
  }
}
