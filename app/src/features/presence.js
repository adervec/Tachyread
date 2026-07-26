// Cross-device "open files" presence. Each device publishes the checksums it currently has open (with
// its device name + a timestamp) into the synced progress bundle; on pull, other devices' entries are
// merged in so a tab can show a discrete "also open on <device>" indicator. Freshness-bounded — an
// entry is only trusted for a while after its last sync (pulls are periodic, so this is last-known,
// not live). Pure merge/read logic; see presence.test.mjs. DOM/storage wiring lives in storage.js.

export const PRESENCE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h — beyond this we assume it's not really open

// Merge an incoming presence list (from a synced bundle) into the known peers: dedupe by deviceId,
// keep the freshest `at` per device, and DROP our own device plus anything past maxAge.
export function mergePresence(peers, incoming, { selfId = null, now = Date.now(), maxAgeMs = PRESENCE_MAX_AGE_MS } = {}) {
  const byId = new Map();
  const add = (e) => {
    if (!e || !e.deviceId || e.deviceId === selfId) return;
    if (!Number.isFinite(e.at) || now - e.at > maxAgeMs) return;
    const prev = byId.get(e.deviceId);
    if (!prev || e.at > prev.at) {
      byId.set(e.deviceId, { deviceId: e.deviceId, name: e.name || '', at: e.at, open: Array.isArray(e.open) ? [...new Set(e.open)] : [] });
    }
  };
  for (const e of peers || []) add(e);
  for (const e of incoming || []) add(e);
  return [...byId.values()];
}

// The presence list to write into an exported bundle: our current self entry + every known FRESH
// peer (so the shared file accumulates the union of devices without ballooning with stale ones).
export function presenceList(self, peers, { selfId, name = '', now = Date.now(), maxAgeMs = PRESENCE_MAX_AGE_MS } = {}) {
  const list = mergePresence(peers, [], { selfId, now, maxAgeMs });
  if (self && Array.isArray(self.open) && self.open.length) {
    list.push({ deviceId: selfId, name, at: Number.isFinite(self.at) ? self.at : now, open: [...new Set(self.open)] });
  }
  return list;
}

// checksum → [{ deviceId, name, at }] for every OTHER device that has it open and fresh. Peers should
// already exclude self (mergePresence does); maxAge is re-applied so a list that aged in memory hides.
export function presenceByChecksum(peers, { now = Date.now(), maxAgeMs = PRESENCE_MAX_AGE_MS } = {}) {
  const map = {};
  for (const e of peers || []) {
    if (!e || !Number.isFinite(e.at) || now - e.at > maxAgeMs) continue;
    for (const cs of e.open || []) {
      if (!cs) continue;
      (map[cs] = map[cs] || []).push({ deviceId: e.deviceId, name: e.name || '', at: e.at });
    }
  }
  return map;
}

// A friendly label for the devices sharing a checksum: "Laptop", "Laptop & Phone", "3 other devices".
export function presenceLabel(entries) {
  const names = (entries || []).map((e) => (e.name || '').trim()).filter(Boolean);
  if (!entries?.length) return '';
  if (!names.length) return entries.length === 1 ? 'another device' : `${entries.length} other devices`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}
