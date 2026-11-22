// Tachyread's cowork files live in the reader's private cloud folder (house standard 3,
// COWORK-PROTOCOL "In the reader's cloud"), where the AI runner answers them; the old folder on this
// computer is retired. The cloud folder is flat, so path `snapshot/books.json` is the file
// `cowork-tachyread--snapshot--books.json`. Same files, same manifest, phone and desktop alike.
import { t } from '../i18n.js';

const APP = 'tachyread';
const PREFIX = `cowork-${APP}--`;
export const cloudName = (path) => PREFIX + String(path).replace(/^\/+|\/+$/g, '').split('/').join('--');
const mimeOf = (path) => (/\.md$/i.test(path) ? 'text/markdown' : /\.json$/i.test(path) ? 'application/json' : 'text/plain');
const door = () => (typeof window !== 'undefined' ? window.appFont?.cloud || null : null);

// A small "folder" over the cloud: read / write / remove a path, list one level of a sub-path.
function folder(c) {
  return {
    label: `${c.label?.() || 'Cloud'} › ${APP}`,
    read: (path) => c.read(cloudName(path)).catch(() => null),
    write: (path, text) => c.write(cloudName(path), text, mimeOf(path)),
    remove: (path) => c.remove(cloudName(path)).catch(() => false),
    // names of the files directly inside `sub` (not deeper)
    async list(sub) {
      const pre = cloudName(sub) + '--';
      return (await c.list(pre)).map((f) => f.name.slice(pre.length)).filter((n) => n && !n.includes('--')).sort();
    },
  };
}

// The cowork folder when the reader is signed in to their cloud, else null. `ask` may show the
// sign-in window (call it from a click); without it nothing ever pops up.
export async function cloudCoworkDir({ ask = false } = {}) {
  const c = door();
  if (!c) return null;
  if (!c.signedIn()) { try { await c.signIn({ silent: !ask }); } catch { return null; } }
  return folder(c);
}
export const NOT_SIGNED_IN = () => t('skipped — not signed in to your cloud on this device (open the Cowork page once to sign in)');

// Replies applied or discarded on ANY device (applied.json beside the requests, the protocol's
// cross-device list), so a phone that was offline never applies what the desktop already did.
// Kept with appFont.cloud.syncDoc: the list only grows (last 500), this device's copy in localStorage.
const APPLIED = cloudName('applied.json');
const LOCAL = 'tachyread-cowork-applied';
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } };
export function mergeApplied(a, b) {
  const seen = new Set(), out = [];
  for (const h of [...(b?.applied || []), ...(a?.applied || [])]) if (typeof h === 'string' && !seen.has(h)) { seen.add(h); out.push(h); }
  return { protocol: 'cowork-applied', protocolVersion: 1, applied: out.sort().slice(-500) };
}
async function syncApplied(add = []) {
  const c = door();
  if (!c?.syncDoc || !c.signedIn()) return readLocal();
  let doc = null;
  await c.syncDoc(APPLIED, {
    load: () => (doc = mergeApplied({ applied: readLocal() }, { applied: add })),
    merge: mergeApplied,
    save: (d) => { doc = d; },
  });
  try { localStorage.setItem(LOCAL, JSON.stringify(doc.applied)); } catch { /* quota: the cloud copy still holds it */ }
  return doc.applied;
}
export async function wasApplied(hash) {
  try { return (await syncApplied()).includes(hash); } catch { return readLocal().includes(hash); }
}
export async function markApplied(hash) {
  if (!hash) return;
  try { await syncApplied([hash]); } catch { try { localStorage.setItem(LOCAL, JSON.stringify([...new Set([...readLocal(), hash])].slice(-500))); } catch { /* ignore */ } }
}
